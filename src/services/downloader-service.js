const axios = require('axios');
const EventEmitter = require('events');
const logger = require('../utils/logger');
const { bufferService } = require('./buffer-service');

/**
 * Enhanced Segment Downloader Service with retry logic, event emissions, and full integration
 * Handles downloading of HLS segments and storing them in the buffer
 */
class DownloaderService extends EventEmitter {
  constructor() {
    super();
    
    // Defaults
    this.maxRetries = 3;
    this.retryDelayBase = 1000; // Base delay in ms
    this.maxRetryDelay = 30000; // Max delay in ms
    this.maxConcurrentDownloads = 3;
    this.downloadHistory = new Map(); // Maps URLs to download results
    this.downloadQueue = [];
    this.activeDownloads = 0;
    this.bufferService = null;
    this.isInitialized = false;
    this.pendingDownloads = new Set(); // Track in-progress downloads
    
    // Statistics
    this.stats = {
      totalDownloads: 0,
      successfulDownloads: 0,
      failedDownloads: 0,
      skippedDownloads: 0,
      totalBytes: 0,
      downloadTimes: [], // Array of download times in ms
      bandwidthMeasurements: [], // Array of bandwidth measurements in kbps
      errorsByCategory: {
        network: 0,
        server: 0,
        client: 0,
        timeout: 0,
        content: 0,
        unknown: 0
      }
    };
    
    logger.info('Initialized downloader service');
  }
  
  /**
   * Initialize the downloader service
   * @param {Object} [options] - Configuration options
   */
  initialize(options = {}) {
    this.maxRetries = options.maxRetries || this.maxRetries;
    this.retryDelayBase = options.retryDelayBase || this.retryDelayBase;
    this.maxRetryDelay = options.maxRetryDelay || this.maxRetryDelay;
    this.maxConcurrentDownloads = options.maxConcurrentDownloads || this.maxConcurrentDownloads;
    
    // Set buffer service reference
    this.bufferService = options.bufferService || bufferService;
    
    this.isInitialized = true;
    
    logger.info(`Downloader service initialized with maxRetries: ${this.maxRetries}, maxConcurrentDownloads: ${this.maxConcurrentDownloads}`);
    
    // Reset statistics
    this.resetStats();
    return this;
  }
  
  /**
   * Reset download statistics
   */
  resetStats() {
    this.stats = {
      totalDownloads: 0,
      successfulDownloads: 0,
      failedDownloads: 0,
      skippedDownloads: 0,
      totalBytes: 0,
      downloadTimes: [],
      bandwidthMeasurements: [],
      errorsByCategory: {
        network: 0,
        server: 0,
        client: 0,
        timeout: 0,
        content: 0,
        unknown: 0
      }
    };
    
    logger.info('Download statistics reset');
  }
  
  /**
   * Clear download history
   */
  clearDownloadHistory() {
    this.downloadHistory.clear();
    logger.info('Download history cleared');
  }
  
  /**
   * Check if a segment has already been downloaded
   * @param {string} url - Segment URL
   * @returns {boolean} - True if the segment has been downloaded
   */
  hasDownloadedSegment(url) {
    return this.downloadHistory.has(url);
  }
  
  /**
   * Download a segment
   * @param {string} url - Segment URL
   * @param {Object} [metadata] - Additional metadata about the segment
   * @param {Object} [options] - Download options
   * @returns {Promise<Object>} - Download result
   */
  async downloadSegment(url, metadata = {}, options = {}) {
    if (!this.isInitialized) {
      throw new Error('Downloader service not initialized');
    }
    
    const reqId = `req_${Date.now()}_${Math.floor(Math.random() * 1000)}`;
    
    // Check if already downloaded
    if (!options.force && this.hasDownloadedSegment(url)) {
      const cachedResult = this.downloadHistory.get(url);
      logger.info(`[${reqId}] Segment already downloaded: ${url}`);
      
      this.stats.skippedDownloads++;
      
      // Emit reused event
      this.emit('segmentReused', {
        url,
        size: cachedResult.size,
        metadata
      });
      
      return {
        success: true,
        fromCache: true,
        size: cachedResult.size,
        metadata
      };
    }
    
    // Handle queue if we're at max concurrent downloads
    if (this.activeDownloads >= this.maxConcurrentDownloads) {
      logger.debug(`[${reqId}] Maximum concurrent downloads reached (${this.activeDownloads}/${this.maxConcurrentDownloads}), queueing: ${url}`);
      
      // Return a promise that resolves when the download is processed from the queue
      return new Promise((resolve) => {
        this.downloadQueue.push({
          url,
          metadata,
          options,
          resolve
        });
        
        this.emit('downloadQueued', {
          url,
          queueLength: this.downloadQueue.length
        });
      });
    }
    
    // Start the download
    try {
      this.activeDownloads++;
      this.stats.totalDownloads++;
      
      const downloadPromise = this._downloadWithRetry(url, metadata, options, reqId);
      this.pendingDownloads.add(downloadPromise);
      
      // Process the next item in the queue when this download finishes
      downloadPromise.finally(() => {
        this.activeDownloads--;
        this.pendingDownloads.delete(downloadPromise);
        this._processNextQueuedDownload();
      });
      
      return await downloadPromise;
    } catch (error) {
      this.activeDownloads--;
      
      // Process the next item in the queue even if this one failed
      this._processNextQueuedDownload();
      
      throw error;
    }
  }
  
  /**
   * Process the next download in the queue
   * @private
   */
  _processNextQueuedDownload() {
    if (this.downloadQueue.length > 0 && this.activeDownloads < this.maxConcurrentDownloads) {
      const nextDownload = this.downloadQueue.shift();
      
      // Start the download and resolve the original promise with the result
      this.downloadSegment(nextDownload.url, nextDownload.metadata, nextDownload.options)
        .then(result => nextDownload.resolve(result))
        .catch(error => nextDownload.resolve({
          success: false,
          error: error.message,
          metadata: nextDownload.metadata
        }));
    }
  }
  
  /**
   * Download a segment with retry logic
   * @param {string} url - Segment URL
   * @param {Object} metadata - Additional metadata
   * @param {Object} options - Download options
   * @param {string} reqId - Request ID for logging
   * @returns {Promise<Object>} - Download result
   * @private
   */
  async _downloadWithRetry(url, metadata, options, reqId) {
    let retryCount = 0;
    let lastError = null;
    let partialData = null;
    let partialSize = 0;
    
    logger.info(`[${reqId}] Starting download: ${url}`);
    
    while (retryCount <= this.maxRetries) {
      try {
        const startTime = Date.now();
        
        // Set up request headers and options
        const requestConfig = {
          responseType: 'arraybuffer',
          timeout: options.timeout || 30000,
          headers: {}
        };
        
        // If we have partial data, use Range header to resume download
        if (partialData) {
          requestConfig.headers.Range = `bytes=${partialSize}-`;
          logger.info(`[${reqId}] Resuming download from byte ${partialSize}`);
        }
        
        // Make the request
        const response = await axios.get(url, requestConfig);
        
        // Calculate download stats
        const endTime = Date.now();
        const durationMs = endTime - startTime;
        
        let data;
        
        // Handle partial content response (206)
        if (response.status === 206 && partialData) {
          // Combine the partial data with the new data
          const newData = Buffer.from(response.data);
          data = Buffer.concat([partialData, newData]);
          logger.info(`[${reqId}] Combined ${partialSize} bytes of partial data with ${newData.length} new bytes`);
        } else {
          // Use the response data directly
          data = Buffer.from(response.data);
        }
        
        const size = data.length;
        const bandwidthKbps = Math.round((size * 8) / durationMs); // bits per ms = kbps
        
        // Update statistics
        this.stats.successfulDownloads++;
        this.stats.totalBytes += size;
        this.stats.downloadTimes.push(durationMs);
        this.stats.bandwidthMeasurements.push(bandwidthKbps);
        
        // Store in download history
        this.downloadHistory.set(url, {
          timestamp: Date.now(),
          size,
          durationMs,
          bandwidthKbps
        });
        
        logger.info(`[${reqId}] Successfully downloaded segment: ${url} (${size} bytes in ${durationMs}ms, ${bandwidthKbps} kbps)`);
        
        // Store in buffer with metadata
        const segmentId = metadata.sequenceNumber?.toString() || `segment_${Date.now()}`;
        const bufferResult = await this.bufferService.addSegment(data, {
          url,
          size,
          downloadTime: durationMs,
          bandwidth: bandwidthKbps,
          timestamp: Date.now(),
          sequenceNumber: metadata.sequenceNumber,
          ...metadata
        });
        
        // Create result object
        const result = {
          success: true,
          size,
          durationMs,
          bandwidthKbps,
          retryCount,
          url,
          metadata,
          bufferId: segmentId
        };
        
        // Emit success event
        this.emit('downloadSuccess', result);
        
        return result;
      } catch (error) {
        retryCount++;
        lastError = error;
        
        // Categorize the error
        const errorCategory = this._categorizeError(error);
        this.stats.errorsByCategory[errorCategory]++;
        
        // Save partial content for resuming, if available
        if (error.response && error.response.data) {
          partialData = Buffer.from(error.response.data);
          partialSize = partialData.length;
          logger.info(`[${reqId}] Saved ${partialSize} bytes of partial content for resume`);
        }
        
        const errorInfo = {
          message: error.message,
          code: error.code,
          status: error.response?.status,
          category: errorCategory,
          retryCount,
          url
        };
        
        // Check if we should retry
        if (retryCount <= this.maxRetries && this._isRetryableError(error)) {
          // Calculate retry delay with exponential backoff and jitter
          const delay = this._calculateRetryDelay(retryCount);
          
          logger.warn(`[${reqId}] Download attempt ${retryCount}/${this.maxRetries} failed: ${error.message}. Retrying in ${delay}ms...`);
          
          // Emit retry event
          this.emit('downloadRetry', {
            ...errorInfo,
            delay,
            nextAttempt: retryCount
          });
          
          // Wait before retrying
          await new Promise(resolve => setTimeout(resolve, delay));
        } else {
          // Max retries reached or non-retryable error
          this.stats.failedDownloads++;
          
          logger.error(`[${reqId}] Download failed after ${retryCount} attempts: ${error.message}`);
          
          // Emit failure event
          this.emit('downloadFailure', {
            ...errorInfo,
            metadata
          });
          
          return {
            success: false,
            errorCategory,
            errorMessage: error.message,
            status: error.response?.status,
            retryCount,
            url,
            partialSize, // Include size of any partial data received
            metadata
          };
        }
      }
    }
    
    // This shouldn't be reached due to the return in the catch block
    // but is here for completeness
    return {
      success: false,
      errorMessage: lastError?.message || 'Unknown error',
      retryCount,
      url,
      metadata
    };
  }
  
  /**
   * Calculate retry delay with exponential backoff and jitter
   * @param {number} retryCount - The current retry attempt
   * @returns {number} - Delay in ms
   * @private
   */
  _calculateRetryDelay(retryCount) {
    // Exponential backoff: base * 2^retryCount
    const exponentialDelay = this.retryDelayBase * Math.pow(2, retryCount - 1);
    
    // Add jitter: random value between 0 and 30% of the delay
    const jitter = Math.random() * 0.3 * exponentialDelay;
    
    // Calculate final delay with a maximum cap
    return Math.min(exponentialDelay + jitter, this.maxRetryDelay);
  }
  
  /**
   * Determine if an error is retryable
   * @param {Error} error - The error to check
   * @returns {boolean} - True if the error is retryable
   * @private
   */
  _isRetryableError(error) {
    // Network errors are generally retryable
    if (!error.response) {
      return true;
    }
    
    // 5xx errors are server errors and are retryable
    if (error.response.status >= 500 && error.response.status < 600) {
      return true;
    }
    
    // 429 Too Many Requests should be retried
    if (error.response.status === 429) {
      return true;
    }
    
    // 408 Request Timeout is retryable
    if (error.response.status === 408) {
      return true;
    }
    
    // All other status codes are generally not retryable
    // 4xx client errors indicate a problem with the request,
    // so retrying the same request likely won't help
    return false;
  }
  
  /**
   * Categorize an error to help with analysis
   * @param {Error} error - The error to categorize
   * @returns {string} - Error category
   * @private
   */
  _categorizeError(error) {
    if (!error.response) {
      // Network error, connection problem
      return 'network';
    }
    
    const status = error.response.status;
    
    if (status >= 500 && status < 600) {
      return 'server';
    }
    
    if (status >= 400 && status < 500) {
      return 'client';
    }
    
    if (error.code === 'ECONNABORTED') {
      return 'timeout';
    }
    
    if (error.message && error.message.includes('content')) {
      return 'content';
    }
    
    return 'unknown';
  }
  
  /**
   * Download multiple segments in parallel
   * @param {Array<string>} urls - Array of segment URLs
   * @param {Object} [options] - Download options
   * @returns {Promise<Array<Object>>} - Array of download results
   */
  async downloadSegments(urls, options = {}) {
    if (!this.isInitialized) {
      throw new Error('Downloader service not initialized');
    }
    
    logger.info(`Starting parallel download of ${urls.length} segments with concurrency ${this.maxConcurrentDownloads}`);
    
    // Filter out already downloaded segments unless force is true
    const urlsToDownload = options.force 
      ? urls 
      : urls.filter(url => !this.hasDownloadedSegment(url));
    
    if (urls.length !== urlsToDownload.length) {
      logger.info(`Skipping ${urls.length - urlsToDownload.length} already downloaded segments`);
    }
    
    // If no segments to download, return early
    if (urlsToDownload.length === 0) {
      return [];
    }
    
    // Process all downloads
    const downloadPromises = urlsToDownload.map((url, index) => 
      this.downloadSegment(url, { index }, options)
    );
    
    // Wait for all downloads to complete
    const results = await Promise.all(downloadPromises);
    
    // Count successes and failures
    const successCount = results.filter(r => r.success).length;
    
    logger.info(`Completed batch download: ${successCount}/${results.length} segments successful`);
    
    // Emit batch complete event
    this.emit('downloadComplete', {
      totalCount: results.length,
      successCount,
      failureCount: results.length - successCount
    });
    
    return results;
  }
  
  /**
   * Wait for all pending downloads to complete
   * @param {number} [timeout] - Maximum time to wait in ms
   * @returns {Promise<void>}
   */
  async finishPendingDownloads(timeout) {
    if (this.pendingDownloads.size === 0) {
      return;
    }
    
    logger.info(`Waiting for ${this.pendingDownloads.size} pending downloads to complete...`);
    
    const pendingPromises = Array.from(this.pendingDownloads);
    
    if (timeout) {
      // Create a timeout promise
      const timeoutPromise = new Promise((_, reject) => {
        setTimeout(() => reject(new Error(`Timed out waiting for downloads after ${timeout}ms`)), timeout);
      });
      
      // Race the pending downloads against the timeout
      try {
        await Promise.race([
          Promise.all(pendingPromises),
          timeoutPromise
        ]);
      } catch (error) {
        logger.warn(`Timeout reached while waiting for downloads: ${error.message}`);
        return;
      }
    } else {
      // Wait for all pending downloads with no timeout
      await Promise.all(pendingPromises);
    }
    
    logger.info('All pending downloads completed');
  }
  
  /**
   * Get download statistics
   * @returns {Object} - Statistics object
   */
  getStats() {
    // Calculate derived statistics
    const avgDownloadTime = this.stats.downloadTimes.length > 0
      ? Math.round(this.stats.downloadTimes.reduce((a, b) => a + b, 0) / this.stats.downloadTimes.length)
      : 0;
      
    const avgBandwidthKbps = this.stats.bandwidthMeasurements.length > 0
      ? Math.round(this.stats.bandwidthMeasurements.reduce((a, b) => a + b, 0) / this.stats.bandwidthMeasurements.length)
      : 0;
      
    const successRate = this.stats.totalDownloads > 0
      ? Math.round((this.stats.successfulDownloads / this.stats.totalDownloads) * 100) + '%'
      : '0%';
    
    return {
      totalDownloads: this.stats.totalDownloads,
      successfulDownloads: this.stats.successfulDownloads,
      failedDownloads: this.stats.failedDownloads,
      skippedDownloads: this.stats.skippedDownloads,
      totalBytes: this.stats.totalBytes,
      averageDownloadTime: avgDownloadTime,
      averageBandwidthKbps: avgBandwidthKbps,
      successRate,
      errorsByCategory: this.stats.errorsByCategory,
      activeDownloads: this.activeDownloads,
      queuedDownloads: this.downloadQueue.length,
      pendingDownloads: this.pendingDownloads.size
    };
  }
}

// Create singleton instance
const downloaderService = new DownloaderService();

module.exports = {
  downloaderService,
  DownloaderService
}; 