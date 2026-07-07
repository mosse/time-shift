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

    // Metadata persistence is coalesced: mutations set a dirty flag and a
    // single periodic flusher writes the file, so concurrent full-JSON
    // writes can never race each other
    this._metadataDirty = false;
    this._metadataSavePromise = null;
    this._metadataFlushInterval = null;

    // Known holes in the recording (source outage, skipped segments,
    // permanent download failures). First-class data for the health UI.
    // Each: { fromSeq, toSeq, startTime, endTime, reason }
    this.gaps = [];
    
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
    try {
      // Reset state if requested
      if (options.reset) {
        this.clear();
      }
      
      // Update disk storage setting if provided
      if (options.diskStorageEnabled !== undefined) {
        this.diskStorageEnabled = options.diskStorageEnabled;
      }
      
      // Initialize disk storage if enabled
      if (this.diskStorageEnabled) {
        await diskStorageService.initialize();

        // Load existing metadata from disk
        await this._loadMetadataFromDisk();
      }

      // Start periodic expiry and coalesced metadata flushing
      this.setupCleanupInterval();
      this.setupMetadataFlushInterval();
      
      logger.info(`Initialized hybrid buffer service with disk storage ${this.diskStorageEnabled ? 'enabled' : 'disabled'}`);
      
      // Emit initialized event
      this.emit('initialized', {
        diskStorageEnabled: this.diskStorageEnabled,
        segmentCount: this.segments.length,
        totalSize: this.totalSize
      });
      
      return true;
    } catch (error) {
      logger.error(`Failed to initialize hybrid buffer service: ${error.message}`);
      throw error;
    }
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
   * Set up the periodic metadata flush
   * Writes the metadata file at most once per interval, and only when dirty
   */
  setupMetadataFlushInterval(intervalMs = 30000) {
    if (this._metadataFlushInterval) {
      clearInterval(this._metadataFlushInterval);
    }

    this._metadataFlushInterval = setInterval(() => {
      if (this._metadataDirty) {
        this.flushMetadata().catch(error => {
          logger.error(`Periodic metadata flush failed: ${error.message}`);
        });
      }
    }, intervalMs);

    this._metadataFlushInterval.unref();
  }

  /**
   * Mark the in-memory metadata as changed; it will be persisted by the
   * next periodic flush (or an explicit flushMetadata call)
   * @private
   */
  _markMetadataDirty() {
    this._metadataDirty = true;
  }

  /**
   * Persist metadata now. Serializes with any in-flight save so two
   * writers never overlap.
   * @returns {Promise<void>}
   */
  async flushMetadata() {
    if (!this.diskStorageEnabled) {
      return;
    }

    // Wait out any in-flight save before starting a new one
    if (this._metadataSavePromise) {
      await this._metadataSavePromise.catch(() => {});
    }

    this._metadataDirty = false;
    this._metadataSavePromise = this._saveMetadataToDisk().finally(() => {
      this._metadataSavePromise = null;
    });

    return this._metadataSavePromise;
  }

  /**
   * Stop background intervals (cleanup + metadata flush)
   */
  stopIntervals() {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = null;
    }
    if (this._metadataFlushInterval) {
      clearInterval(this._metadataFlushInterval);
      this._metadataFlushInterval = null;
    }
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
        // Guard against filling the disk: evict played-out segments under
        // pressure, and drop the new segment rather than crash on ENOSPC
        const capacity = await diskStorageService.checkCapacity(this.totalSize);
        if (!capacity.ok) {
          logger.warn(`Storage pressure detected (used: ${Math.round(capacity.usedBytes / 1048576)}MB, cap: ${Math.round(capacity.capBytes / 1048576)}MB, free: ${capacity.freeBytes !== null ? Math.round(capacity.freeBytes / 1048576) + 'MB' : 'unknown'})`);
          this.emit('storagePressure', capacity);

          await this._evictForStoragePressure();

          const recheck = await diskStorageService.checkCapacity(this.totalSize, true);
          if (!recheck.ok) {
            const error = new Error('Storage full: segment dropped to protect the process');
            error.code = 'STORAGE_FULL';
            throw error;
          }
        }

        try {
          const filePath = await diskStorageService.writeSegment(segmentId, segmentData);
          segmentMetadata.filePath = filePath;
          segmentMetadata.storedOnDisk = true;
          logger.debug(`Segment ${segmentId} stored on disk: ${filePath}`);
        } catch (error) {
          logger.error(`Failed to write segment to disk: ${error.message}`);
          // A full disk must NOT fall back to memory - that silently
          // balloons RAM until the process dies. Drop the segment instead.
          if (error.code === 'ENOSPC' || /ENOSPC/.test(error.message)) {
            this.emit('storagePressure', { ok: false, lowFree: true, reason: 'ENOSPC' });
            const dropError = new Error('Disk full (ENOSPC): segment dropped');
            dropError.code = 'STORAGE_FULL';
            throw dropError;
          }
          // Other write failures (transient I/O) keep the in-memory fallback
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
      
      // Metadata is persisted by the periodic coalesced flush
      this._markMetadataDirty();

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
   * Record a gap in the recording (missed/skipped segments)
   * @param {Object} gap - { fromSeq, toSeq, startTime, endTime, reason }
   */
  recordGap(gap) {
    if (!gap || !Number.isFinite(gap.startTime) || !Number.isFinite(gap.endTime)) {
      return;
    }

    // Merge with the previous gap if they touch (continued outage)
    const last = this.gaps[this.gaps.length - 1];
    if (last && gap.startTime <= last.endTime + 60000 && gap.reason === last.reason) {
      last.endTime = Math.max(last.endTime, gap.endTime);
      if (Number.isFinite(gap.toSeq)) {
        last.toSeq = Math.max(last.toSeq ?? gap.toSeq, gap.toSeq);
      }
    } else {
      this.gaps.push({ ...gap });
    }

    this._expireOldGaps();
    this._markMetadataDirty();

    logger.warn(`Recorded buffer gap: ${new Date(gap.startTime).toISOString()} -> ${new Date(gap.endTime).toISOString()} (${gap.reason || 'unknown'})`);
    this.emit('gapRecorded', gap);
  }

  /**
   * Get gaps that still fall inside the buffer window
   * @returns {Array<Object>}
   */
  getGaps() {
    this._expireOldGaps();
    return this.gaps.map(g => ({ ...g }));
  }

  /**
   * Drop gaps that have aged out of the buffer window entirely
   * @private
   */
  _expireOldGaps() {
    const cutoff = Date.now() - this.bufferDuration;
    if (this.gaps.length && this.gaps[0].endTime < cutoff) {
      this.gaps = this.gaps.filter(g => g.endTime >= cutoff);
    }
  }

  /**
   * Check that a segment object has the shape the rest of the pipeline
   * relies on (playlist generation reads metadata.sequenceNumber)
   * @param {Object} segment - Segment metadata object
   * @returns {boolean} - True if the segment is usable
   */
  _isValidSegment(segment) {
    return !!(segment &&
      Number.isFinite(segment.timestamp) &&
      segment.metadata &&
      Number.isFinite(segment.metadata.sequenceNumber));
  }

  /**
   * Get the shape-valid segment nearest to a target time
   * Used as a fallback when an anchor segment is missing metadata
   * @param {number} targetTime - The target timestamp
   * @returns {Object|null} - The nearest valid segment metadata or null
   */
  getNearestValidSegment(targetTime) {
    let best = null;
    let bestDiff = Infinity;
    for (const segment of this.segments) {
      if (!this._isValidSegment(segment)) continue;
      const diff = Math.abs(segment.timestamp - targetTime);
      if (diff < bestDiff) {
        best = segment;
        bestDiff = diff;
      }
    }
    return best;
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
      logger.warn(`Target time ${new Date(targetTime).toISOString()} is earlier than oldest segment ${oldest.metadata?.addedAt || new Date(oldest.timestamp).toISOString()}`);
      return oldest;
    }

    if (targetTime > newest.timestamp) {
      logger.warn(`Target time ${new Date(targetTime).toISOString()} is later than newest segment ${newest.metadata?.addedAt || new Date(newest.timestamp).toISOString()}`);
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

    const bufferTimeSpan = oldestSegment && newestSegment ?
      newestSegment.timestamp - oldestSegment.timestamp : 0;

    // Calculate buffer level as percentage of target duration
    const bufferLevelPercent = this.bufferDuration > 0 ?
      Math.min(100, Math.round((bufferTimeSpan / this.bufferDuration) * 100)) : 0;

    return {
      segmentCount,
      totalSize: this.totalSize,
      totalDuration: this.totalDuration,
      bufferTimeSpan,
      bufferLevelPercent,
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

    this._markMetadataDirty();

    return segmentsToRemove.length;
  }
  
  /**
   * Free disk space under storage pressure
   * First evicts segments that are already behind the playback delay
   * (they've been heard, only retained as slack), then if still over the
   * byte cap evicts oldest-first down to 90% of the cap
   * @private
   * @returns {number} - Number of segments evicted
   */
  async _evictForStoragePressure() {
    const now = Date.now();
    const playedCutoff = now - (config.DELAY_DURATION + 5 * 60 * 1000);
    let evicted = 0;

    // Pass 1: segments already behind the playhead
    const played = this.segments.filter(s => s.timestamp < playedCutoff);
    for (const segment of played) {
      await this._removeSegmentFromBuffer(segment);
      evicted++;
    }

    // Pass 2: if still over the byte cap, evict oldest-first to 90% of cap
    const capBytes = config.STORAGE.MAX_STORAGE_BYTES;
    if (capBytes > 0 && this.totalSize >= capBytes) {
      const targetBytes = Math.floor(capBytes * 0.9);
      const oldestFirst = [...this.segments].sort((a, b) => a.timestamp - b.timestamp);
      for (const segment of oldestFirst) {
        if (this.totalSize <= targetBytes) break;
        await this._removeSegmentFromBuffer(segment);
        evicted++;
      }
    }

    if (evicted > 0) {
      logger.warn(`Storage pressure: evicted ${evicted} segments to free space`);
      this._markMetadataDirty();
    }

    return evicted;
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
      this._markMetadataDirty();
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

    this._markMetadataDirty();

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

    // Persist the now-empty state promptly
    this._markMetadataDirty();
    this.flushMetadata().catch(error => {
      logger.error(`Failed to persist cleared buffer state: ${error.message}`);
    });
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
        gaps: this.gaps,
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
   * Scans all segment files on disk and rebuilds the buffer
   * @private
   */
  async _loadMetadataFromDisk() {
    if (!this.diskStorageEnabled) {
      return;
    }

    try {
      // Get all segment files from disk
      const segmentIds = await diskStorageService.listSegments();

      if (segmentIds.length === 0) {
        logger.info('No segments found on disk');
        return;
      }

      logger.info(`Found ${segmentIds.length} segment files on disk, rebuilding buffer...`);

      // Reset in-memory state
      this.segments = [];
      this.segmentsByTimestamp.clear();
      this.segmentsBySequence.clear();
      this.totalSize = 0;
      this.totalDuration = 0;

      // Load existing metadata for additional info (like duration)
      const metadata = await diskStorageService.readMetadata();
      const metadataMap = new Map();
      if (metadata?.segments) {
        for (const seg of metadata.segments) {
          const id = seg.metadata?.segmentId;
          if (id) metadataMap.set(id, seg);
        }
      }

      // Restore recorded gaps that are still inside the buffer window
      if (Array.isArray(metadata?.gaps)) {
        const cutoff = Date.now() - this.bufferDuration;
        this.gaps = metadata.gaps.filter(
          g => g && Number.isFinite(g.endTime) && g.endTime >= cutoff
        );
        if (this.gaps.length > 0) {
          logger.info(`Restored ${this.gaps.length} recorded buffer gaps`);
        }
      }

      // Parse sequence numbers and sort
      const segmentsWithSeq = segmentIds
        .map(id => ({
          segmentId: id,
          sequenceNumber: parseInt(id, 10)
        }))
        .filter(s => !isNaN(s.sequenceNumber))
        .sort((a, b) => a.sequenceNumber - b.sequenceNumber);

      if (segmentsWithSeq.length === 0) {
        logger.warn('No valid segment files found on disk');
        return;
      }

      // Default segment duration (will be updated from metadata if available)
      const defaultDuration = 6.4; // seconds, typical HLS segment length

      // Calibrate timestamps using the live HLS stream as reference
      // The live stream's newest sequence number represents "now"
      const now = Date.now();
      const newestSeq = segmentsWithSeq[segmentsWithSeq.length - 1].sequenceNumber;

      // Try to get the live sequence number for accurate calibration
      let liveSeq = null;
      try {
        const fetch = globalThis.fetch || (await import('node-fetch')).default;
        // Use the configured stream URL, not a hardcoded station
        const livePlaylistUrl = config.STREAM_URLS.AKAMAI;
        const response = await fetch(livePlaylistUrl, { timeout: 5000 });
        if (response.ok) {
          const playlist = await response.text();
          // Extract the highest sequence number from the playlist
          const matches = playlist.match(/-(\d+)\.ts/g) || [];
          if (matches.length > 0) {
            const lastMatch = matches[matches.length - 1];
            liveSeq = parseInt(lastMatch.match(/(\d+)\.ts/)[1], 10);
            logger.info(`Calibrating buffer timestamps using live sequence: ${liveSeq}`);
          }
        }
      } catch (e) {
        logger.warn(`Could not fetch live playlist for calibration: ${e.message}`);
      }

      // Use live sequence as reference (represents "now"), or fall back to our newest
      const referenceSeq = liveSeq || newestSeq;
      const referenceTimestamp = now;

      for (const { segmentId, sequenceNumber } of segmentsWithSeq) {
        // Check if we have metadata for this segment
        const existingMeta = metadataMap.get(segmentId);
        const duration = existingMeta?.metadata?.duration || defaultDuration;

        // Calculate timestamp based on sequence difference from live reference
        const seqDiff = referenceSeq - sequenceNumber;
        const timestamp = referenceTimestamp - (seqDiff * duration * 1000);

        // Skip if segment would be outside buffer window
        if (now - timestamp > this.bufferDuration) {
          continue;
        }

        // Get file size from disk
        let size = existingMeta?.size || 0;
        if (!size) {
          try {
            const fs = require('fs').promises;
            const filePath = path.join(diskStorageService.segmentsPath, `${segmentId}.ts`);
            const stats = await fs.stat(filePath);
            size = stats.size;
          } catch (e) {
            size = 0;
          }
        }

        // Create segment object
        const cleanSegment = {
          timestamp,
          metadata: {
            url: existingMeta?.metadata?.url || `segment://${segmentId}`,
            sequenceNumber,
            duration,
            segmentId,
            addedAt: new Date(timestamp).toISOString()
          },
          size,
          storedOnDisk: true,
          filePath: path.join(diskStorageService.segmentsPath, `${segmentId}.ts`)
        };

        // Add to in-memory indexes
        this.segments.push(cleanSegment);
        this.segmentsByTimestamp.set(cleanSegment.timestamp, cleanSegment);
        this.segmentsBySequence.set(sequenceNumber, cleanSegment);

        // Update stats
        this.totalSize += cleanSegment.size;
        this.totalDuration += cleanSegment.metadata.duration;
      }

      // Sort segments by timestamp
      this.segments.sort((a, b) => a.timestamp - b.timestamp);

      // Derive gaps from missing sequence numbers in the restored buffer
      // (covers downtime while the process wasn't running to record them)
      const restoredGaps = [];
      for (let i = 1; i < this.segments.length; i++) {
        const prev = this.segments[i - 1];
        const curr = this.segments[i];
        const seqJump = curr.metadata.sequenceNumber - prev.metadata.sequenceNumber;
        if (seqJump > 1) {
          restoredGaps.push({
            fromSeq: prev.metadata.sequenceNumber + 1,
            toSeq: curr.metadata.sequenceNumber - 1,
            startTime: prev.timestamp + (prev.metadata.duration || 6.4) * 1000,
            endTime: curr.timestamp,
            reason: 'restore-missing-sequences'
          });
        }
      }
      for (const gap of restoredGaps) {
        // Skip if an overlapping gap is already recorded
        const overlaps = this.gaps.some(
          g => gap.startTime < g.endTime && gap.endTime > g.startTime
        );
        if (!overlaps) {
          this.gaps.push(gap);
        }
      }
      if (restoredGaps.length > 0) {
        this.gaps.sort((a, b) => a.startTime - b.startTime);
        logger.info(`Derived ${restoredGaps.length} gaps from missing sequences during restore`);
      }

      const bufferSpanHours = (this.totalDuration / 3600).toFixed(2);
      logger.info(`Restored ${this.segments.length} segments from disk (${bufferSpanHours} hours of audio)`);

      // Save the rebuilt metadata
      this._markMetadataDirty();
      await this.flushMetadata();

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