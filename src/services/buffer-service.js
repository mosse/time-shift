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
    this.segmentsBySequence = new Map();
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
      
      // Add to sequence index if sequence number is provided
      if (metadata.sequenceNumber !== undefined) {
        this.segmentsBySequence.set(metadata.sequenceNumber, segment);
      }
      
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
   * Get the segment closest to a specific timestamp
   * @param {number} targetTime - The target timestamp to find a segment for
   * @returns {Object|null} - The segment closest to the target time or null if buffer is empty
   */
  getSegmentAt(targetTime) {
    if (this.segments.length === 0) {
      logger.warn('Cannot get segment at time: Buffer is empty');
      return null;
    }
    
    // Check if target time is outside buffer bounds
    const oldest = this.getOldestSegment();
    const newest = this.getNewestSegment();
    
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
    if (exactMatch) return exactMatch;
    
    // Binary search to find closest segment
    let left = 0;
    let right = this.segments.length - 1;
    
    while (left <= right) {
      const mid = Math.floor((left + right) / 2);
      const midTimestamp = this.segments[mid].timestamp;
      
      if (midTimestamp === targetTime) {
        return this.segments[mid];
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
    if (right < 0) return this.segments[0];
    if (left >= this.segments.length) return this.segments[this.segments.length - 1];
    
    const diffRight = targetTime - this.segments[right].timestamp;
    const diffLeft = this.segments[left].timestamp - targetTime;
    
    return diffRight <= diffLeft ? this.segments[right] : this.segments[left];
  }
  
  /**
   * Get segments within a time range
   * @param {number} startTime - Start timestamp
   * @param {number} endTime - End timestamp
   * @returns {Array} - Array of segments in the range
   */
  getSegmentsInRange(startTime, endTime) {
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
    const oldest = this.getOldestSegment();
    const newest = this.getNewestSegment();
    
    if (endTime < oldest.timestamp || startTime > newest.timestamp) {
      logger.warn('Requested time range is outside buffer bounds');
      return [];
    }
    
    const effectiveStartTime = Math.max(startTime, oldest.timestamp);
    const effectiveEndTime = Math.min(endTime, newest.timestamp);
    
    return this.segments.filter(segment => 
      segment.timestamp >= effectiveStartTime && segment.timestamp <= effectiveEndTime
    );
  }
  
  /**
   * Get a segment by its sequence number
   * @param {number} sequenceNumber - The sequence number of the segment to retrieve
   * @returns {Object|null} - The segment or null if not found
   */
  getSegmentBySequence(sequenceNumber) {
    if (sequenceNumber === undefined || sequenceNumber === null) {
      logger.warn('Invalid sequence number: undefined or null');
      return null;
    }
    
    const segment = this.segmentsBySequence.get(sequenceNumber);
    
    if (!segment) {
      logger.warn(`Segment with sequence number ${sequenceNumber} not found`);
    }
    
    return segment || null;
  }
  
  /**
   * Get the oldest segment in the buffer
   * @returns {Object|null} - The oldest segment or null if buffer is empty
   */
  getOldestSegment() {
    if (this.segments.length === 0) {
      logger.warn('Cannot get oldest segment: Buffer is empty');
      return null;
    }
    return this.segments[0];
  }
  
  /**
   * Get the newest segment in the buffer
   * @returns {Object|null} - The newest segment or null if buffer is empty
   */
  getNewestSegment() {
    if (this.segments.length === 0) {
      logger.warn('Cannot get newest segment: Buffer is empty');
      return null;
    }
    return this.segments[this.segments.length - 1];
  }
  
  /**
   * Get detailed buffer statistics
   * @returns {Object} - Object containing buffer statistics
   */
  getBufferStats() {
    const oldestSegment = this.getOldestSegment();
    const newestSegment = this.getNewestSegment();
    
    const stats = {
      segmentCount: this.segments.length,
      totalSize: this.totalSize,
      totalDuration: this.totalDuration,
      bufferTimeSpan: oldestSegment && newestSegment ? 
        newestSegment.timestamp - oldestSegment.timestamp : 0,
      oldestTimestamp: oldestSegment ? oldestSegment.timestamp : null,
      newestTimestamp: newestSegment ? newestSegment.timestamp : null,
      bufferDuration: this.bufferDuration,
      memoryUsageBytes: this.totalSize,
      memoryUsageMB: Math.round((this.totalSize / (1024 * 1024)) * 100) / 100,
      sequenceRange: {
        start: null,
        end: null,
        gapCount: 0
      },
      isEmpty: this.segments.length === 0
    };
    
    // Calculate sequence range and gaps if we have segments
    if (this.segments.length > 0) {
      const sequenceNumbers = this.segments.map(s => s.metadata.sequenceNumber).sort((a, b) => a - b);
      stats.sequenceRange.start = sequenceNumbers[0];
      stats.sequenceRange.end = sequenceNumbers[sequenceNumbers.length - 1];
      
      // Count gaps in sequence
      for (let i = 1; i < sequenceNumbers.length; i++) {
        if (sequenceNumbers[i] - sequenceNumbers[i-1] > 1) {
          stats.sequenceRange.gapCount++;
        }
      }
    }
    
    return stats;
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
      isHealthy: false,
      hasSufficientDuration: stats.totalDuration >= minDuration,
      hasSufficientSegments: stats.segmentCount >= minSegments,
      hasSequenceGaps: stats.sequenceRange.gapCount > 0,
      bufferLevelPercent: Math.min(100, Math.round((stats.totalDuration / minDuration) * 100)),
      details: stats
    };
    
    // Buffer is healthy if it has sufficient duration and segments, and no gaps
    health.isHealthy = health.hasSufficientDuration && 
                       health.hasSufficientSegments && 
                       !health.hasSequenceGaps;
    
    return health;
  }
  
  /**
   * Get the current buffer statistics
   * @returns {Object} - Object containing buffer statistics
   * @deprecated Use getBufferStats() instead
   */
  getStats() {
    logger.warn('getStats() is deprecated, use getBufferStats() instead');
    return this.getBufferStats();
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
      if (segment.metadata.sequenceNumber !== undefined) {
        this.segmentsBySequence.delete(segment.metadata.sequenceNumber);
      }
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
    this.segmentsBySequence.clear();
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