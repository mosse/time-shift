const config = require('../config/config');
const logger = require('../utils/logger');

/**
 * Buffer service for storing and managing media segments
 * Implements a circular buffer with timestamp-based access
 */
class BufferService {
  constructor(bufferDuration = config.BUFFER_DURATION) {
    this.bufferDuration = bufferDuration;
    this.segments = [];
    this.segmentsByTimestamp = new Map();
    this.totalSize = 0;
    this.totalDuration = 0;
    
    logger.info(`Initialized buffer service with duration: ${bufferDuration}ms`);
  }
  
  /**
   * Add a new segment to the buffer
   * @param {Buffer|ArrayBuffer} segmentData - The binary data of the segment
   * @param {Object} metadata - Metadata about the segment
   * @param {string} metadata.url - The URL the segment was fetched from
   * @param {number} metadata.sequenceNumber - The sequence number in the playlist
   * @param {number} metadata.duration - The duration of the segment in seconds
   * @returns {Object} - The stored segment object
   */
  addSegment(segmentData, metadata) {
    try {
      if (!segmentData) {
        throw new Error('Segment data is required');
      }
      
      if (!metadata || !metadata.url) {
        throw new Error('Segment metadata with URL is required');
      }
      
      const timestamp = Date.now();
      const segment = {
        data: segmentData,
        timestamp,
        metadata: {
          ...metadata,
          duration: metadata.duration || 0,
          sequenceNumber: metadata.sequenceNumber || 0,
          addedAt: new Date(timestamp).toISOString()
        },
        size: segmentData.byteLength || segmentData.length || 0
      };
      
      // Add to buffer
      this.segments.push(segment);
      this.segmentsByTimestamp.set(timestamp, segment);
      
      // Update stats
      this.totalSize += segment.size;
      this.totalDuration += segment.metadata.duration;
      
      logger.debug(`Added segment: ${metadata.url} (${segment.size} bytes, ${segment.metadata.duration}s)`);
      
      // Prune old segments if needed
      this._pruneOldSegments();
      
      return segment;
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
  getSegmentByTimestamp(timestamp) {
    return this.segmentsByTimestamp.get(timestamp) || null;
  }
  
  /**
   * Get segments within a time range
   * @param {number} startTime - Start timestamp
   * @param {number} endTime - End timestamp
   * @returns {Array} - Array of segments in the range
   */
  getSegmentsInRange(startTime, endTime) {
    return this.segments.filter(segment => 
      segment.timestamp >= startTime && segment.timestamp <= endTime
    );
  }
  
  /**
   * Get the oldest segment in the buffer
   * @returns {Object|null} - The oldest segment or null if buffer is empty
   */
  getOldestSegment() {
    if (this.segments.length === 0) return null;
    return this.segments[0];
  }
  
  /**
   * Get the newest segment in the buffer
   * @returns {Object|null} - The newest segment or null if buffer is empty
   */
  getNewestSegment() {
    if (this.segments.length === 0) return null;
    return this.segments[this.segments.length - 1];
  }
  
  /**
   * Get the current buffer statistics
   * @returns {Object} - Object containing buffer statistics
   */
  getStats() {
    const oldestSegment = this.getOldestSegment();
    const newestSegment = this.getNewestSegment();
    
    return {
      segmentCount: this.segments.length,
      totalSize: this.totalSize,
      totalDuration: this.totalDuration,
      bufferTimeSpan: oldestSegment && newestSegment ? 
        newestSegment.timestamp - oldestSegment.timestamp : 0,
      oldestTimestamp: oldestSegment ? oldestSegment.timestamp : null,
      newestTimestamp: newestSegment ? newestSegment.timestamp : null,
      bufferDuration: this.bufferDuration
    };
  }
  
  /**
   * Explicitly prune segments older than the buffer duration
   * @returns {number} - Number of segments pruned
   */
  pruneOldSegments() {
    return this._pruneOldSegments();
  }
  
  /**
   * Internal method to remove segments older than the buffer duration
   * @private
   * @returns {number} - Number of segments pruned
   */
  _pruneOldSegments() {
    const now = Date.now();
    const cutoffTime = now - this.bufferDuration;
    const initialCount = this.segments.length;
    
    // Find segments to remove
    const segmentsToRemove = [];
    let index = 0;
    
    while (index < this.segments.length && this.segments[index].timestamp < cutoffTime) {
      segmentsToRemove.push(this.segments[index]);
      index++;
    }
    
    if (segmentsToRemove.length === 0) {
      return 0;
    }
    
    // Remove segments
    this.segments.splice(0, segmentsToRemove.length);
    
    // Update maps and totals
    for (const segment of segmentsToRemove) {
      this.segmentsByTimestamp.delete(segment.timestamp);
      this.totalSize -= segment.size;
      this.totalDuration -= segment.metadata.duration;
    }
    
    logger.info(`Pruned ${segmentsToRemove.length} segments older than ${new Date(cutoffTime).toISOString()}`);
    
    return segmentsToRemove.length;
  }
  
  /**
   * Clear all segments from the buffer
   */
  clear() {
    this.segments = [];
    this.segmentsByTimestamp.clear();
    this.totalSize = 0;
    this.totalDuration = 0;
    logger.info('Buffer cleared');
  }
}

// Export a singleton instance
const bufferService = new BufferService();

module.exports = {
  bufferService,
  BufferService // Export class for testing or custom instances
}; 