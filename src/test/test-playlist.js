const playlistService = require('../services/playlist-service');
const logger = require('../utils/logger');
const config = require('../config/config');

/**
 * Test script for playlist service
 */
async function testPlaylistService() {
  try {
    // Test with Akamai URL
    logger.info('Testing playlist service with Akamai stream URL');
    await testStreamUrl(config.STREAM_URLS.AKAMAI);
    
    // Test with Cloudfront URL
    logger.info('Testing playlist service with Cloudfront stream URL');
    await testStreamUrl(config.STREAM_URLS.CLOUDFRONT);
    
    logger.info('Playlist service tests completed successfully');
  } catch (error) {
    logger.error(`Test failed: ${error.message}`);
    process.exit(1);
  }
}

/**
 * Test a specific stream URL
 * @param {string} url - The stream URL to test
 */
async function testStreamUrl(url) {
  try {
    logger.info(`Testing URL: ${url}`);
    
    // Fetch the playlist
    const playlistContent = await playlistService.fetchPlaylist(url);
    logger.info(`Successfully fetched playlist (${playlistContent.length} bytes)`);
    
    // Parse the playlist
    const parsedPlaylist = playlistService.parsePlaylist(playlistContent);
    logger.info('Successfully parsed playlist');
    
    // Get playlist info
    const playlistInfo = playlistService.getPlaylistInfo(parsedPlaylist);
    logger.info('Playlist information:');
    logger.info(JSON.stringify(playlistInfo, null, 2));
    
    // Extract segment URLs
    const segmentUrls = playlistService.getSegmentUrls(parsedPlaylist, url);
    logger.info(`Found ${segmentUrls.length} segment URLs`);
    
    // Log first few segment URLs (if any)
    if (segmentUrls.length > 0) {
      logger.info('First 3 segment URLs:');
      segmentUrls.slice(0, 3).forEach((url, index) => {
        logger.info(`[${index}] ${url}`);
      });
    }
    
    return { playlistInfo, segmentUrls };
  } catch (error) {
    logger.error(`Error testing URL ${url}: ${error.message}`);
    throw error;
  }
}

// Run the test if this script is executed directly
if (require.main === module) {
  testPlaylistService().catch(error => {
    logger.error(`Unhandled error: ${error.message}`);
    process.exit(1);
  });
}

module.exports = {
  testPlaylistService,
  testStreamUrl
}; 