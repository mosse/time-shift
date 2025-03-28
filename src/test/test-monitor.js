const { monitorService } = require('../services/monitor-service');
const playlistService = require('../services/playlist-service');
const logger = require('../utils/logger');

/**
 * Test script for playlist monitor service
 * Tests monitoring HLS playlists for new segments
 */
async function testMonitorService() {
  try {
    logger.info('Starting playlist monitor service test...');
    
    // Define a test stream URL
    const testUrl = 'https://d2zihajmogu5jn.cloudfront.net/bipbop-advanced/gear1/prog_index.m3u8';
    
    // Set up event listeners
    setupEventListeners();
    
    // Override the monitor service URL and interval for testing
    monitorService.url = testUrl;
    monitorService.interval = 5000; // 5 seconds interval for testing
    
    // Test basic playlist fetching
    logger.info(`Testing initial playlist fetch from ${testUrl}`);
    
    // Perform first fetch to get baseline segments - pass false to skip the running check
    const initialFetch = await monitorService.fetchPlaylist(false);
    
    if (!initialFetch.success) {
      throw new Error(`Initial playlist fetch failed: ${initialFetch.error}`);
    }
    
    logger.info(`Initial playlist fetch successful, found ${initialFetch.totalSegmentsCount} segments`);
    
    // Start continuous monitoring
    logger.info('Starting continuous monitoring...');
    monitorService.startMonitoring({ immediate: false });
    
    // Wait for a bit to accumulate some data
    logger.info('Waiting for 15 seconds to gather monitoring data...');
    await new Promise(resolve => setTimeout(resolve, 15000));
    
    // Get status
    const status = monitorService.getStatus();
    logger.info('Monitor status:');
    logger.info(JSON.stringify(status, null, 2));
    
    // Stop monitoring
    logger.info('Stopping monitor...');
    monitorService.stopMonitoring();
    
    // Verify monitor stopped
    if (monitorService.isRunning) {
      throw new Error('Monitor did not stop correctly');
    }
    
    logger.info('Monitor service test completed successfully');
    
    return {
      initialFetch,
      status
    };
  } catch (error) {
    logger.error(`Monitor test failed: ${error.message}`);
    
    // Ensure monitor is stopped even if test fails
    if (monitorService.isRunning) {
      monitorService.stopMonitoring();
    }
    
    throw error;
  }
}

/**
 * Set up event listeners for the monitor service
 */
function setupEventListeners() {
  // Handle new segment event
  monitorService.on('newSegment', (segment) => {
    logger.info(`New segment detected: ${segment.url}`);
  });
  
  // Handle batch segments event
  monitorService.on('newSegments', (data) => {
    logger.info(`Batch: Found ${data.count} new segments`);
  });
  
  // Handle fetch completed event
  monitorService.on('fetched', (result) => {
    logger.info(`Playlist fetched in ${result.durationMs}ms, ${result.newSegmentsCount} new segments`);
  });
  
  // Handle error event
  monitorService.on('error', (errorInfo) => {
    logger.error(`Fetch error: ${errorInfo.error}`);
  });
  
  // Handle discontinuity event
  monitorService.on('discontinuity', (info) => {
    logger.warn(`Discontinuity detected: skipped ${info.skippedCount} segments`);
  });
  
  // Clean up the listeners after 20 seconds
  setTimeout(() => {
    monitorService.removeAllListeners();
    logger.info('Removed all event listeners');
  }, 20000);
}

// Run the test if this script is executed directly
if (require.main === module) {
  testMonitorService().catch(error => {
    logger.error(`Unhandled error: ${error.stack}`);
    process.exit(1);
  });
}

module.exports = {
  testMonitorService
}; 