/**
 * Test Acquisition Pipeline
 * Tests the complete segment acquisition pipeline that connects:
 * - Playlist monitor
 * - Segment downloader
 * - Buffer storage
 */

const { serviceManager } = require('../services');
const { monitorService } = require('../services/monitor-service');
const { downloaderService } = require('../services/downloader-service');
const { bufferService } = require('../services/buffer-service');
const logger = require('../utils/logger');

/**
 * Test the complete acquisition pipeline
 * @returns {Promise<Object>} - Test results
 */
async function testAcquisitionPipeline() {
  try {
    logger.info('Starting acquisition pipeline test...');
    
    // Define test options
    const testOptions = {
      bufferDuration: 300000, // 5 minutes
      monitorInterval: 5000,  // 5 seconds
      streamUrl: 'https://d2zihajmogu5jn.cloudfront.net/bipbop-advanced/gear1/prog_index.m3u8',
      maxRetries: 2,
      maxConcurrentDownloads: 3
    };
    
    // Set up event counter for verification
    const eventCounts = {
      newSegments: 0,
      downloadsStarted: 0,
      downloadSuccess: 0,
      downloadFailure: 0,
      segmentsAddedToBuffer: 0
    };
    
    // Set up event listeners
    setupEventListeners(eventCounts);
    
    // Initialize service manager with test options
    logger.info('Initializing service manager with options:', testOptions);
    
    // Start the pipeline
    const pipelineStarted = await serviceManager.startPipeline({
      ...testOptions,
      immediate: true // Start immediately
    });
    
    if (!pipelineStarted) {
      throw new Error('Failed to start acquisition pipeline');
    }
    
    logger.info('Acquisition pipeline started successfully');
    
    // Wait for some time to let the pipeline run
    logger.info('Waiting for 30 seconds to gather pipeline data...');
    await new Promise(resolve => setTimeout(resolve, 30000));
    
    // Get pipeline status
    const status = serviceManager.getPipelineStatus();
    logger.info('Pipeline status:');
    logger.info(JSON.stringify(status, null, 2));
    
    // Verify event counts
    logger.info('Event counts:');
    logger.info(JSON.stringify(eventCounts, null, 2));
    
    // Verify that we have segments in the buffer
    const bufferStats = bufferService.getStats();
    logger.info('Buffer stats:');
    logger.info(JSON.stringify(bufferStats, null, 2));
    
    // Stop the pipeline
    logger.info('Stopping pipeline...');
    await serviceManager.stopPipeline();
    
    // Verify pipeline is stopped
    if (serviceManager.isRunning) {
      throw new Error('Pipeline did not stop correctly');
    }
    
    logger.info('Acquisition pipeline test completed successfully');
    
    // Return test results
    return {
      success: true,
      status,
      eventCounts,
      bufferStats
    };
  } catch (error) {
    logger.error(`Acquisition pipeline test failed: ${error.message}`);
    
    // Attempt to stop pipeline if it's running
    if (serviceManager.isRunning) {
      try {
        await serviceManager.stopPipeline();
      } catch (stopError) {
        logger.error(`Failed to stop pipeline during cleanup: ${stopError.message}`);
      }
    }
    
    throw error;
  } finally {
    // Clean up event listeners
    cleanupEventListeners();
  }
}

/**
 * Set up event listeners for all services
 * @param {Object} eventCounts - Object to track event counts
 */
function setupEventListeners(eventCounts) {
  // Monitor events
  monitorService.on('newSegment', (segment) => {
    eventCounts.newSegments++;
    logger.info(`Test: New segment detected: ${segment.sequenceNumber}`);
  });
  
  monitorService.on('discontinuity', (info) => {
    logger.warn(`Test: Discontinuity detected: ${info.skippedCount} segments skipped`);
  });
  
  // Downloader events
  downloaderService.on('downloadSuccess', (result) => {
    eventCounts.downloadSuccess++;
    logger.info(`Test: Download success: ${result.url.split('/').pop()}`);
  });
  
  downloaderService.on('downloadFailure', (error) => {
    eventCounts.downloadFailure++;
    logger.error(`Test: Download failure: ${error.url.split('/').pop()}`);
  });
  
  // Buffer events
  bufferService.on('segmentAdded', (info) => {
    eventCounts.segmentsAddedToBuffer++;
    logger.info(`Test: Segment added to buffer: ${info.segmentId}`);
  });
  
  bufferService.on('segmentExpired', (info) => {
    logger.info(`Test: Segment expired from buffer: ${info.segmentId}`);
  });
}

/**
 * Clean up event listeners
 */
function cleanupEventListeners() {
  monitorService.removeAllListeners();
  downloaderService.removeAllListeners();
  bufferService.removeAllListeners();
}

// Run the test if this script is executed directly
if (require.main === module) {
  testAcquisitionPipeline()
    .then(results => {
      logger.info('Test completed successfully with results:');
      logger.info(JSON.stringify(results, null, 2));
    })
    .catch(error => {
      logger.error(`Test failed with error: ${error.stack}`);
      process.exit(1);
    });
}

module.exports = {
  testAcquisitionPipeline
}; 