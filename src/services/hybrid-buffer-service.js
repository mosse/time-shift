const config = require('../config/config');
const logger = require('../utils/logger');
const EventEmitter = require('events');
const { diskStorageService } = require('./disk-storage-service');
const path = require('path');

/**
 * Hybrid Buffer Service
 * Implements a circular buffer with timestamp-based access
 * Stores segment data on disk, metadata in memory
 * Emits events for segment lifecycle management
 */
class HybridBufferService extends EventEmitter {
  constructor(bufferDuration = config.BUFFER_DURATION) {
    super(); // Initialize EventEmitter
    
    this.bufferDuration = bufferDuration;
    this.segments = []; // Will store metadata only
    this.segmentsByTimestamp = new Map();
    this.segmentsBySequence = new Map();
    this.totalSize = 0;
    this.totalDuration = 0;
    this.diskStorageEnabled = config.STORAGE.USE_DISK_STORAGE;
    
    logger.info(`Initialized hybrid buffer service with duration: ${bufferDuration}ms, disk storage: ${this.diskStorageEnabled}`);
  }
  
  /**
   * Initialize the buffer service
   * @param {Object} [options] - Configuration options
   * @param {number} [options.duration] - Buffer duration in milliseconds
   * @param {boolean} [options.diskStorageEnabled] - Whether to use disk storage
   * @param {boolean} [options.skipCleanup] - Whether to skip clearing the buffer
   */
  async initialize(options = {}) {
    // Apply configuration if provided
    if (options.duration) {
      this.bufferDuration = options.duration;
    }
    
    if (options.diskStorageEnabled !== undefined) {
      this.diskStorageEnabled = options.diskStorageEnabled;
    }
    
    // Clear any existing data unless skipCleanup is true
    if (!options.skipCleanup) {
      this.clear();
    }
    
    // Initialize disk storage if enabled
    if (this.diskStorageEnabled) {
      try {
        await diskStorageService.initialize();
        
        // Load any existing metadata
        await this._loadMetadataFromDisk();
        
        logger.info('Disk storage initialized for buffer');
      } catch (error) {
        logger.error(`Failed to initialize disk storage: ${error.message}`);
        // Continue with in-memory only as fallback
        this.diskStorageEnabled = false;
        logger.warn('Falling back to in-memory storage only');
      }
    }
    
    // Set up automatic cleanup
    this.setupCleanupInterval();
    
    logger.info(`Initialized hybrid buffer service with duration: ${this.bufferDuration}ms, disk storage: ${this.diskStorageEnabled}`);
    
    // Emit initialized event
    this.emit('initialized', {
      duration: this.bufferDuration,
      diskStorageEnabled: this.diskStorageEnabled
    });
    
    return this;
  }
  
  /**
   * Set up automatic cleanup interval
   */
  setupCleanupInterval() {
    // Clear existing interval if any
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
    }
    
    // Schedule cleanup every minute
    this.cleanupInterval = setInterval(() => {
      this.removeExpiredSegments();
    }, config.STORAGE.CLEANUP_INTERVAL); 
    
    // Ensure the interval doesn't keep the process alive
    this.cleanupInterval.unref();
  }
  
  /**
   * Add a new segment to the buffer
   * @param {Buffer|ArrayBuffer} segmentData - The binary data of the segment
   * @param {Object} metadata - Metadata about the segment
   * @param {string} metadata.url - The URL the segment was fetched from
   * @param {number} metadata.sequenceNumber - The sequence number in the playlist
   * @param {number} metadata.duration - The duration of the segment in seconds
   * @returns {Object} - The stored segment metadata object
   */
  async addSegment(segmentData, metadata) {
    try {
      if (!segmentData) {
        throw new Error('Segment data is required');
      }
      
      if (!metadata || !metadata.url) {
        throw new Error('Segment metadata with URL is required');
      }
      
      const timestamp = Date.now();
      const segmentId = this._getSegmentId(metadata);
      
      // Create metadata object
      const segmentMetadata = {
        timestamp,
        filePath: null, // Will be set if disk storage is used
        metadata: {
          ...metadata,
          duration: metadata.duration || 0,
          sequenceNumber: metadata.sequenceNumber || 0,
          addedAt: new Date(timestamp).toISOString(),
          segmentId
        },
        size: segmentData.byteLength || segmentData.length || 0
      };
      
      // Store segment data on disk if enabled
      if (this.diskStorageEnabled) {
        try {
          const filePath = await diskStorageService.writeSegment(segmentId, segmentData);
          segmentMetadata.filePath = filePath;
          segmentMetadata.storedOnDisk = true;
          logger.debug(`Segment ${segmentId} stored on disk: ${filePath}`);
        } catch (error) {
          logger.error(`Failed to write segment to disk: ${error.message}`);
          // Continue with in-memory fallback for this segment
          segmentMetadata.data = segmentData;
          segmentMetadata.storedOnDisk = false;
        }
      } else {
        // Store in memory if disk storage is disabled
        segmentMetadata.data = segmentData;
        segmentMetadata.storedOnDisk = false;
      }
      
      // Add to metadata index
      this.segments.push(segmentMetadata);
      this.segmentsByTimestamp.set(timestamp, segmentMetadata);
      
      // Add to sequence index if sequence number is provided
      if (metadata.sequenceNumber !== undefined) {
        this.segmentsBySequence.set(metadata.sequenceNumber, segmentMetadata);
      }
      
      // Update stats
      this.totalSize += segmentMetadata.size;
      this.totalDuration += segmentMetadata.metadata.duration;
      
      logger.debug(`Added segment: ${metadata.url} (${segmentMetadata.size} bytes, ${segmentMetadata.metadata.duration}s)`);
      
      // Save metadata to disk periodically
      this._saveMetadataToDisk();
      
      // Prune old segments if needed
      await this._pruneOldSegments();
      
      // Emit segment added event
      this.emit('segmentAdded', {
        segmentId: metadata.url,
        size: segmentMetadata.size,
        timestamp: segmentMetadata.timestamp,
        metadata
      });
      
      return segmentMetadata;
    } catch (error) {
      logger.error(`Error adding segment: ${error.message}`);
      throw error;
    }
  }
  
  /**
   * Get a segment by its timestamp
   * @param {number} timestamp - The timestamp of the segment to retrieve
   * @returns {Object|null} - The segment or null if not found
   */
  async getSegmentByTimestamp(timestamp) {
    const metadataObj = this.segmentsByTimestamp.get(timestamp);
    if (!metadataObj) return null;
    
    return this._loadSegmentData(metadataObj);
  }
  
  /**
   * Get the segment closest to a specific timestamp
   * @param {number} targetTime - The target timestamp to find a segment for
   * @returns {Object|null} - The segment closest to the target time or null if buffer is empty
   */
  async getSegmentAt(targetTime) {
    if (this.segments.length === 0) {
      logger.warn('Cannot get segment at time: Buffer is empty');
      return null;
    }
    
    // Check if target time is outside buffer bounds
    const oldest = await this.getOldestSegment();
    const newest = await this.getNewestSegment();
    
    if (!oldest || !newest) {
      logger.warn('Cannot get segment at time: Unable to determine buffer bounds');
      return null;
    }
    
    if (targetTime < oldest.timestamp) {
      logger.warn(`Target time ${new Date(targetTime).toISOString()} is earlier than oldest segment ${oldest.metadata.addedAt}`);
      return oldest;
    }
    
    if (targetTime > newest.timestamp) {
      logger.warn(`Target time ${new Date(targetTime).toISOString()} is later than newest segment ${newest.metadata.addedAt}`);
      return newest;
    }
    
    // If we have an exact match, return it
    const exactMatch = this.segmentsByTimestamp.get(targetTime);
    if (exactMatch) return this._loadSegmentData(exactMatch);
    
    // Binary search to find closest segment
    let left = 0;
    let right = this.segments.length - 1;
    
    while (left <= right) {
      const mid = Math.floor((left + right) / 2);
      const midTimestamp = this.segments[mid].timestamp;
      
      if (midTimestamp === targetTime) {
        return this._loadSegmentData(this.segments[mid]);
      }
      
      if (midTimestamp < targetTime) {
        left = mid + 1;
      } else {
        right = mid - 1;
      }
    }
    
    // At this point, right points to the largest element <= targetTime
    // left points to the smallest element >= targetTime
    // Choose the closest one
    if (right < 0) return this._loadSegmentData(this.segments[0]);
    if (left >= this.segments.length) return this._loadSegmentData(this.segments[this.segments.length - 1]);
    
    const diffRight = targetTime - this.segments[right].timestamp;
    const diffLeft = this.segments[left].timestamp - targetTime;
    
    return this._loadSegmentData(diffRight <= diffLeft ? this.segments[right] : this.segments[left]);
  }
  
  /**
   * Get segments within a time range
   * @param {number} startTime - Start timestamp
   * @param {number} endTime - End timestamp
   * @returns {Array} - Array of segments in the range
   */
  async getSegmentsInRange(startTime, endTime) {
    if (this.segments.length === 0) {
      logger.warn('Cannot get segments in range: Buffer is empty');
      return [];
    }
    
    // Validate time range
    if (startTime > endTime) {
      logger.warn('Invalid time range: startTime > endTime');
      return [];
    }
    
    // Adjust time range to buffer bounds if needed
    const oldest = await this.getOldestSegment();
    const newest = await this.getNewestSegment();
    
    if (!oldest || !newest) {
      logger.warn('Cannot get segments in range: Unable to determine buffer bounds');
      return [];
    }
    
    if (endTime < oldest.timestamp || startTime > newest.timestamp) {
      logger.warn('Requested time range is outside buffer bounds');
      return [];
    }
    
    const effectiveStartTime = Math.max(startTime, oldest.timestamp);
    const effectiveEndTime = Math.min(endTime, newest.timestamp);
    
    // Filter segments in the time range
    const segmentsInRange = this.segments.filter(segment => 
      segment.timestamp >= effectiveStartTime && segment.timestamp <= effectiveEndTime
    );
    
    // Load data for all segments in range
    const loadedSegments = await Promise.all(
      segmentsInRange.map(segment => this._loadSegmentData(segment))
    );
    
    return loadedSegments;
  }
  
  /**
   * Get a segment by its sequence number
   * @param {number} sequenceNumber - The sequence number of the segment to retrieve
   * @returns {Object|null} - The segment or null if not found
   */
  async getSegmentBySequence(sequenceNumber) {
    if (sequenceNumber === undefined || sequenceNumber === null) {
      logger.warn('Invalid sequence number: undefined or null');
      return null;
    }
    
    const segment = this.segmentsBySequence.get(sequenceNumber);
    
    if (!segment) {
      logger.debug(`Segment with sequence ${sequenceNumber} not found in buffer`);
      return null;
    }
    
    return this._loadSegmentData(segment);
  }
  
  /**
   * Get the oldest segment in the buffer
   * @returns {Object|null} - The oldest segment or null if buffer is empty
   */
  async getOldestSegment() {
    if (this.segments.length === 0) {
      logger.warn('Cannot get oldest segment: Buffer is empty');
      return null;
    }
    
    // Find the segment with the lowest timestamp
    const oldest = this.segments.reduce((prev, curr) => 
      (prev.timestamp < curr.timestamp) ? prev : curr
    );
    
    return this._loadSegmentData(oldest);
  }
  
  /**
   * Get the newest segment in the buffer
   * @returns {Object|null} - The newest segment or null if buffer is empty
   */
  async getNewestSegment() {
    if (this.segments.length === 0) {
      logger.warn('Cannot get newest segment: Buffer is empty');
      return null;
    }
    
    // Find the segment with the highest timestamp
    const newest = this.segments.reduce((prev, curr) => 
      (prev.timestamp > curr.timestamp) ? prev : curr
    );
    
    return this._loadSegmentData(newest);
  }
  
  /**
   * Get detailed buffer statistics
   * @returns {Object} - Object containing buffer statistics
   */
  getBufferStats() {
    const segmentCount = this.segments.length;
    const oldestSegment = segmentCount > 0 ? this.segments.reduce((prev, curr) => 
      (prev.timestamp < curr.timestamp) ? prev : curr) : null;
    const newestSegment = segmentCount > 0 ? this.segments.reduce((prev, curr) => 
      (prev.timestamp > curr.timestamp) ? prev : curr) : null;
    
    return {
      segmentCount,
      totalSize: this.totalSize,
      totalDuration: this.totalDuration,
      bufferTimeSpan: oldestSegment && newestSegment ?
        newestSegment.timestamp - oldestSegment.timestamp : 0,
      oldestTimestamp: oldestSegment ? 
        oldestSegment.timestamp : null,
      newestTimestamp: newestSegment ? 
        newestSegment.timestamp : null,
      bufferDuration: this.bufferDuration,
      diskStorageEnabled: this.diskStorageEnabled,
      diskSegments: this.segments.filter(s => s.storedOnDisk).length,
      memorySegments: this.segments.filter(s => !s.storedOnDisk).length
    };
  }
  
  /**
   * Get buffer health status
   * @param {number} minDuration - Minimum buffer duration in seconds to consider healthy
   * @param {number} minSegments - Minimum number of segments to consider healthy
   * @returns {Object} - Health status of the buffer
   */
  getBufferHealth(minDuration = 30, minSegments = 10) {
    const stats = this.getBufferStats();
    
    const health = {
      segmentCount: stats.segmentCount,
      bufferTimeSpan: stats.bufferTimeSpan,
      hasSufficientSegments: stats.segmentCount >= minSegments,
      hasSufficientDuration: stats.totalDuration >= minDuration,
      hasGaps: false, // Determined below
      bufferLevelPercent: Math.min(100, Math.round((stats.totalDuration / minDuration) * 100)),
      diskStorageHealthy: this.diskStorageEnabled
    };
    
    // Buffer is healthy if it has sufficient duration and segments, and no gaps
    health.isHealthy = health.hasSufficientDuration &&
      health.hasSufficientSegments && 
      !health.hasGaps &&
      health.diskStorageHealthy;
    
    return health;
  }
  
  /**
   * Get buffer statistics (DEPRECATED - use getBufferStats instead)
   * @returns {Object} Buffer statistics
   */
  getStats() {
    return this.getBufferStats();
  }
  
  /**
   * Explicitly prune segments older than the buffer duration
   * @returns {number} - The number of segments removed
   */
  async pruneOldSegments() {
    return this._pruneOldSegments();
  }
  
  /**
   * Internal method to remove segments older than the buffer duration
   * @private
   * @returns {number} - The number of segments removed
   */
  async _pruneOldSegments() {
    const now = Date.now();
    const cutoffTime = now - this.bufferDuration;
    
    // Identify segments to remove
    const segmentsToRemove = this.segments.filter(s => s.timestamp < cutoffTime);
    
    if (segmentsToRemove.length === 0) {
      return 0;
    }
    
    logger.debug(`Pruning ${segmentsToRemove.length} segments older than ${new Date(cutoffTime).toISOString()}`);
    
    // Actually remove the segments
    for (const segment of segmentsToRemove) {
      await this._removeSegmentFromBuffer(segment);
    }
    
    // Save updated metadata
    this._saveMetadataToDisk();
    
    return segmentsToRemove.length;
  }
  
  /**
   * Remove a segment from the buffer
   * @param {Object} segment - The segment metadata object to remove
   * @private
   */
  async _removeSegmentFromBuffer(segment) {
    try {
      // Remove from metadata indexes
      this.segmentsByTimestamp.delete(segment.timestamp);
      
      if (segment.metadata.sequenceNumber !== undefined) {
        this.segmentsBySequence.delete(segment.metadata.sequenceNumber);
      }
      
      // Remove from segments array
      const index = this.segments.findIndex(s => s.timestamp === segment.timestamp);
      if (index !== -1) {
        this.segments.splice(index, 1);
      }
      
      // Update stats
      this.totalSize -= segment.size;
      this.totalDuration -= segment.metadata.duration;
      
      // Delete from disk if stored there
      if (segment.storedOnDisk && segment.metadata.segmentId) {
        await diskStorageService.deleteSegment(segment.metadata.segmentId);
      }
      
      logger.debug(`Removed segment: ${segment.metadata.url} (${segment.size} bytes, ${segment.metadata.duration}s)`);
      
      // Emit segment expired event
      this.emit('segmentExpired', {
        segmentId: segment.metadata.url,
        timestamp: segment.timestamp,
        metadata: {
          url: segment.metadata.url,
          sequenceNumber: segment.metadata.sequenceNumber,
          duration: segment.metadata.duration,
          size: segment.size
        }
      });
    } catch (error) {
      logger.error(`Error removing segment from buffer: ${error.message}`);
    }
  }
  
  /**
   * Remove expired segments from the buffer
   * @returns {number} - The number of segments removed
   */
  async removeExpiredSegments() {
    if (this.segments.length === 0) {
      return 0;
    }
    
    const now = Date.now();
    let removedCount = 0;
    
    // Process segments from oldest to newest
    const sortedSegments = [...this.segments].sort((a, b) => a.timestamp - b.timestamp);
    
    for (const segment of sortedSegments) {
      const timestamp = segment.timestamp;
      
      // If segment is older than buffer duration, remove it
      if (now - timestamp > this.bufferDuration) {
        await this._removeSegmentFromBuffer(segment);
        removedCount++;
      } else {
        // Since we're processing from oldest to newest, once we find one
        // that's not expired, we can stop
        break;
      }
    }
    
    if (removedCount > 0) {
      logger.info(`Removed ${removedCount} expired segments from buffer`);
      
      // If we've removed segments, save the updated metadata
      this._saveMetadataToDisk();
    }
    
    return removedCount;
  }
  
  /**
   * Remove a segment from the buffer by ID
   * @param {string} segmentId - The ID of the segment to remove
   * @returns {boolean} - True if the segment was removed, false otherwise
   */
  async removeSegment(segmentId) {
    const segment = this.segments.find(s => s.metadata.segmentId === segmentId);
    
    if (!segment) {
      logger.warn(`Cannot remove segment: ${segmentId} not found in buffer`);
      return false;
    }
    
    await this._removeSegmentFromBuffer(segment);
    
    // Save updated metadata
    this._saveMetadataToDisk();
    
    return true;
  }
  
  /**
   * Clear the buffer
   */
  clear() {
    // If disk storage is enabled, clean up segment files
    if (this.diskStorageEnabled) {
      this._cleanupDiskSegments();
    }
    
    // Clear metadata
    this.segments = [];
    this.segmentsByTimestamp.clear();
    this.segmentsBySequence.clear();
    this.totalSize = 0;
    this.totalDuration = 0;
    
    logger.info('Buffer cleared');
    
    // Save empty metadata
    this._saveMetadataToDisk();
  }
  
  /**
   * Get the timestamp of the oldest segment in the buffer
   * @returns {number|null} - Timestamp of the oldest segment, or null if buffer is empty
   */
  getOldestSegmentTime() {
    try {
      if (this.segments.length === 0) {
        logger.warn('Cannot get oldest segment time: Buffer is empty');
        return null;
      }
      
      // Find the segment with the lowest timestamp
      const oldestSegment = this.segments.reduce((prev, curr) => 
        (prev.timestamp < curr.timestamp) ? prev : curr
      );
      
      return oldestSegment.timestamp;
    } catch (error) {
      logger.error(`Error getting oldest segment time: ${error.message}`);
      return null;
    }
  }
  
  /**
   * Generate a unique ID for a segment based on its metadata
   * @private
   * @param {Object} metadata - The segment metadata
   * @returns {string} - A unique segment ID
   */
  _getSegmentId(metadata) {
    if (metadata.sequenceNumber !== undefined) {
      return `${metadata.sequenceNumber}`;
    }
    
    // Extract filename from URL as fallback
    const urlParts = metadata.url.split('/');
    const filename = urlParts[urlParts.length - 1].split('?')[0];
    
    return `${filename}_${Date.now()}`;
  }
  
  /**
   * Load segment data from disk or memory
   * @private
   * @param {Object} segmentMetadata - The segment metadata object
   * @returns {Object} - The segment with data
   */
  async _loadSegmentData(segmentMetadata) {
    if (!segmentMetadata) {
      return null;
    }
    
    // If data is already in memory, return it
    if (segmentMetadata.data) {
      return segmentMetadata;
    }
    
    // If stored on disk, load from there
    if (segmentMetadata.storedOnDisk && segmentMetadata.metadata.segmentId) {
      try {
        const data = await diskStorageService.readSegment(segmentMetadata.metadata.segmentId);
        
        // Create a new object to avoid modifying the cached metadata
        return {
          ...segmentMetadata,
          data
        };
      } catch (error) {
        logger.error(`Failed to load segment data from disk: ${error.message}`);
        // Return metadata without data
        return segmentMetadata;
      }
    }
    
    // Neither in memory nor on disk - just return metadata
    return segmentMetadata;
  }
  
  /**
   * Save buffer metadata to disk
   * @private
   */
  async _saveMetadataToDisk() {
    if (!this.diskStorageEnabled) {
      return;
    }
    
    try {
      // Create a clean object with only essential metadata
      const segments = [];
      
      for (const segment of this.segments) {
        segments.push({
          timestamp: segment.timestamp,
          metadata: {
            url: segment.metadata.url,
            sequenceNumber: segment.metadata.sequenceNumber,
            duration: segment.metadata.duration || 0,
            segmentId: segment.metadata.segmentId,
            addedAt: segment.metadata.addedAt
          },
          size: segment.size,
          storedOnDisk: segment.storedOnDisk,
          filePath: segment.filePath
        });
      }
      
      // Create a clean metadata object
      const metadataToSave = {
        timestamp: Date.now(),
        segments: segments,
        stats: {
          totalSegments: this.segments.length,
          totalSize: this.totalSize,
          totalDuration: this.totalDuration,
          bufferDuration: this.bufferDuration
        }
      };
      
      // Serialize the clean metadata object
      const serializedMetadata = JSON.stringify(metadataToSave);
      
      // Let the storage service handle the actual writing
      await diskStorageService.writeMetadata(JSON.parse(serializedMetadata));
      
      logger.debug(`Saved buffer metadata with ${metadataToSave.segments.length} segments`);
    } catch (error) {
      logger.error(`Failed to save buffer metadata to disk: ${error.message}`);
    }
  }
  
  /**
   * Load buffer metadata from disk
   * @private
   */
  async _loadMetadataFromDisk() {
    if (!this.diskStorageEnabled) {
      return;
    }
    
    try {
      const metadata = await diskStorageService.readMetadata();
      
      if (!metadata || !metadata.segments) {
        logger.info('No buffer metadata found on disk');
        return;
      }
      
      logger.info(`Loading buffer metadata from disk: ${metadata.segments.length} segments`);
      
      // Reset in-memory state
      this.segments = [];
      this.segmentsByTimestamp.clear();
      this.segmentsBySequence.clear();
      this.totalSize = 0;
      this.totalDuration = 0;
      
      // Check each segment exists on disk before adding to buffer
      for (const segment of metadata.segments) {
        // Only add if the segment exists on disk
        if (segment.storedOnDisk && segment.metadata.segmentId) {
          const exists = await diskStorageService.segmentExists(segment.metadata.segmentId);
          
          if (exists) {
            // Add to in-memory indexes
            this.segments.push(segment);
            this.segmentsByTimestamp.set(segment.timestamp, segment);
            
            if (segment.metadata.sequenceNumber !== undefined) {
              this.segmentsBySequence.set(segment.metadata.sequenceNumber, segment);
            }
            
            // Update stats
            this.totalSize += segment.size;
            this.totalDuration += segment.metadata.duration || 0;
          } else {
            logger.warn(`Segment ${segment.metadata.segmentId} referenced in metadata not found on disk`);
          }
        }
      }
      
      logger.info(`Restored ${this.segments.length} segments from disk metadata`);
      
      // Immediately prune any segments that are now outside the buffer window
      await this._pruneOldSegments();
      
    } catch (error) {
      logger.error(`Failed to load buffer metadata from disk: ${error.message}`);
    }
  }
  
  /**
   * Clean up disk segments
   * @private
   */
  async _cleanupDiskSegments() {
    if (!this.diskStorageEnabled) {
      return;
    }
    
    try {
      // Delete all segments (we'll keep none)
      const deletedCount = await diskStorageService.cleanupSegments(() => false);
      logger.info(`Cleaned up ${deletedCount} segments from disk`);
    } catch (error) {
      logger.error(`Failed to clean up disk segments: ${error.message}`);
    }
  }
}

// Create a singleton instance
const hybridBufferService = new HybridBufferService();

module.exports = {
  hybridBufferService,
  HybridBufferService
}; 