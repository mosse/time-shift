const axios = require('axios');
const { bufferService } = require('./buffer-service');
const logger = require('../utils/logger');

/**
 * Service for downloading media segments and storing them in the buffer
 */
class DownloaderService {
  constructor(options = {}) {
    this.defaultTimeout = options.timeout || 10000; // 10 seconds default
    this.maxRetries = options.maxRetries || 3;
    this.retryDelay = options.retryDelay || 1000;
    
    logger.info('Initialized downloader service');
  }
  
  /**
   * Download a segment from a URL and store it in the buffer
   * @param {string} url - The URL of the segment to download
   * @param {Object} metadata - Metadata about the segment
   * @param {number} [metadata.sequenceNumber] - The sequence number in the playlist
   * @param {number} [metadata.duration] - The duration of the segment in seconds
   * @param {number} [timeout] - Optional timeout in ms for this specific request
   * @returns {Promise<Object>} - Information about the download
   */
  async downloadSegment(url, metadata = {}, timeout = this.defaultTimeout) {
    const startTime = Date.now();
    let retries = 0;
    
    // Generate a request ID for tracking this download
    const requestId = `req_${Date.now()}_${Math.floor(Math.random() * 1000)}`;
    
    logger.info(`[${requestId}] Starting download: ${url}`);
    
    while (true) {
      try {
        // Make the request with appropriate headers for binary data
        const response = await axios.get(url, {
          timeout,
          responseType: 'arraybuffer',
          headers: {
            'Accept': '*/*',
            'User-Agent': 'time-shift-radio/1.0.0'
          }
        });
        
        // Check if response is valid
        if (!response.data || response.data.byteLength === 0) {
          throw new Error('Empty response received');
        }
        
        // Prepare metadata for buffer storage
        const segmentMetadata = {
          url,
          sequenceNumber: metadata.sequenceNumber,
          duration: metadata.duration || 0,
          contentType: response.headers['content-type'],
          contentLength: response.headers['content-length'],
          httpStatus: response.status,
          downloadTime: Date.now() - startTime
        };
        
        // Store segment in buffer
        const segment = bufferService.addSegment(response.data, segmentMetadata);
        
        const result = {
          success: true,
          url,
          size: response.data.byteLength,
          durationMs: Date.now() - startTime,
          httpStatus: response.status,
          segment
        };
        
        logger.info(`[${requestId}] Successfully downloaded segment: ${url} (${result.size} bytes in ${result.durationMs}ms)`);
        
        return result;
      } catch (error) {
        retries++;
        
        // Extract the most useful error information
        const errorInfo = {
          message: error.message,
          status: error.response?.status,
          statusText: error.response?.statusText,
          code: error.code
        };
        
        if (retries > this.maxRetries) {
          logger.error(`[${requestId}] Failed to download segment after ${this.maxRetries} attempts: ${url}`, errorInfo);
          return {
            success: false,
            url,
            error: errorInfo,
            durationMs: Date.now() - startTime,
            attempts: retries
          };
        }
        
        logger.warn(`[${requestId}] Attempt ${retries}/${this.maxRetries} failed: ${error.message}. Retrying in ${this.retryDelay}ms...`);
        await new Promise(resolve => setTimeout(resolve, this.retryDelay));
      }
    }
  }
  
  /**
   * Download multiple segments sequentially
   * @param {Array<Object>} segmentInfos - Array of objects with url and metadata
   * @returns {Promise<Array<Object>>} - Results of each download
   */
  async downloadSegmentsSequential(segmentInfos) {
    const results = [];
    
    for (const info of segmentInfos) {
      const result = await this.downloadSegment(info.url, info.metadata);
      results.push(result);
    }
    
    return results;
  }
  
  /**
   * Download multiple segments in parallel with a concurrency limit
   * @param {Array<Object>} segmentInfos - Array of objects with url and metadata
   * @param {number} [concurrency=3] - Maximum number of concurrent downloads
   * @returns {Promise<Array<Object>>} - Results of each download
   */
  async downloadSegmentsParallel(segmentInfos, concurrency = 3) {
    const results = [];
    const total = segmentInfos.length;
    
    logger.info(`Starting parallel download of ${total} segments with concurrency ${concurrency}`);
    
    for (let i = 0; i < total; i += concurrency) {
      const batch = segmentInfos.slice(i, i + concurrency);
      const batchPromises = batch.map(info => this.downloadSegment(info.url, info.metadata));
      
      const batchResults = await Promise.all(batchPromises);
      results.push(...batchResults);
      
      logger.info(`Downloaded batch ${Math.floor(i/concurrency) + 1} - ${results.length}/${total} segments`);
    }
    
    return results;
  }
  
  /**
   * Clear the download statistics
   */
  clearStats() {
    this.stats = {
      totalDownloads: 0,
      successfulDownloads: 0,
      failedDownloads: 0,
      totalBytes: 0,
      totalDuration: 0
    };
  }
}

// Export singleton instance
const downloaderService = new DownloaderService();

module.exports = {
  downloaderService,
  DownloaderService
}; 