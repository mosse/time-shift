const { downloaderService, ErrorCategory } = require('../services/downloader-service');
const { bufferService } = require('../services/buffer-service');
const playlistService = require('../services/playlist-service');
const logger = require('../utils/logger');

/**
 * Test script for enhanced segment downloader service
 * Tests advanced features like retry logic, download tracking, resume capability, and metrics
 */
async function testEnhancedDownloaderService() {
  try {
    logger.info('Starting enhanced downloader service test...');
    
    // Clear buffer to ensure clean test
    bufferService.clear();
    
    // Initialize downloader service
    downloaderService.initialize({
      bufferService: bufferService,
      maxRetries: 2,
      maxConcurrentDownloads: 3
    });
    
    // Clear download history to ensure clean test
    downloaderService.clearDownloadHistory();
    downloaderService.resetStats();
    
    // 1. First get a playlist to find segment URLs
    const playlistUrl = 'https://d2zihajmogu5jn.cloudfront.net/bipbop-advanced/gear1/prog_index.m3u8';
    logger.info(`Fetching test playlist from: ${playlistUrl}`);
    
    const playlistContent = await playlistService.fetchPlaylist(playlistUrl);
    const parsedPlaylist = playlistService.parsePlaylist(playlistContent);
    
    // 2. Extract segment URLs
    const segmentUrls = playlistService.getSegmentUrls(parsedPlaylist, playlistUrl);
    logger.info(`Found ${segmentUrls.length} segments in playlist`);
    
    if (segmentUrls.length === 0) {
      throw new Error('No segments found in test playlist');
    }
    
    // 3. Download first segment and analyze results
    logger.info('Downloading first segment...');
    
    const firstSegmentUrl = segmentUrls[0];
    const firstSegmentMetadata = {
      sequenceNumber: 0,
      duration: 4
    };
    
    const firstDownloadResult = await downloaderService.downloadSegment(
      firstSegmentUrl, 
      firstSegmentMetadata
    );
    
    logger.info('First segment download results:');
    logger.info(JSON.stringify({
      success: firstDownloadResult.success,
      size: firstDownloadResult.size,
      durationMs: firstDownloadResult.durationMs,
      bandwidthKbps: firstDownloadResult.bandwidthKbps
    }, null, 2));
    
    // 4. Test download tracking by downloading the same segment again
    logger.info('Testing download tracking by downloading the same segment again...');
    
    const cachedDownloadResult = await downloaderService.downloadSegment(
      firstSegmentUrl, 
      firstSegmentMetadata
    );
    
    logger.info('Cached segment download results:');
    logger.info(JSON.stringify({
      success: cachedDownloadResult.success,
      fromCache: cachedDownloadResult.fromCache,
      size: cachedDownloadResult.size
    }, null, 2));
    
    // 5. Download multiple segments in parallel
    logger.info('Testing parallel download with 3 segments...');
    
    const segmentsToDownload = segmentUrls.slice(1, 4);
    const segmentMetadata = segmentsToDownload.map((url, index) => ({
      sequenceNumber: index + 1,
      duration: 4
    }));
    
    const parallelResults = await downloaderService.downloadSegments(
      segmentsToDownload,
      { maxConcurrentDownloads: 2 } // options
    );
    
    logger.info(`Downloaded ${parallelResults.length} segments in parallel`);
    
    // 6. Test forced download (bypassing cache)
    logger.info('Testing forced download (bypassing cache)...');
    
    const forcedDownloadResult = await downloaderService.downloadSegment(
      firstSegmentUrl, 
      firstSegmentMetadata,
      { force: true } // force download
    );
    
    logger.info('Forced download results:');
    logger.info(JSON.stringify({
      success: forcedDownloadResult.success,
      fromCache: forcedDownloadResult.fromCache,
      size: forcedDownloadResult.size
    }, null, 2));
    
    // 7. Test error handling with an intentionally bad URL
    logger.info('Testing error handling with an invalid URL...');
    
    const badResult = await downloaderService.downloadSegment(
      'https://example.com/nonexistent-segment.ts',
      { sequenceNumber: 999, duration: 4 }
    );
    
    logger.info('Bad URL download results:');
    logger.info(JSON.stringify({
      success: badResult.success,
      errorCategory: badResult.errorCategory,
      errorMessage: badResult.errorMessage
    }, null, 2));
    
    // 8. Get download statistics
    const stats = downloaderService.getStats();
    
    logger.info('Final download statistics:');
    logger.info(JSON.stringify({
      totalDownloads: stats.totalDownloads,
      successfulDownloads: stats.successfulDownloads,
      failedDownloads: stats.failedDownloads,
      skippedDownloads: stats.skippedDownloads,
      totalBytes: stats.totalBytes,
      averageDownloadTime: Math.round(stats.averageDownloadTime),
      averageBandwidthKbps: stats.averageBandwidthKbps,
      successRate: Math.round(stats.successRate * 100) + '%',
      errorsByCategory: stats.errorsByCategory
    }, null, 2));
    
    // 9. Get final buffer statistics
    const bufferStats = bufferService.getBufferStats();
    logger.info('Final buffer statistics:');
    logger.info(JSON.stringify({
      segmentCount: bufferStats.segmentCount,
      totalSize: bufferStats.totalSize,
      memoryUsageMB: bufferStats.memoryUsageMB
    }, null, 2));
    
    logger.info('Enhanced downloader service test completed successfully');
    
    return {
      stats,
      bufferStats
    };
  } catch (error) {
    logger.error(`Enhanced downloader test failed: ${error.message}`);
    throw error;
  }
}

// Run the test if this script is executed directly
if (require.main === module) {
  testEnhancedDownloaderService().catch(error => {
    logger.error(`Unhandled error: ${error.stack}`);
    process.exit(1);
  });
}

module.exports = {
  testEnhancedDownloaderService
}; 