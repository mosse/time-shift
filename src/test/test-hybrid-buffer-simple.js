const { HybridBufferService } = require('../services/hybrid-buffer-service');
const { diskStorageService } = require('../services/disk-storage-service');
const logger = require('../utils/logger');
const fs = require('fs').promises;
const path = require('path');

/**
 * Simplified test for hybrid buffer persistence
 */
async function testHybridBufferPersistence() {
  try {
    logger.info('Testing hybrid buffer persistence...');
    
    // Create directories
    logger.info('Setting up test directories...');
    await fs.mkdir('data', { recursive: true });
    await fs.mkdir('data/segments', { recursive: true });
    
    // Clean up any existing data
    try {
      const metadataPath = path.join('data', 'buffer-metadata.json');
      await fs.unlink(metadataPath);
      logger.info('Removed old metadata file');
    } catch (e) {
      // Ignore if file doesn't exist
    }
    
    // Create a test buffer with short duration
    const buffer1 = new HybridBufferService(10000); // 10 seconds
    
    // Initialize with disk storage enabled
    await buffer1.initialize({
      diskStorageEnabled: true,
      duration: 10000
    });
    
    // Create test segments
    const createSampleData = (size, value) => Buffer.alloc(size, value);
    
    // Add a segment
    const testSegment = await buffer1.addSegment(
      createSampleData(1024, 'X'.charCodeAt(0)),
      { 
        url: 'https://example.com/test-segment.ts',
        sequenceNumber: 999, 
        duration: 5
      }
    );
    
    const segmentId = testSegment.metadata.segmentId;
    logger.info(`Added test segment with ID: ${segmentId}`);
    
    // Manually verify the segment file exists
    const segmentPath = path.join('data', 'segments', `${segmentId}.ts`);
    let segmentExists = false;
    
    try {
      await fs.access(segmentPath);
      segmentExists = true;
      logger.info(`Verified segment file exists at: ${segmentPath}`);
    } catch (e) {
      logger.error(`Segment file not found at: ${segmentPath}`);
    }
    
    // Get buffer stats
    const stats1 = buffer1.getBufferStats();
    logger.info('Buffer stats after adding segment:');
    logger.info(JSON.stringify(stats1, null, 2));
    
    // Save metadata manually
    await buffer1._saveMetadataToDisk();
    
    // Create a second buffer instance
    logger.info('Creating second buffer instance to test persistence...');
    const buffer2 = new HybridBufferService(10000);
    
    // Don't perform cleanup on the second buffer initialization
    // This way it will load the existing segments from disk
    await buffer2.initialize({
      diskStorageEnabled: true,
      duration: 10000,
      skipCleanup: true  // Add this option to skip clearing segments
    });
    
    // Get stats from second buffer
    const stats2 = buffer2.getBufferStats();
    logger.info('Second buffer stats after initialization:');
    logger.info(JSON.stringify(stats2, null, 2));
    
    // Try to retrieve the segment from the second buffer
    const retrievedSegment = await buffer2.getSegmentBySequence(999);
    
    if (retrievedSegment) {
      logger.info('Successfully retrieved segment from second buffer instance');
      logger.info(`Retrieved segment ID: ${retrievedSegment.metadata.segmentId}`);
      logger.info(`Retrieved segment size: ${retrievedSegment.data ? retrievedSegment.data.length : 'unknown'} bytes`);
      
      // Verify the content
      if (retrievedSegment.data) {
        const original = createSampleData(1024, 'X'.charCodeAt(0));
        const matches = original.equals(retrievedSegment.data);
        logger.info(`Segment data matches original: ${matches}`);
      }
    } else {
      logger.warn('Failed to retrieve segment from second buffer instance');
    }
    
    // Clean up both buffers
    logger.info('Clearing test buffers...');
    await buffer1.clear();
    await buffer2.clear();
    
    logger.info('Test completed');
    
    return {
      segmentAdded: testSegment !== null,
      segmentExists,
      segmentRetrieved: retrievedSegment !== null,
      persistenceWorked: retrievedSegment !== null
    };
  } catch (error) {
    logger.error(`Test failed: ${error.message}`);
    throw error;
  }
}

// Run the test if this script is executed directly
if (require.main === module) {
  testHybridBufferPersistence().catch(error => {
    logger.error(`Unhandled error: ${error.stack}`);
    process.exit(1);
  });
}

module.exports = {
  testHybridBufferPersistence
}; 