const axios = require('axios');
const { bufferService } = require('./buffer-service');
const logger = require('../utils/logger');

// Error categories for better error handling
const ErrorCategory = {
  NETWORK: 'network',       // Network connectivity issues
  SERVER: 'server',         // Server errors (5xx)
  CLIENT: 'client',         // Client errors (4xx)
  TIMEOUT: 'timeout',       // Request timeouts
  CONTENT: 'content',       // Content/parsing errors
  UNKNOWN: 'unknown'        // Uncategorized errors
};

/**
 * Service for downloading media segments and storing them in the buffer
 */
class DownloaderService {
  constructor(options = {}) {
    this.defaultTimeout = options.timeout || 10000; // 10 seconds default
    this.maxRetries = options.maxRetries || 3;
    this.initialRetryDelay = options.retryDelay || 1000;
    this.maxRetryDelay = options.maxRetryDelay || 30000;
    this.retryBackoffFactor = options.retryBackoffFactor || 2;
    
    // Download tracking
    this.downloadedSegments = new Map(); // url -> download info
    this.downloadHistory = [];
    
    // Performance metrics
    this.stats = this._createEmptyStats();
    
    logger.info('Initialized downloader service');
  }
  
  /**
   * Download a segment from a URL and store it in the buffer
   * @param {string} url - The URL of the segment to download
   * @param {Object} metadata - Metadata about the segment
   * @param {number} [metadata.sequenceNumber] - The sequence number in the playlist
   * @param {number} [metadata.duration] - The duration of the segment in seconds
   * @param {number} [timeout] - Optional timeout in ms for this specific request
   * @param {boolean} [force=false] - Force download even if already downloaded
   * @returns {Promise<Object>} - Information about the download
   */
  async downloadSegment(url, metadata = {}, timeout = this.defaultTimeout, force = false) {
    const startTime = Date.now();
    let retries = 0;
    let totalBytes = 0;
    let partialContent = null;
    
    // Generate a request ID for tracking this download
    const requestId = `req_${Date.now()}_${Math.floor(Math.random() * 1000)}`;
    
    // Check if segment has already been downloaded
    if (!force && this.hasDownloadedSegment(url)) {
      logger.info(`[${requestId}] Segment already downloaded: ${url}`);
      
      // Update metrics
      this.stats.skippedDownloads++;
      
      // Return the segment if it's still in the buffer
      const segment = this._getSegmentFromBuffer(url);
      if (segment) {
        return {
          success: true,
          url,
          size: segment.size,
          durationMs: 0,
          httpStatus: 200,
          segment,
          fromCache: true
        };
      }
      
      // If the segment is no longer in the buffer, re-download it
      logger.info(`[${requestId}] Segment not found in buffer, re-downloading: ${url}`);
    }
    
    logger.info(`[${requestId}] Starting download: ${url}`);
    
    // Track this download
    this.stats.totalDownloads++;
    
    while (true) {
      try {
        // Calculate retry delay with exponential backoff
        const retryDelay = this._calculateRetryDelay(retries);
        
        // Prepare headers for the request
        const headers = {
          'Accept': '*/*',
          'User-Agent': 'time-shift-radio/1.0.0'
        };
        
        // If we have partial content from a previous attempt, set Range header
        if (partialContent) {
          headers['Range'] = `bytes=${partialContent.byteLength}-`;
          logger.info(`[${requestId}] Resuming download from byte ${partialContent.byteLength}`);
        }
        
        // Make the request with appropriate headers for binary data
        const response = await axios.get(url, {
          timeout,
          responseType: 'arraybuffer',
          headers
        });
        
        // Check if response is valid
        if (!response.data || response.data.byteLength === 0) {
          throw this._createError('Empty response received', ErrorCategory.CONTENT);
        }
        
        let finalData;
        
        // Handle partial content
        if (response.status === 206) {
          logger.info(`[${requestId}] Received partial content (${response.data.byteLength} bytes)`);
          
          // Combine with previous partial content if exists
          if (partialContent) {
            const combinedBuffer = new Uint8Array(partialContent.byteLength + response.data.byteLength);
            combinedBuffer.set(new Uint8Array(partialContent), 0);
            combinedBuffer.set(new Uint8Array(response.data), partialContent.byteLength);
            finalData = combinedBuffer.buffer;
          } else {
            finalData = response.data;
          }
        } else {
          finalData = response.data;
        }
        
        // Prepare metadata for buffer storage
        const segmentMetadata = {
          url,
          sequenceNumber: metadata.sequenceNumber,
          duration: metadata.duration || 0,
          contentType: response.headers['content-type'],
          contentLength: response.headers['content-length'],
          httpStatus: response.status,
          downloadTime: Date.now() - startTime,
          downloadDate: new Date().toISOString()
        };
        
        // Store segment in buffer
        const segment = bufferService.addSegment(finalData, segmentMetadata);
        
        // Calculate bandwidth in kbps
        const durationMs = Date.now() - startTime;
        const durationSec = durationMs / 1000;
        const bytes = finalData.byteLength;
        const kbps = durationSec > 0 ? Math.round((bytes * 8) / durationSec / 1000) : 0;
        
        const result = {
          success: true,
          url,
          size: bytes,
          durationMs,
          bandwidthKbps: kbps,
          httpStatus: response.status,
          segment,
          resumedDownload: !!partialContent
        };
        
        // Track the downloaded segment
        this._trackDownloadedSegment(url, result);
        
        // Update metrics
        this.stats.successfulDownloads++;
        this.stats.totalBytes += bytes;
        this.stats.totalDuration += durationMs;
        this.stats.averageDownloadTime = this.stats.totalDuration / this.stats.successfulDownloads;
        this.stats.averageBandwidthKbps = this.stats.successfulDownloads > 0 ? 
          Math.round((this.stats.totalBytes * 8) / (this.stats.totalDuration / 1000) / 1000) : 0;
        
        logger.info(`[${requestId}] Successfully downloaded segment: ${url} (${result.size} bytes in ${result.durationMs}ms, ${kbps} kbps)`);
        
        return result;
      } catch (error) {
        retries++;
        
        // Handle axios error
        const errorCategory = this._categorizeError(error);
        const errorInfo = {
          message: error.message,
          status: error.response?.status,
          statusText: error.response?.statusText,
          code: error.code,
          category: errorCategory
        };
        
        // For some errors like server overload or network issues, we can retry
        // For other errors like 404, there's no point retrying
        const isRetryable = this._isRetryableError(errorCategory, error.response?.status);
        
        // If we have a partial response that was cut off, save it for resuming
        if (error.response && error.response.data && error.response.data.byteLength > 0) {
          partialContent = error.response.data;
          totalBytes += partialContent.byteLength;
          logger.info(`[${requestId}] Saved ${partialContent.byteLength} bytes of partial content for resume`);
        }
        
        if (!isRetryable || retries > this.maxRetries) {
          const reason = !isRetryable ? 'non-retryable error' : `exceeded max retries (${this.maxRetries})`;
          logger.error(`[${requestId}] Failed to download segment (${reason}): ${url}`, errorInfo);
          
          // Update metrics
          this.stats.failedDownloads++;
          this.stats.errorsByCategory[errorCategory] = (this.stats.errorsByCategory[errorCategory] || 0) + 1;
          
          // Track failed download
          this._trackFailedDownload(url, errorInfo);
          
          return {
            success: false,
            url,
            error: errorInfo,
            durationMs: Date.now() - startTime,
            attempts: retries,
            partialBytes: totalBytes
          };
        }
        
        const retryDelay = this._calculateRetryDelay(retries);
        logger.warn(`[${requestId}] Attempt ${retries}/${this.maxRetries} failed: ${error.message} (${errorCategory}). Retrying in ${retryDelay}ms...`);
        await new Promise(resolve => setTimeout(resolve, retryDelay));
      }
    }
  }
  
  /**
   * Check if a segment has already been downloaded
   * @param {string} url - The URL of the segment
   * @returns {boolean} - True if the segment has been downloaded
   */
  hasDownloadedSegment(url) {
    return this.downloadedSegments.has(url);
  }
  
  /**
   * Get a downloaded segment from the buffer by URL
   * @param {string} url - The URL of the segment
   * @returns {Object|null} - The segment or null if not found
   * @private
   */
  _getSegmentFromBuffer(url) {
    // Attempt to find the segment in the buffer by checking all segments
    // This is a bit inefficient and could be improved with a url->segment index
    const bufferStats = bufferService.getBufferStats();
    
    if (bufferStats.isEmpty) {
      return null;
    }
    
    for (let i = bufferStats.sequenceRange.start; i <= bufferStats.sequenceRange.end; i++) {
      const segment = bufferService.getSegmentBySequence(i);
      if (segment && segment.metadata.url === url) {
        return segment;
      }
    }
    
    return null;
  }
  
  /**
   * Track a successfully downloaded segment
   * @param {string} url - The URL of the segment
   * @param {Object} result - The download result
   * @private
   */
  _trackDownloadedSegment(url, result) {
    const downloadInfo = {
      url,
      timestamp: Date.now(),
      size: result.size,
      durationMs: result.durationMs,
      bandwidthKbps: result.bandwidthKbps,
      sequenceNumber: result.segment.metadata.sequenceNumber
    };
    
    this.downloadedSegments.set(url, downloadInfo);
    this.downloadHistory.push(downloadInfo);
    
    // Limit history size to avoid memory leaks
    if (this.downloadHistory.length > 1000) {
      this.downloadHistory.shift();
    }
  }
  
  /**
   * Track a failed download attempt
   * @param {string} url - The URL of the segment
   * @param {Object} error - The error information
   * @private
   */
  _trackFailedDownload(url, error) {
    const failedInfo = {
      url,
      timestamp: Date.now(),
      error: error,
      isFailure: true
    };
    
    this.downloadHistory.push(failedInfo);
    
    // Limit history size to avoid memory leaks
    if (this.downloadHistory.length > 1000) {
      this.downloadHistory.shift();
    }
  }
  
  /**
   * Calculate retry delay with exponential backoff
   * @param {number} attempt - The retry attempt number (starting from 0)
   * @returns {number} - The delay in milliseconds
   * @private
   */
  _calculateRetryDelay(attempt) {
    // For the first retry, use the initial delay
    if (attempt <= 1) {
      return this.initialRetryDelay;
    }
    
    // Calculate exponential backoff
    const delay = this.initialRetryDelay * Math.pow(this.retryBackoffFactor, attempt - 1);
    
    // Add some jitter to avoid thundering herd problem (±15%)
    const jitter = 0.3 * delay * (Math.random() - 0.5);
    
    // Apply max delay cap
    return Math.min(this.maxRetryDelay, delay + jitter);
  }
  
  /**
   * Create a standardized error object
   * @param {string} message - The error message
   * @param {string} category - The error category
   * @returns {Error} - The error object
   * @private
   */
  _createError(message, category = ErrorCategory.UNKNOWN) {
    const error = new Error(message);
    error.category = category;
    return error;
  }
  
  /**
   * Determine if an error is retryable
   * @param {string} category - The error category
   * @param {number} statusCode - HTTP status code if available
   * @returns {boolean} - Whether the error is retryable
   * @private
   */
  _isRetryableError(category, statusCode) {
    // Network errors and timeouts are always retryable
    if (category === ErrorCategory.NETWORK || category === ErrorCategory.TIMEOUT) {
      return true;
    }
    
    // Server errors (5xx) are usually retryable
    if (category === ErrorCategory.SERVER) {
      return true;
    }
    
    // Some specific client errors might be retryable
    if (category === ErrorCategory.CLIENT) {
      // 408 Request Timeout, 429 Too Many Requests are retryable
      return statusCode === 408 || statusCode === 429;
    }
    
    // Other client errors (4xx) are generally not retryable
    return false;
  }
  
  /**
   * Categorize an error based on its properties
   * @param {Error} error - The error object
   * @returns {string} - The error category
   * @private
   */
  _categorizeError(error) {
    // If error already has a category, use it
    if (error.category) {
      return error.category;
    }
    
    // Check for network errors
    if (error.code === 'ENOTFOUND' || error.code === 'ECONNREFUSED' || 
        error.code === 'ECONNRESET' || error.code === 'EHOSTUNREACH') {
      return ErrorCategory.NETWORK;
    }
    
    // Check for timeout errors
    if (error.code === 'ETIMEDOUT' || error.code === 'ESOCKETTIMEDOUT' || 
        error.message.includes('timeout')) {
      return ErrorCategory.TIMEOUT;
    }
    
    // Check HTTP status codes
    if (error.response) {
      const status = error.response.status;
      
      // 4xx errors are client errors
      if (status >= 400 && status < 500) {
        return ErrorCategory.CLIENT;
      }
      
      // 5xx errors are server errors
      if (status >= 500) {
        return ErrorCategory.SERVER;
      }
    }
    
    // Content errors
    if (error.message.includes('content') || error.message.includes('parse')) {
      return ErrorCategory.CONTENT;
    }
    
    // Default to unknown
    return ErrorCategory.UNKNOWN;
  }
  
  /**
   * Download multiple segments sequentially
   * @param {Array<Object>} segmentInfos - Array of objects with url and metadata
   * @param {boolean} [skipExisting=true] - Skip segments that have already been downloaded
   * @returns {Promise<Array<Object>>} - Results of each download
   */
  async downloadSegmentsSequential(segmentInfos, skipExisting = true) {
    const results = [];
    
    for (const info of segmentInfos) {
      // Skip if already downloaded and skipExisting is true
      if (skipExisting && this.hasDownloadedSegment(info.url)) {
        const cachedSegment = this._getSegmentFromBuffer(info.url);
        if (cachedSegment) {
          results.push({
            success: true,
            url: info.url,
            size: cachedSegment.size,
            durationMs: 0,
            httpStatus: 200,
            segment: cachedSegment,
            fromCache: true
          });
          continue;
        }
      }
      
      const result = await this.downloadSegment(info.url, info.metadata);
      results.push(result);
    }
    
    return results;
  }
  
  /**
   * Download multiple segments in parallel with a concurrency limit
   * @param {Array<Object>} segmentInfos - Array of objects with url and metadata
   * @param {number} [concurrency=3] - Maximum number of concurrent downloads
   * @param {boolean} [skipExisting=true] - Skip segments that have already been downloaded
   * @returns {Promise<Array<Object>>} - Results of each download
   */
  async downloadSegmentsParallel(segmentInfos, concurrency = 3, skipExisting = true) {
    const results = [];
    const totalSegments = segmentInfos.length;
    let processedSegments = 0;
    
    logger.info(`Starting parallel download of ${totalSegments} segments with concurrency ${concurrency}`);
    
    // Filter out already downloaded segments if skipExisting is true
    const segmentsToDownload = skipExisting ? 
      segmentInfos.filter(info => !this.hasDownloadedSegment(info.url)) : 
      [...segmentInfos];
    
    const skippedCount = totalSegments - segmentsToDownload.length;
    if (skippedCount > 0) {
      logger.info(`Skipping ${skippedCount} already downloaded segments`);
      
      // Add skipped segments from buffer to results
      for (const info of segmentInfos) {
        if (this.hasDownloadedSegment(info.url)) {
          const cachedSegment = this._getSegmentFromBuffer(info.url);
          if (cachedSegment) {
            results.push({
              success: true,
              url: info.url,
              size: cachedSegment.size,
              durationMs: 0,
              httpStatus: 200,
              segment: cachedSegment,
              fromCache: true
            });
            processedSegments++;
          }
        }
      }
    }
    
    // Process remaining segments in batches
    for (let i = 0; i < segmentsToDownload.length; i += concurrency) {
      const batch = segmentsToDownload.slice(i, i + concurrency);
      const batchPromises = batch.map(info => this.downloadSegment(info.url, info.metadata));
      
      const batchResults = await Promise.all(batchPromises);
      results.push(...batchResults);
      
      processedSegments += batch.length;
      logger.info(`Downloaded batch ${Math.floor(i/concurrency) + 1} - ${processedSegments}/${totalSegments} segments`);
    }
    
    // Update parallel download metrics
    this._updateParallelDownloadMetrics(results);
    
    return results;
  }
  
  /**
   * Get download history
   * @param {number} [limit=100] - Maximum number of history items to return
   * @returns {Array<Object>} - Download history items
   */
  getDownloadHistory(limit = 100) {
    return this.downloadHistory.slice(-limit);
  }
  
  /**
   * Get download statistics
   * @returns {Object} - Download statistics
   */
  getStats() {
    return {
      ...this.stats,
      successRate: this.stats.totalDownloads > 0 ? 
        this.stats.successfulDownloads / this.stats.totalDownloads : 0,
      downloadedUrls: Array.from(this.downloadedSegments.keys())
    };
  }
  
  /**
   * Update parallel download metrics
   * @param {Array<Object>} results - Download results
   * @private
   */
  _updateParallelDownloadMetrics(results) {
    // Calculate parallel download efficiency
    const successfulResults = results.filter(r => r.success && !r.fromCache);
    if (successfulResults.length === 0) return;
    
    const totalBytes = successfulResults.reduce((sum, r) => sum + r.size, 0);
    const totalTime = Math.max(...successfulResults.map(r => r.durationMs));
    const totalIndividualTime = successfulResults.reduce((sum, r) => sum + r.durationMs, 0);
    
    if (totalTime > 0) {
      const parallelEfficiency = totalIndividualTime / totalTime;
      this.stats.lastParallelEfficiency = parallelEfficiency;
      this.stats.averageParallelEfficiency = 
        (this.stats.averageParallelEfficiency * this.stats.parallelDownloadCount + parallelEfficiency) / 
        (this.stats.parallelDownloadCount + 1);
      this.stats.parallelDownloadCount++;
    }
  }
  
  /**
   * Create empty stats object
   * @returns {Object} - Empty stats object
   * @private
   */
  _createEmptyStats() {
    return {
      totalDownloads: 0,
      successfulDownloads: 0,
      failedDownloads: 0,
      skippedDownloads: 0,
      totalBytes: 0,
      totalDuration: 0,
      averageDownloadTime: 0,
      averageBandwidthKbps: 0,
      errorsByCategory: {},
      parallelDownloadCount: 0,
      averageParallelEfficiency: 0,
      lastParallelEfficiency: 0
    };
  }
  
  /**
   * Clear the download statistics
   */
  clearStats() {
    this.stats = this._createEmptyStats();
  }
  
  /**
   * Clear download history and tracking data
   */
  clearHistory() {
    this.downloadHistory = [];
    this.downloadedSegments.clear();
    logger.info('Download history cleared');
  }
}

// Export singleton instance
const downloaderService = new DownloaderService();

module.exports = {
  downloaderService,
  DownloaderService,
  ErrorCategory
}; 