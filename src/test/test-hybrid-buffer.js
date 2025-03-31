const { HybridBufferService } = require('../services/hybrid-buffer-service');
const logger = require('../utils/logger');
const path = require('path');
const fs = require('fs').promises;

/**
 * Test script for hybrid buffer service
 */
async function testHybridBufferService() {
  try {
    logger.info('Testing hybrid buffer service...');
    
    // Create a test directory for this run
    const testDir = path.join('./data', 'test-hybrid', `test-${Date.now()}`);
    
    // Create a test buffer with a shorter duration for testing
    const testBuffer = new HybridBufferService(10000); // 10 seconds
    
    // Set storage options and initialize
    logger.info('Initializing hybrid buffer service...');
    await testBuffer.initialize({
      diskStorageEnabled: true,
      duration: 10000
    });
    
    // Create sample data (in a real app, this would be binary audio data)
    const createSampleData = (size, value) => Buffer.alloc(size, value);
    
    // Add segments
    logger.info('Adding test segments...');
    
    // Add segments with different timestamps
    const segment1 = await testBuffer.addSegment(
      createSampleData(1024, 'A'.charCodeAt(0)), 
      { url: 'https://example.com/segment1.ts', sequenceNumber: 1, duration: 2 }
    );
    
    logger.info('Added first segment');
    
    // Wait 1 second
    await new Promise(resolve => setTimeout(resolve, 1000));
    
    const segment2 = await testBuffer.addSegment(
      createSampleData(2048, 'B'.charCodeAt(0)), 
      { url: 'https://example.com/segment2.ts', sequenceNumber: 2, duration: 3 }
    );
    
    logger.info('Added second segment');
    
    // Wait 1 second
    await new Promise(resolve => setTimeout(resolve, 1000));
    
    const segment3 = await testBuffer.addSegment(
      createSampleData(3072, 'C'.charCodeAt(0)), 
      { url: 'https://example.com/segment3.ts', sequenceNumber: 3, duration: 4 }
    );
    
    logger.info('Added third segment');
    
    // Get and log buffer stats
    const stats = testBuffer.getStats();
    logger.info('Buffer statistics:');
    logger.info(JSON.stringify(stats, null, 2));
    
    // Verify we can get segments by timestamp
    const segmentByTimestamp = await testBuffer.getSegmentByTimestamp(segment2.timestamp);
    if (segmentByTimestamp && segmentByTimestamp.data) {
      logger.info(`Retrieved segment by timestamp: ${segmentByTimestamp.metadata.url}`);
      logger.info(`Segment data size: ${segmentByTimestamp.data.length} bytes`);
    }
    
    // Verify we can get segments by sequence
    const segmentBySequence = await testBuffer.getSegmentBySequence(3);
    if (segmentBySequence && segmentBySequence.data) {
      logger.info(`Retrieved segment by sequence: ${segmentBySequence.metadata.url}`);
      logger.info(`Segment data size: ${segmentBySequence.data.length} bytes`);
    }
    
    // Get oldest and newest segments
    const oldest = await testBuffer.getOldestSegment();
    const newest = await testBuffer.getNewestSegment();
    
    if (oldest && newest) {
      logger.info(`Oldest segment: ${oldest.metadata.url}, added at ${oldest.metadata.addedAt}`);
      logger.info(`Newest segment: ${newest.metadata.url}, added at ${newest.metadata.addedAt}`);
    }
    
    // Test time range query
    const middleTimestamp = oldest.timestamp + 
      Math.floor((newest.timestamp - oldest.timestamp) / 2);
    
    const rangeSegments = await testBuffer.getSegmentsInRange(middleTimestamp, newest.timestamp);
    logger.info(`Found ${rangeSegments.length} segments in time range`);
    
    // Test health status
    const health = testBuffer.getBufferHealth();
    logger.info('Buffer health:');
    logger.info(JSON.stringify(health, null, 2));
    
    // Test pruning
    logger.info('Testing pruning functionality...');
    logger.info('Waiting for segments to expire...');
    
    // Wait 9 seconds for segments to expire (buffer duration is 10 seconds)
    await new Promise(resolve => setTimeout(resolve, 9000));
    
    // Add another segment
    const segment4 = await testBuffer.addSegment(
      createSampleData(4096, 'D'.charCodeAt(0)), 
      { url: 'https://example.com/segment4.ts', sequenceNumber: 4, duration: 5 }
    );
    
    logger.info('Added fourth segment after waiting');
    
    // Explicitly prune old segments
    const prunedCount = await testBuffer.pruneOldSegments();
    logger.info(`Manually pruned ${prunedCount} segments`);
    
    // Get updated stats
    const updatedStats = testBuffer.getStats();
    logger.info('Updated buffer statistics:');
    logger.info(JSON.stringify(updatedStats, null, 2));
    
    // Check if first segment is still accessible
    const segment1AfterPrune = await testBuffer.getSegmentBySequence(1);
    logger.info(`Segment 1 exists after pruning: ${segment1AfterPrune !== null}`);
    
    // Create a second buffer instance to test persistence
    logger.info('Testing buffer persistence by creating a second instance...');
    
    // Keep the original testBuffer intact so the metadata and segments remain
    // We want to test that a second instance can load the existing metadata and segments
    
    const secondBuffer = new HybridBufferService(10000);
    await secondBuffer.initialize({
      diskStorageEnabled: true,
      duration: 10000
    });
    
    // Get stats from second buffer
    const statsFromSecondBuffer = secondBuffer.getStats();
    logger.info('Second buffer statistics (after loading metadata):');
    logger.info(JSON.stringify(statsFromSecondBuffer, null, 2));
    
    // Try to retrieve a segment from the second buffer
    const segment4FromSecondBuffer = await secondBuffer.getSegmentBySequence(4);
    const persistenceWorked = segment4FromSecondBuffer !== null;
    
    logger.info(`Persistence test: Retrieved segment 4 from second buffer: ${persistenceWorked}`);
    
    if (segment4FromSecondBuffer && segment4FromSecondBuffer.data) {
      logger.info(`Retrieved segment data size: ${segment4FromSecondBuffer.data.length} bytes`);
    }
    
    // Now clear both buffers after testing
    logger.info('Clearing test buffers...');
    await secondBuffer.clear();
    await testBuffer.clear();
    
    logger.info('Hybrid buffer service test completed successfully');
    
    // Return result summary
    return {
      segmentsAdded: 4,
      segmentsPruned: prunedCount,
      persistence: persistenceWorked
    };
  } catch (error) {
    logger.error(`Test failed: ${error.message}`);
    throw error;
  }
}

// Run the test if this script is executed directly
if (require.main === module) {
  testHybridBufferService().catch(error => {
    logger.error(`Unhandled error: ${error.stack}`);
    process.exit(1);
  });
}

module.exports = {
  testHybridBufferService
}; 