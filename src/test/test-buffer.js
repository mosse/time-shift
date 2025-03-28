const { bufferService, BufferService } = require('../services/buffer-service');
const logger = require('../utils/logger');

/**
 * Test script for buffer service
 */
async function testBufferService() {
  try {
    logger.info('Testing buffer service...');
    
    // Create a test buffer with a shorter duration for testing
    const testBuffer = new BufferService(10000); // 10 seconds
    
    // Add a few test segments
    logger.info('Adding test segments...');
    
    // Create sample data (in a real app, this would be binary audio data)
    const createSampleData = (size) => Buffer.alloc(size, 'A');
    
    // Add segments with different timestamps
    testBuffer.addSegment(
      createSampleData(1024), 
      { url: 'https://example.com/segment1.ts', sequenceNumber: 1, duration: 2 }
    );
    
    logger.info('Added first segment');
    
    // Wait 1 second
    await new Promise(resolve => setTimeout(resolve, 1000));
    
    testBuffer.addSegment(
      createSampleData(2048), 
      { url: 'https://example.com/segment2.ts', sequenceNumber: 2, duration: 3 }
    );
    
    logger.info('Added second segment');
    
    // Wait 1 second
    await new Promise(resolve => setTimeout(resolve, 1000));
    
    testBuffer.addSegment(
      createSampleData(3072), 
      { url: 'https://example.com/segment3.ts', sequenceNumber: 3, duration: 4 }
    );
    
    logger.info('Added third segment');
    
    // Get and log buffer stats
    const stats = testBuffer.getStats();
    logger.info('Buffer statistics:');
    logger.info(JSON.stringify(stats, null, 2));
    
    // Get oldest and newest segments
    const oldest = testBuffer.getOldestSegment();
    const newest = testBuffer.getNewestSegment();
    
    logger.info(`Oldest segment: ${oldest.metadata.url}, added at ${oldest.metadata.addedAt}`);
    logger.info(`Newest segment: ${newest.metadata.url}, added at ${newest.metadata.addedAt}`);
    
    // Test time range query
    const middleTimestamp = oldest.timestamp + 
      Math.floor((newest.timestamp - oldest.timestamp) / 2);
    
    const rangeSegments = testBuffer.getSegmentsInRange(middleTimestamp, newest.timestamp);
    logger.info(`Found ${rangeSegments.length} segments in time range`);
    
    // Test pruning
    logger.info('Testing pruning functionality...');
    logger.info('Waiting for segments to expire...');
    
    // Wait 9 seconds for segments to expire (buffer duration is 10 seconds)
    await new Promise(resolve => setTimeout(resolve, 9000));
    
    // Add another segment
    testBuffer.addSegment(
      createSampleData(4096), 
      { url: 'https://example.com/segment4.ts', sequenceNumber: 4, duration: 5 }
    );
    
    logger.info('Added fourth segment after waiting');
    
    // Get updated stats
    const updatedStats = testBuffer.getStats();
    logger.info('Updated buffer statistics:');
    logger.info(JSON.stringify(updatedStats, null, 2));
    
    // Demonstrate manual pruning
    const prunedCount = testBuffer.pruneOldSegments();
    logger.info(`Manually pruned ${prunedCount} segments`);
    
    // Final stats
    const finalStats = testBuffer.getStats();
    logger.info('Final buffer statistics:');
    logger.info(JSON.stringify(finalStats, null, 2));
    
    logger.info('Buffer service test completed successfully');
    return { stats, updatedStats, finalStats };
  } catch (error) {
    logger.error(`Test failed: ${error.message}`);
    throw error;
  }
}

// Run the test if this script is executed directly
if (require.main === module) {
  testBufferService().catch(error => {
    logger.error(`Unhandled error: ${error.stack}`);
    process.exit(1);
  });
}

module.exports = {
  testBufferService
}; 