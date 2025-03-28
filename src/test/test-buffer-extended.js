const { BufferService } = require('../services/buffer-service');
const logger = require('../utils/logger');

/**
 * Test script for extended buffer service functionality
 */
async function testExtendedBufferService() {
  try {
    logger.info('Testing extended buffer service functionality...');
    
    // Create a test buffer with a shorter duration for testing
    const testBuffer = new BufferService(30000); // 30 seconds
    
    // Create sample data (in a real app, this would be binary audio data)
    const createSampleData = (size) => Buffer.alloc(size, 'A');
    
    logger.info('Adding segments with sequential sequence numbers...');
    
    // Add segments with sequential sequence numbers
    for (let i = 0; i < 15; i++) {
      const size = 1024 * (i % 3 + 1); // Alternate segment sizes
      const duration = (i % 4) + 2; // Durations between 2-5 seconds
      
      testBuffer.addSegment(
        createSampleData(size),
        {
          url: `https://example.com/segment${i}.ts`,
          sequenceNumber: 100 + i,
          duration: duration
        }
      );
      
      // Add small delay between segments to get different timestamps
      await new Promise(resolve => setTimeout(resolve, 50));
    }
    
    logger.info('Added 15 segments with sequential sequence numbers');
    
    // Test getBufferStats
    const stats = testBuffer.getBufferStats();
    logger.info('Buffer statistics:');
    logger.info(JSON.stringify(stats, null, 2));
    
    // Test getBufferHealth
    const health = testBuffer.getBufferHealth(30, 10);
    logger.info('Buffer health assessment:');
    logger.info(JSON.stringify(health, null, 2));
    
    // Test retrieval by sequence number
    const sequenceToFind = 105;
    const segmentBySequence = testBuffer.getSegmentBySequence(sequenceToFind);
    
    if (segmentBySequence) {
      logger.info(`Found segment with sequence ${sequenceToFind}:`);
      logger.info(JSON.stringify({
        url: segmentBySequence.metadata.url,
        sequence: segmentBySequence.metadata.sequenceNumber,
        timestamp: segmentBySequence.timestamp,
        size: segmentBySequence.size
      }, null, 2));
    }
    
    // Test getSegmentAt with a timestamp in the middle of our buffer
    const oldestSegment = testBuffer.getOldestSegment();
    const newestSegment = testBuffer.getNewestSegment();
    
    const middleTimestamp = oldestSegment.timestamp + 
      Math.floor((newestSegment.timestamp - oldestSegment.timestamp) / 2);
    
    const segmentAtMiddle = testBuffer.getSegmentAt(middleTimestamp);
    
    logger.info(`Segment closest to middle timestamp ${new Date(middleTimestamp).toISOString()}:`);
    logger.info(JSON.stringify({
      url: segmentAtMiddle.metadata.url,
      sequence: segmentAtMiddle.metadata.sequenceNumber,
      timestamp: segmentAtMiddle.timestamp,
      difference: Math.abs(middleTimestamp - segmentAtMiddle.timestamp)
    }, null, 2));
    
    // Test getSegmentAt with timestamp outside buffer range
    const futureTimestamp = newestSegment.timestamp + 10000;
    const segmentAtFuture = testBuffer.getSegmentAt(futureTimestamp);
    
    logger.info(`Segment returned for future timestamp ${new Date(futureTimestamp).toISOString()}:`);
    logger.info(JSON.stringify({
      url: segmentAtFuture.metadata.url,
      sequence: segmentAtFuture.metadata.sequenceNumber,
      timestamp: segmentAtFuture.timestamp
    }, null, 2));
    
    // Test time range query within buffer
    const startTime = oldestSegment.timestamp + 200;
    const endTime = newestSegment.timestamp - 200;
    
    const rangeSegments = testBuffer.getSegmentsInRange(startTime, endTime);
    logger.info(`Found ${rangeSegments.length} segments in time range`);
    logger.info(`Range segments: ${rangeSegments.map(s => s.metadata.sequenceNumber).join(', ')}`);
    
    // Test pruning by advancing time
    logger.info('Testing gap detection and pruning...');
    
    // Add segments with a gap in sequence numbers
    for (let i = 0; i < 5; i++) {
      const seqNum = 120 + (i === 2 ? 2 : i); // Create a gap at sequence 122
      
      testBuffer.addSegment(
        createSampleData(2048),
        {
          url: `https://example.com/segment_gap${i}.ts`,
          sequenceNumber: seqNum,
          duration: 3
        }
      );
      
      await new Promise(resolve => setTimeout(resolve, 50));
    }
    
    // Check if gap is detected
    const healthAfterGap = testBuffer.getBufferHealth();
    logger.info('Buffer health after introducing a gap:');
    logger.info(JSON.stringify(healthAfterGap, null, 2));
    
    // Simulate time passing and test pruning
    logger.info('Waiting for oldest segments to expire...');
    
    // Wait for 15 seconds (half of our 30-second buffer duration)
    await new Promise(resolve => setTimeout(resolve, 15000));
    
    // Add one more segment after waiting
    testBuffer.addSegment(
      createSampleData(2048),
      {
        url: `https://example.com/segment_after_wait.ts`,
        sequenceNumber: 125,
        duration: 3
      }
    );
    
    // Check what was pruned
    const statsAfterPruning = testBuffer.getBufferStats();
    logger.info('Buffer statistics after pruning:');
    logger.info(JSON.stringify(statsAfterPruning, null, 2));
    
    // Verify sequence retrieval after pruning
    const oldSequenceToFind = 100; // This should be pruned
    const oldSegmentBySequence = testBuffer.getSegmentBySequence(oldSequenceToFind);
    
    if (oldSegmentBySequence) {
      logger.info(`Found old segment with sequence ${oldSequenceToFind}`);
    } else {
      logger.info(`Confirmed old segment with sequence ${oldSequenceToFind} was pruned`);
    }
    
    // Final stats
    const finalHealth = testBuffer.getBufferHealth();
    logger.info('Final buffer health:');
    logger.info(JSON.stringify(finalHealth, null, 2));
    
    logger.info('Extended buffer service test completed successfully');
    return { stats, health, statsAfterPruning, finalHealth };
  } catch (error) {
    logger.error(`Test failed: ${error.message}`);
    throw error;
  }
}

// Run the test if this script is executed directly
if (require.main === module) {
  testExtendedBufferService().catch(error => {
    logger.error(`Unhandled error: ${error.stack}`);
    process.exit(1);
  });
}

module.exports = {
  testExtendedBufferService
}; 