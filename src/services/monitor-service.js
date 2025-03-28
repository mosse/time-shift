const EventEmitter = require('events');
const playlistService = require('./playlist-service');
const config = require('../config/config');
const logger = require('../utils/logger');

/**
 * Playlist Monitor Service
 * Periodically fetches HLS playlists and identifies new segments
 * Emits events when new segments are found
 */
class MonitorService extends EventEmitter {
  constructor(options = {}) {
    super();
    
    // Configuration
    this.url = options.url || config.STREAM_URLS.AKAMAI;
    this.interval = options.interval || 10000; // Default: 10 seconds
    this.maxConsecutiveErrors = options.maxConsecutiveErrors || 5;
    this.retryDelay = options.retryDelay || 5000; // Default: 5 seconds
    
    // State
    this.isRunning = false;
    this.intervalId = null;
    this.knownSegments = new Set(); // Track known segment URLs
    this.lastSequence = -1; // Track the last sequence number
    this.errorCount = 0;
    this.lastFetchTime = null;
    this.activeFetch = null; // For tracking in-progress fetches
    
    // Bind methods to preserve 'this' context
    this.fetchPlaylist = this.fetchPlaylist.bind(this);
    this.stopMonitoring = this.stopMonitoring.bind(this);
    
    logger.info(`Initialized playlist monitor service with interval: ${this.interval}ms, URL: ${this.url}`);
  }
  
  /**
   * Start monitoring the playlist
   * @param {Object} [options] - Start options
   * @param {boolean} [options.immediate=true] - Whether to fetch immediately
   * @returns {boolean} - Success status
   */
  startMonitoring(options = { immediate: true }) {
    if (this.isRunning) {
      logger.warn('Monitor is already running');
      return false;
    }
    
    // Register signal handlers
    this.registerSignalHandlers();
    
    // Reset error count
    this.errorCount = 0;
    this.isRunning = true;
    
    logger.info(`Starting playlist monitor for URL: ${this.url}`);
    
    // Fetch immediately if requested
    if (options.immediate) {
      this.fetchPlaylist().catch(error => {
        logger.error(`Initial playlist fetch failed: ${error.message}`);
      });
    }
    
    // Set up interval for periodic fetching
    this.intervalId = setInterval(async () => {
      try {
        await this.fetchPlaylist();
      } catch (error) {
        logger.error(`Periodic playlist fetch failed: ${error.message}`);
      }
    }, this.interval);
    
    // Emit 'started' event
    this.emit('started', { url: this.url, interval: this.interval });
    
    return true;
  }
  
  /**
   * Stop monitoring the playlist
   * @returns {boolean} - Success status
   */
  stopMonitoring() {
    if (!this.isRunning) {
      logger.warn('Monitor is not running');
      return false;
    }
    
    logger.info('Stopping playlist monitor');
    
    // Clear interval
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
    
    // Cancel any active fetch
    if (this.activeFetch && this.activeFetch.cancel) {
      this.activeFetch.cancel();
      this.activeFetch = null;
    }
    
    this.isRunning = false;
    
    // Emit 'stopped' event
    this.emit('stopped', { url: this.url, knownSegmentsCount: this.knownSegments.size });
    
    return true;
  }
  
  /**
   * Fetch the playlist and process new segments
   * @param {boolean} [checkRunning=true] - Whether to check if the monitor is running
   * @returns {Promise<Object>} - Fetch result
   */
  async fetchPlaylist(checkRunning = false) {
    if (checkRunning && !this.isRunning) {
      return { success: false, error: 'Monitor is not running' };
    }
    
    const startTime = Date.now();
    this.lastFetchTime = startTime;
    
    try {
      // Fetch the playlist
      const playlistContent = await playlistService.fetchPlaylist(this.url);
      
      // Parse the playlist
      const parsedPlaylist = playlistService.parsePlaylist(playlistContent);
      
      // Get playlist info
      const playlistInfo = playlistService.getPlaylistInfo(parsedPlaylist);
      
      // Get segment URLs
      const segmentUrls = playlistService.getSegmentUrls(parsedPlaylist, this.url);
      
      // Process new segments
      const newSegments = this.identifyNewSegments(segmentUrls, parsedPlaylist);
      
      // Reset error count on success
      this.errorCount = 0;
      
      const result = {
        success: true,
        playlistInfo,
        newSegmentsCount: newSegments.length,
        totalSegmentsCount: segmentUrls.length,
        durationMs: Date.now() - startTime
      };
      
      logger.debug(`Playlist fetch completed in ${result.durationMs}ms, found ${result.newSegmentsCount} new segments`);
      
      // Emit 'fetched' event
      this.emit('fetched', result);
      
      return result;
    } catch (error) {
      this.errorCount++;
      
      const errorInfo = {
        success: false,
        error: error.message,
        errorCount: this.errorCount,
        durationMs: Date.now() - startTime
      };
      
      logger.error(`Playlist fetch failed (attempt ${this.errorCount}): ${error.message}`);
      
      // Emit 'error' event
      this.emit('error', errorInfo);
      
      // If too many consecutive errors, stop monitoring or retry with delay
      if (this.errorCount >= this.maxConsecutiveErrors) {
        logger.error(`Max consecutive errors (${this.maxConsecutiveErrors}) reached, pausing monitor`);
        
        // Clear current interval
        if (this.intervalId) {
          clearInterval(this.intervalId);
          this.intervalId = null;
        }
        
        // Emit 'maxErrorsReached' event
        this.emit('maxErrorsReached', { errorCount: this.errorCount });
        
        // Attempt to restart after delay
        setTimeout(() => {
          if (this.isRunning) {
            logger.info(`Attempting to restart monitor after ${this.retryDelay}ms delay`);
            this.errorCount = 0;
            this.startMonitoring({ immediate: true });
          }
        }, this.retryDelay);
      }
      
      return errorInfo;
    }
  }
  
  /**
   * Identify new segments from a list of segment URLs
   * @param {Array<string>} segmentUrls - List of segment URLs
   * @param {Object} parsedPlaylist - Parsed playlist object
   * @returns {Array<Object>} - Array of new segment objects
   */
  identifyNewSegments(segmentUrls, parsedPlaylist) {
    const newSegments = [];
    
    // Process segments to identify new ones
    segmentUrls.forEach((url, index) => {
      // Skip if we already know about this segment
      if (this.knownSegments.has(url)) {
        return;
      }
      
      // Create segment info
      const segmentInfo = {
        url,
        index,
        sequenceNumber: parsedPlaylist.mediaSequence + index,
        discoveredAt: Date.now()
      };
      
      // Add to known segments
      this.knownSegments.add(url);
      
      // Add segment duration if available
      if (parsedPlaylist.segments && parsedPlaylist.segments[index]) {
        segmentInfo.duration = parsedPlaylist.segments[index].duration;
      }
      
      // Add to new segments list
      newSegments.push(segmentInfo);
      
      // Update last sequence
      this.lastSequence = Math.max(this.lastSequence, segmentInfo.sequenceNumber);
      
      // Emit 'newSegment' event for each new segment
      this.emit('newSegment', segmentInfo);
    });
    
    // Track sequence discontinuity
    if (parsedPlaylist.mediaSequence && this.lastSequence !== -1) {
      const expectedSequence = this.lastSequence + 1;
      if (parsedPlaylist.mediaSequence > expectedSequence) {
        const skippedCount = parsedPlaylist.mediaSequence - expectedSequence;
        logger.warn(`Sequence discontinuity detected: Expected ${expectedSequence}, got ${parsedPlaylist.mediaSequence} (${skippedCount} segments skipped)`);
        
        // Emit 'discontinuity' event
        this.emit('discontinuity', {
          expected: expectedSequence,
          actual: parsedPlaylist.mediaSequence,
          skippedCount
        });
      }
    }
    
    // If multiple new segments found, also emit a batch event
    if (newSegments.length > 0) {
      this.emit('newSegments', {
        segments: newSegments,
        count: newSegments.length
      });
      
      logger.info(`Found ${newSegments.length} new segments`);
    }
    
    return newSegments;
  }
  
  /**
   * Register handlers for process termination signals
   */
  registerSignalHandlers() {
    // Handle graceful shutdown
    const handleShutdown = (signal) => {
      logger.info(`Received ${signal}, shutting down playlist monitor...`);
      this.stopMonitoring();
      
      // Don't exit the process, just clean up this service
    };
    
    // Register signal handlers if not already registered
    if (!this._signalsRegistered) {
      process.on('SIGTERM', () => handleShutdown('SIGTERM'));
      process.on('SIGINT', () => handleShutdown('SIGINT'));
      this._signalsRegistered = true;
    }
  }
  
  /**
   * Get monitor status
   * @returns {Object} - Status object
   */
  getStatus() {
    return {
      isRunning: this.isRunning,
      url: this.url,
      interval: this.interval,
      knownSegmentsCount: this.knownSegments.size,
      lastSequence: this.lastSequence,
      errorCount: this.errorCount,
      lastFetchTime: this.lastFetchTime,
      uptime: this.lastFetchTime ? Date.now() - this.lastFetchTime : 0
    };
  }
  
  /**
   * Clear the known segments set
   */
  clearKnownSegments() {
    const previousCount = this.knownSegments.size;
    this.knownSegments.clear();
    logger.info(`Cleared ${previousCount} known segments from monitor state`);
  }
}

// Export singleton instance
const monitorService = new MonitorService();

module.exports = {
  monitorService,
  MonitorService
}; 