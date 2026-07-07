/**
 * Service Manager
 * Central coordination point for all services in the time-shifted radio application
 */

const { monitorService } = require('./monitor-service');
const { downloaderService } = require('./downloader-service');
const { hybridBufferService } = require('./hybrid-buffer-service');
const { metadataService } = require('./metadata-service');
const logger = require('../utils/logger');
const config = require('../config/config');

/**
 * Service Manager Class
 * Initializes all services and establishes connections between them
 */
class ServiceManager {
  constructor(options = {}) {
    this.options = {
      bufferDuration: options.bufferDuration || config.BUFFER_DURATION,
      monitorInterval: options.monitorInterval || 10000,
      streamUrl: options.streamUrl || config.STREAM_URLS.AKAMAI,
      maxRetries: options.maxRetries || 3,
      maxConcurrentDownloads: options.maxConcurrentDownloads || 3,
      ...options
    };
    
    this.isRunning = false;
    this.servicesInitialized = false;
    this.servicesConnected = false;
    
    logger.info('Service manager initialized with options:', this.options);
  }
  
  /**
   * Initialize all services
   */
  async initializeServices() {
    if (this.servicesInitialized) {
      logger.warn('Services already initialized');
      return;
    }

    // Initialize hybrid buffer service (creates data directories)
    await hybridBufferService.initialize({
      duration: this.options.bufferDuration
    });

    // Initialize downloader service with custom options
    downloaderService.initialize({
      maxRetries: this.options.maxRetries,
      maxConcurrentDownloads: this.options.maxConcurrentDownloads,
      bufferService: hybridBufferService // Pass hybrid buffer service reference
    });

    // Configure monitor service
    monitorService.url = this.options.streamUrl;
    monitorService.interval = this.options.monitorInterval;

    this.servicesInitialized = true;
    logger.info('All services initialized');
  }
  
  /**
   * Connect services by setting up event listeners between them
   */
  connectServices() {
    if (!this.servicesInitialized) {
      throw new Error('Services must be initialized before connecting');
    }

    // Restarting the pipeline (e.g. POST /api/restart) must not stack a
    // second set of listeners on the singletons
    if (this.servicesConnected) {
      logger.debug('Services already connected, skipping duplicate wiring');
      return;
    }

    logger.info('Connecting services...');
    
    // Monitor -> Downloader: When new segments are found, download them
    monitorService.on('newSegment', async (segmentInfo) => {
      logger.debug(`Pipeline: New segment detected, triggering download: ${segmentInfo.url}`);
      
      try {
        // Pass segment metadata to downloader
        const downloadResult = await downloaderService.downloadSegment(
          segmentInfo.url, 
          {
            sequenceNumber: segmentInfo.sequenceNumber,
            discoveredAt: segmentInfo.discoveredAt,
            duration: segmentInfo.duration
          }
        );
        
        if (downloadResult.success) {
          logger.debug(`Pipeline: Successfully downloaded segment ${segmentInfo.sequenceNumber}`);
        } else {
          logger.error(`Pipeline: Failed to download segment ${segmentInfo.sequenceNumber}: ${downloadResult.errorMessage}`);
        }
      } catch (error) {
        logger.error(`Pipeline: Error in download pipeline for segment ${segmentInfo.url}:`, error);
      }
    });
    
    // Downloader -> Buffer: Already connected through initialization
    
    // Monitor -> Service Manager: Propagate important events
    monitorService.on('error', (errorInfo) => {
      logger.error(`Pipeline: Monitor error: ${errorInfo.error || errorInfo.message || 'unknown'}`);
    });

    monitorService.on('discontinuity', (info) => {
      logger.warn(`Pipeline: Stream discontinuity detected, ${info.skippedCount} segments skipped`);

      // Record the hole as first-class gap data (~6.4s per skipped segment)
      const now = Date.now();
      hybridBufferService.recordGap({
        fromSeq: info.expected,
        toSeq: info.actual - 1,
        startTime: now - info.skippedCount * 6400,
        endTime: now,
        reason: 'discontinuity'
      });
    });
    
    monitorService.on('maxErrorsReached', () => {
      logger.error('Pipeline: Monitor reached maximum errors, attempting recovery');
      // The monitor service already has its own recovery mechanism
    });
    
    // Downloader -> Service Manager: Monitor download statistics
    downloaderService.on('downloadSuccess', (result) => {
      logger.debug(`Pipeline: Download success: ${result.url} (${result.size} bytes)`);
    });
    
    downloaderService.on('downloadFailure', (failure) => {
      logger.error(`Pipeline: Download failure: ${failure.url} - ${failure.message || failure.errorMessage}`);

      // A permanently failed segment is a (small) hole in the recording
      const seq = failure.metadata?.sequenceNumber;
      if (Number.isFinite(seq)) {
        const duration = (failure.metadata?.duration || 6.4) * 1000;
        const now = Date.now();
        hybridBufferService.recordGap({
          fromSeq: seq,
          toSeq: seq,
          startTime: now - duration,
          endTime: now,
          reason: 'download-failure'
        });
      }
    });
    
    downloaderService.on('downloadComplete', (stats) => {
      logger.debug(`Pipeline: Download batch complete - ${stats.successCount}/${stats.totalCount} segments downloaded`);
    });
    
    // Buffer -> Service Manager: Monitor buffer capacity
    hybridBufferService.on('segmentAdded', (info) => {
      logger.debug(`Pipeline: Segment added to buffer: ${info.segmentId}`);
    });
    
    hybridBufferService.on('segmentExpired', (info) => {
      logger.debug(`Pipeline: Segment expired from buffer: ${info.segmentId}`);
    });
    
    hybridBufferService.on('bufferFull', () => {
      logger.warn('Pipeline: Buffer reached capacity');
    });

    hybridBufferService.on('storagePressure', (capacity) => {
      logger.warn('Pipeline: Storage pressure reported by buffer service', capacity || {});
    });

    this.servicesConnected = true;
    logger.info('All services connected successfully');
  }
  
  /**
   * Start the entire acquisition pipeline
   * @param {Object} [options] - Start options
   * @returns {Promise<boolean>} - Success status
   */
  async startPipeline(options = {}) {
    try {
      if (this.isRunning) {
        logger.warn('Pipeline is already running');
        return false;
      }
      
      logger.info('Starting acquisition pipeline...');
      
      // Initialize services if needed
      if (!this.servicesInitialized) {
        await this.initializeServices();
      }
      
      // Connect services
      this.connectServices();
      
      // Start monitoring
      const monitorStarted = monitorService.startMonitoring({
        immediate: options.immediate !== false
      });
      
      if (!monitorStarted) {
        throw new Error('Failed to start monitor service');
      }
      
      this.isRunning = true;
      logger.info('Acquisition pipeline started successfully');

      // Start metadata service independently (non-blocking, errors don't affect pipeline)
      this._startMetadataService();

      return true;
    } catch (error) {
      logger.error(`Failed to start acquisition pipeline: ${error.message}`);
      
      // Attempt to clean up if startup fails
      this.stopPipeline().catch(err => {
        logger.error(`Cleanup after failed start also failed: ${err.message}`);
      });
      
      return false;
    }
  }
  
  /**
   * Stop the entire acquisition pipeline
   * @returns {Promise<boolean>} - Success status
   */
  async stopPipeline() {
    try {
      if (!this.isRunning) {
        logger.warn('Pipeline is not running');
        return false;
      }
      
      logger.info('Stopping acquisition pipeline...');
      
      // Stop the monitor
      monitorService.stopMonitoring();

      // Stop metadata service (non-critical)
      try {
        metadataService.stop();
      } catch (e) {
        logger.warn(`Error stopping metadata service: ${e.message}`);
      }
      
      // Note: listeners wired in connectServices() are intentionally kept -
      // wiring is one-time (guarded by servicesConnected) so a pipeline
      // restart reuses them instead of stacking duplicates

      // Wait for any pending downloads to complete, but never let a stuck
      // download hold up shutdown past the forced-exit window
      await Promise.race([
        downloaderService.finishPendingDownloads(),
        new Promise(resolve => {
          const timer = setTimeout(() => {
            logger.warn('Timed out waiting for pending downloads during shutdown');
            resolve();
          }, 8000);
          timer.unref();
        })
      ]);

      // Persist buffer metadata so a restart restores the full buffer
      try {
        hybridBufferService.stopIntervals();
        await hybridBufferService.flushMetadata();
      } catch (e) {
        logger.warn(`Error flushing buffer metadata on shutdown: ${e.message}`);
      }

      this.isRunning = false;
      logger.info('Acquisition pipeline stopped successfully');
      
      return true;
    } catch (error) {
      logger.error(`Error stopping acquisition pipeline: ${error.message}`);
      return false;
    }
  }
  
  /**
   * Restart just the monitor loop (self-heal for zombie/stuck states)
   * Much cheaper than a full pipeline restart: listeners, buffer and
   * downloader state are all preserved
   * @returns {Promise<boolean>} - True if the monitor restarted
   */
  async restartMonitor() {
    logger.warn('Restarting monitor service (self-heal)');

    try {
      monitorService.stopMonitoring();
    } catch (error) {
      logger.warn(`Error stopping monitor during self-heal: ${error.message}`);
    }

    monitorService.errorCount = 0;
    const started = monitorService.startMonitoring({ immediate: true });

    if (started) {
      logger.info('Monitor service restarted successfully');
    } else {
      logger.error('Monitor service failed to restart during self-heal');
    }

    return started;
  }

  /**
   * Start metadata service independently
   * Failures here should never impact the main pipeline
   * @private
   */
  async _startMetadataService() {
    try {
      // Load any existing metadata from disk
      await metadataService.loadFromDisk();
      // Start polling
      metadataService.start();
      logger.info('Metadata service started');
    } catch (error) {
      // Log but don't throw - metadata is non-critical
      logger.warn(`Failed to start metadata service: ${error.message}`);
    }
  }

  /**
   * Get current pipeline status
   * @returns {Object} - Status information for all services
   */
  getPipelineStatus() {
    let metadataStats = null;
    try {
      metadataStats = metadataService.getStats();
    } catch (e) {
      // Ignore metadata errors
    }

    let capacity = null;
    try {
      const { diskStorageService } = require('./disk-storage-service');
      capacity = diskStorageService.getLastCapacity();
    } catch (e) {
      // Capacity info is best-effort
    }

    return {
      isRunning: this.isRunning,
      monitor: monitorService.getStatus(),
      downloader: downloaderService.getStats(),
      buffer: hybridBufferService.getBufferStats(),
      metadata: metadataStats,
      capacity
    };
  }
  
  /**
   * Register handlers for process termination signals
   */
  registerSignalHandlers() {
    // Handle graceful shutdown
    const handleShutdown = async (signal) => {
      logger.info(`Received ${signal}, shutting down pipeline...`);
      await this.stopPipeline();
    };
    
    // Register signal handlers
    process.on('SIGTERM', () => handleShutdown('SIGTERM'));
    process.on('SIGINT', () => handleShutdown('SIGINT'));
  }
}

// Export singleton instance
const serviceManager = new ServiceManager();

// Make the hybrid buffer service available via the service manager
serviceManager.bufferService = hybridBufferService;

module.exports = {
  serviceManager,
  ServiceManager
}; 