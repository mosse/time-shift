const { DiskStorageService } = require('../services/disk-storage-service');
const logger = require('../utils/logger');
const path = require('path');
const fs = require('fs').promises;

/**
 * Test script for disk storage service
 */
async function testDiskStorageService() {
  try {
    logger.info('Testing disk storage service...');
    
    // Create a test storage with a dedicated test directory
    const testDir = path.join('./data', 'test', `test-${Date.now()}`);
    const testStorage = new DiskStorageService({
      baseDir: testDir,
      segmentsDir: 'segments',
      metadataFile: 'metadata.json'
    });
    
    // Initialize the service
    logger.info('Initializing disk storage service...');
    await testStorage.initialize();
    
    // Create sample data
    logger.info('Creating test segments...');
    const createSampleData = (size, value) => Buffer.alloc(size, value);
    
    // Write segments
    const segment1 = createSampleData(1024, 'A'.charCodeAt(0));
    const segment2 = createSampleData(2048, 'B'.charCodeAt(0));
    const segment3 = createSampleData(3072, 'C'.charCodeAt(0));
    
    // Write three segments
    logger.info('Writing test segments to disk...');
    const path1 = await testStorage.writeSegment('segment1', segment1);
    const path2 = await testStorage.writeSegment('segment2', segment2);
    const path3 = await testStorage.writeSegment('segment3', segment3);
    
    logger.info(`Wrote segment1 to: ${path1}`);
    logger.info(`Wrote segment2 to: ${path2}`);
    logger.info(`Wrote segment3 to: ${path3}`);
    
    // Check if segments exist
    const segment1Exists = await testStorage.segmentExists('segment1');
    const segment2Exists = await testStorage.segmentExists('segment2');
    const segment3Exists = await testStorage.segmentExists('segment3');
    const segment4Exists = await testStorage.segmentExists('segment4');
    
    logger.info(`Segment1 exists: ${segment1Exists}`);
    logger.info(`Segment2 exists: ${segment2Exists}`);
    logger.info(`Segment3 exists: ${segment3Exists}`);
    logger.info(`Segment4 exists: ${segment4Exists}`);
    
    // List all segments
    const segments = await testStorage.listSegments();
    logger.info(`Found ${segments.length} segments: ${segments.join(', ')}`);
    
    // Read back segments
    logger.info('Reading segments from disk...');
    const readSegment1 = await testStorage.readSegment('segment1');
    const readSegment2 = await testStorage.readSegment('segment2');
    const readSegment3 = await testStorage.readSegment('segment3');
    
    logger.info(`Read segment1: ${readSegment1.length} bytes`);
    logger.info(`Read segment2: ${readSegment2.length} bytes`);
    logger.info(`Read segment3: ${readSegment3.length} bytes`);
    
    // Verify segment data matches
    const segment1Match = readSegment1.equals(segment1);
    const segment2Match = readSegment2.equals(segment2);
    const segment3Match = readSegment3.equals(segment3);
    
    logger.info(`Segment1 data matches: ${segment1Match}`);
    logger.info(`Segment2 data matches: ${segment2Match}`);
    logger.info(`Segment3 data matches: ${segment3Match}`);
    
    // Test metadata
    logger.info('Testing metadata write/read...');
    const testMetadata = {
      timestamp: Date.now(),
      segments: ['segment1', 'segment2', 'segment3'],
      stats: {
        totalSegments: 3,
        totalSize: segment1.length + segment2.length + segment3.length
      }
    };
    
    const metadataWritten = await testStorage.writeMetadata(testMetadata);
    logger.info(`Metadata written: ${metadataWritten}`);
    
    const readMetadata = await testStorage.readMetadata();
    logger.info(`Read metadata: ${JSON.stringify(readMetadata, null, 2)}`);
    
    const metadataMatch = JSON.stringify(readMetadata) === JSON.stringify(testMetadata);
    logger.info(`Metadata matches: ${metadataMatch}`);
    
    // Test deleting segments
    logger.info('Testing segment deletion...');
    const deleted1 = await testStorage.deleteSegment('segment1');
    logger.info(`Deleted segment1: ${deleted1}`);
    
    // Verify segment1 no longer exists
    const segment1ExistsAfterDelete = await testStorage.segmentExists('segment1');
    logger.info(`Segment1 exists after delete: ${segment1ExistsAfterDelete}`);
    
    // Test bulk cleanup
    logger.info('Testing bulk cleanup...');
    const keepFilter = (segmentId) => segmentId === 'segment3'; // Only keep segment3
    const deletedCount = await testStorage.cleanupSegments(keepFilter);
    logger.info(`Deleted ${deletedCount} segments during cleanup`);
    
    // Verify only segment3 remains
    const remainingSegments = await testStorage.listSegments();
    logger.info(`Remaining segments: ${remainingSegments.join(', ')}`);
    
    // Get stats
    const stats = testStorage.getStats();
    logger.info(`Storage statistics: ${JSON.stringify(stats, null, 2)}`);
    
    // Clean up the test directory
    logger.info('Cleaning up test directory...');
    try {
      await fs.rm(testDir, { recursive: true, force: true });
      logger.info(`Removed test directory: ${testDir}`);
    } catch (cleanupError) {
      logger.warn(`Failed to remove test directory: ${cleanupError.message}`);
    }
    
    logger.info('Disk storage service test completed successfully');
    
    // Return results for verification
    return {
      segmentsCreated: 3,
      segmentsListed: segments.length,
      segment1Match,
      segment2Match,
      segment3Match,
      metadataMatch,
      segment1Deleted: deleted1,
      cleanupDeletedCount: deletedCount,
      remainingSegmentsCount: remainingSegments.length
    };
  } catch (error) {
    logger.error(`Test failed: ${error.message}`);
    throw error;
  }
}

// Run the test if this script is executed directly
if (require.main === module) {
  testDiskStorageService().catch(error => {
    logger.error(`Unhandled error: ${error.stack}`);
    process.exit(1);
  });
}

module.exports = {
  testDiskStorageService
}; 