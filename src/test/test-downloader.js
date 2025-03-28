const { downloaderService } = require('../services/downloader-service');
const { bufferService } = require('../services/buffer-service');
const playlistService = require('../services/playlist-service');
const logger = require('../utils/logger');

/**
 * Test script for segment downloader service
 * Downloads a segment from an HLS playlist and verifies it's stored in the buffer
 */
async function testDownloaderService() {
  try {
    logger.info('Starting downloader service test...');
    
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
    
    // Clear buffer to ensure clean test
    bufferService.clear();
    
    // 3. Get information about the playlist
    const playlistInfo = playlistService.getPlaylistInfo(parsedPlaylist);
    logger.info('Playlist information:');
    logger.info(JSON.stringify(playlistInfo, null, 2));
    
    // 4. Download first 3 segments
    const segmentsToDownload = segmentUrls.slice(0, 3);
    logger.info(`Downloading ${segmentsToDownload.length} test segments...`);
    
    const downloadResults = [];
    
    for (let i = 0; i < segmentsToDownload.length; i++) {
      const url = segmentsToDownload[i];
      
      // Create metadata with sequential numbering and estimated duration
      const metadata = {
        sequenceNumber: i,
        duration: playlistInfo.targetDuration || 4
      };
      
      // Download the segment
      const result = await downloaderService.downloadSegment(url, metadata);
      downloadResults.push(result);
      
      logger.info(`Download ${i+1}/${segmentsToDownload.length} completed: ${result.success ? 'SUCCESS' : 'FAILURE'}`);
    }
    
    // 5. Verify segments were stored in buffer
    const bufferStats = bufferService.getBufferStats();
    logger.info('Buffer statistics after download:');
    logger.info(JSON.stringify(bufferStats, null, 2));
    
    // 6. Verify we can retrieve segments from buffer
    const firstSegmentInBuffer = bufferService.getSegmentBySequence(0);
    if (firstSegmentInBuffer) {
      logger.info('Successfully retrieved first segment from buffer');
      logger.info(`Segment URL: ${firstSegmentInBuffer.metadata.url}`);
      logger.info(`Segment size: ${firstSegmentInBuffer.size} bytes`);
      logger.info(`Content type: ${firstSegmentInBuffer.metadata.contentType}`);
    } else {
      logger.error('Failed to retrieve segment from buffer');
    }
    
    // 7. Get download statistics
    const successCount = downloadResults.filter(r => r.success).length;
    const totalBytes = downloadResults.reduce((sum, r) => sum + (r.size || 0), 0);
    const avgDownloadTime = downloadResults.reduce((sum, r) => sum + r.durationMs, 0) / downloadResults.length;
    
    logger.info('Download test statistics:');
    logger.info(`Success rate: ${successCount}/${downloadResults.length}`);
    logger.info(`Total downloaded: ${totalBytes} bytes`);
    logger.info(`Average download time: ${Math.round(avgDownloadTime)}ms per segment`);
    
    logger.info('Downloader service test completed successfully');
    
    return {
      downloadResults,
      bufferStats,
      successRate: successCount / downloadResults.length,
      totalBytes,
      avgDownloadTime
    };
  } catch (error) {
    logger.error(`Downloader test failed: ${error.message}`);
    throw error;
  }
}

// Run the test if this script is executed directly
if (require.main === module) {
  testDownloaderService().catch(error => {
    logger.error(`Unhandled error: ${error.stack}`);
    process.exit(1);
  });
}

module.exports = {
  testDownloaderService
}; 