const fs = require('fs').promises;
const path = require('path');
const { createReadStream } = require('fs');
const config = require('../config/config');
const logger = require('../utils/logger');
const EventEmitter = require('events');

/**
 * Disk Storage Service
 * Handles file operations for storing media segments on disk
 */
class DiskStorageService extends EventEmitter {
  constructor(options = {}) {
    super();
    this.baseDir = options.baseDir || config.STORAGE.BASE_DIR;
    this.segmentsDir = options.segmentsDir || config.STORAGE.SEGMENTS_DIR;
    this.metadataFile = options.metadataFile || config.STORAGE.METADATA_FILE;
    this.maxRetries = options.maxRetries || config.STORAGE.MAX_WRITE_RETRIES;
    this.retryDelay = options.retryDelay || config.STORAGE.WRITE_RETRY_DELAY;
    
    this.segmentsPath = path.join(this.baseDir, this.segmentsDir);
    this.metadataPath = path.join(this.baseDir, this.metadataFile);
    
    // Statistics
    this.stats = {
      writes: 0,
      reads: 0,
      deletes: 0,
      errors: 0,
      totalBytesWritten: 0,
      totalBytesRead: 0
    };
    
    logger.info(`Initialized disk storage service: ${this.segmentsPath}`);
  }
  
  /**
   * Initialize the storage service
   * Creates the necessary directories
   */
  async initialize() {
    try {
      // Create base directory if it doesn't exist
      await this._ensureDir(this.baseDir);
      
      // Create segments directory if it doesn't exist
      await this._ensureDir(this.segmentsPath);
      
      logger.info(`Disk storage service initialized: ${this.segmentsPath}`);
      
      // Emit initialized event
      this.emit('initialized', {
        baseDir: this.baseDir,
        segmentsPath: this.segmentsPath
      });
      
      return true;
    } catch (error) {
      logger.error(`Failed to initialize disk storage: ${error.message}`);
      this.stats.errors++;
      throw error;
    }
  }
  
  /**
   * Write a segment to disk
   * @param {string} segmentId - Unique identifier for the segment (e.g., sequenceNumber)
   * @param {Buffer} data - The segment data to write
   * @returns {string} - Path to the written file
   */
  async writeSegment(segmentId, data) {
    const filePath = this._getSegmentPath(segmentId);
    let attempts = 0;
    
    while (attempts < this.maxRetries) {
      try {
        await fs.writeFile(filePath, data);
        this.stats.writes++;
        this.stats.totalBytesWritten += data.length;
        logger.debug(`Segment written to disk: ${filePath} (${data.length} bytes)`);
        return filePath;
      } catch (error) {
        attempts++;
        logger.warn(`Error writing segment to disk (attempt ${attempts}/${this.maxRetries}): ${error.message}`);
        
        if (attempts >= this.maxRetries) {
          this.stats.errors++;
          throw new Error(`Failed to write segment after ${this.maxRetries} attempts: ${error.message}`);
        }
        
        // Wait before retrying
        await new Promise(resolve => setTimeout(resolve, this.retryDelay));
      }
    }
  }
  
  /**
   * Read a segment from disk
   * @param {string} segmentId - Unique identifier for the segment
   * @returns {Buffer} - The segment data
   */
  async readSegment(segmentId) {
    const filePath = this._getSegmentPath(segmentId);
    
    try {
      const data = await fs.readFile(filePath);
      this.stats.reads++;
      this.stats.totalBytesRead += data.length;
      logger.debug(`Segment read from disk: ${filePath} (${data.length} bytes)`);
      return data;
    } catch (error) {
      this.stats.errors++;
      logger.error(`Error reading segment from disk: ${error.message}`);
      throw new Error(`Failed to read segment: ${error.message}`);
    }
  }
  
  /**
   * Get a read stream for a segment
   * @param {string} segmentId - Unique identifier for the segment
   * @returns {ReadStream} - A readable stream for the segment
   */
  getSegmentReadStream(segmentId) {
    const filePath = this._getSegmentPath(segmentId);
    try {
      const stream = createReadStream(filePath);
      this.stats.reads++;
      logger.debug(`Created read stream for segment: ${filePath}`);
      return stream;
    } catch (error) {
      this.stats.errors++;
      logger.error(`Error creating read stream: ${error.message}`);
      throw new Error(`Failed to create read stream: ${error.message}`);
    }
  }
  
  /**
   * Delete a segment from disk
   * @param {string} segmentId - Unique identifier for the segment
   * @returns {boolean} - True if successful
   */
  async deleteSegment(segmentId) {
    const filePath = this._getSegmentPath(segmentId);
    
    try {
      await fs.unlink(filePath);
      this.stats.deletes++;
      logger.debug(`Segment deleted from disk: ${filePath}`);
      return true;
    } catch (error) {
      // Don't count as error if file doesn't exist
      if (error.code !== 'ENOENT') {
        this.stats.errors++;
        logger.error(`Error deleting segment from disk: ${error.message}`);
      } else {
        logger.debug(`Segment not found for deletion: ${filePath}`);
      }
      return false;
    }
  }
  
  /**
   * Write metadata to disk
   * @param {Object} metadata - Metadata to write
   * @returns {Promise<boolean>} - True if successful
   */
  async writeMetadata(metadata) {
    try {
      // Ensure the directory exists for the metadata file (not just segments dir)
      const metadataDir = path.dirname(this.metadataPath);
      await this._ensureDir(metadataDir);

      // Create a sanitized copy of the metadata to avoid circular references
      const sanitizedMetadata = JSON.parse(JSON.stringify(metadata));
      
      // Generate JSON with proper formatting
      const jsonContent = JSON.stringify(sanitizedMetadata, null, 2);
      
      // Write directly to the file without using a temporary file
      await fs.writeFile(this.metadataPath, jsonContent, { encoding: 'utf8' });
      
      this.stats.writes++;
      this.stats.totalBytesWritten += jsonContent.length;
      logger.info('Successfully wrote buffer metadata to disk');
      return true;
    } catch (error) {
      this.stats.errors++;
      logger.error(`Error writing metadata to disk: ${error.message}`);
      return false;
    }
  }
  
  /**
   * Read metadata from disk
   * @returns {Object|null} - The metadata or null if not found
   */
  async readMetadata() {
    try {
      const data = await fs.readFile(this.metadataPath, 'utf8');
      logger.debug(`Metadata read from disk: ${this.metadataPath}`);
      try {
        return JSON.parse(data);
      } catch (parseError) {
        // Log a portion of the data to help diagnose the issue
        const preview = data.length > 200 
          ? data.substring(0, 200) + '...' 
          : data;
        logger.error(`Error parsing metadata JSON: ${parseError.message}`);
        logger.error(`Metadata content (first 200 chars): ${preview}`);
        return null;
      }
    } catch (error) {
      // Don't count as error if file doesn't exist
      if (error.code !== 'ENOENT') {
        this.stats.errors++;
        logger.error(`Error reading metadata from disk: ${error.message}`);
      } else {
        logger.debug(`Metadata file not found: ${this.metadataPath}`);
      }
      return null;
    }
  }
  
  /**
   * Check if a segment exists on disk
   * @param {string} segmentId - Unique identifier for the segment
   * @returns {boolean} - True if the segment exists
   */
  async segmentExists(segmentId) {
    const filePath = this._getSegmentPath(segmentId);
    
    try {
      await fs.access(filePath);
      return true;
    } catch (error) {
      return false;
    }
  }
  
  /**
   * List all segment files in the storage directory
   * @returns {Array<string>} - Array of segment IDs
   */
  async listSegments() {
    try {
      const files = await fs.readdir(this.segmentsPath);
      // Extract segment IDs from filenames (remove file extension)
      return files
        .filter(file => file.endsWith('.ts'))
        .map(file => path.basename(file, '.ts'));
    } catch (error) {
      this.stats.errors++;
      logger.error(`Error listing segments: ${error.message}`);
      return [];
    }
  }
  
  /**
   * Get storage statistics
   * @returns {Object} - Storage statistics
   */
  getStats() {
    // Add disk usage information if needed
    return { ...this.stats };
  }
  
  /**
   * Get the path for a segment file
   * @private
   * @param {string} segmentId - Unique identifier for the segment
   * @returns {string} - The full path to the segment file
   */
  _getSegmentPath(segmentId) {
    return path.join(this.segmentsPath, `${segmentId}.ts`);
  }
  
  /**
   * Ensure a directory exists
   * @private
   * @param {string} dir - The directory path
   */
  async _ensureDir(dir) {
    try {
      await fs.mkdir(dir, { recursive: true });
      logger.debug(`Directory created/verified: ${dir}`);
    } catch (error) {
      logger.error(`Failed to create directory ${dir}: ${error.message}`);
      throw error;
    }
  }
  
  /**
   * Clean up old segments based on a filter function
   * @param {Function} filterFn - Function that takes a segment ID and returns true if it should be kept
   * @returns {number} - Number of segments deleted
   */
  async cleanupSegments(filterFn) {
    try {
      const segments = await this.listSegments();
      const toDelete = segments.filter(id => !filterFn(id));
      
      logger.info(`Cleaning up ${toDelete.length} old segments from disk`);
      
      let deletedCount = 0;
      for (const segmentId of toDelete) {
        const deleted = await this.deleteSegment(segmentId);
        if (deleted) deletedCount++;
      }
      
      return deletedCount;
    } catch (error) {
      this.stats.errors++;
      logger.error(`Error cleaning up segments: ${error.message}`);
      return 0;
    }
  }
}

// Create a singleton instance
const diskStorageService = new DiskStorageService();

module.exports = {
  diskStorageService,
  DiskStorageService
}; 