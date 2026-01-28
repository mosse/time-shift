const { playlistGenerator, PlaylistGenerator } = require('../services/playlist-generator');
const { BufferService } = require('../services/buffer-service');
const { HybridBufferService } = require('../services/hybrid-buffer-service');
const logger = require('../utils/logger');
const config = require('../config/config');
const { Parser } = require('m3u8-parser');

/**
 * Test script for playlist generator service
 */
async function testPlaylistGenerator() {
  try {
    logger.info('Testing playlist generator service');
    
    // Test with a mock buffer
    await testWithMockBuffer();
    
    // Test with empty buffer
    await testWithEmptyBuffer();
    
    // Test playlist format validation
    await testPlaylistFormat();
    
    logger.info('Playlist generator tests completed successfully');
  } catch (error) {
    logger.error(`Test failed: ${error.message}`);
    process.exit(1);
  }
}

/**
 * Test playlist generation with a mock buffer containing segments
 */
async function testWithMockBuffer() {
  try {
    logger.info('Testing playlist generation with mock buffer');
    
    // Create a mock buffer service with test segments
    const mockBuffer = createMockBufferService();
    
    // Create a test instance of playlist generator that uses our mock buffer
    const testGenerator = new PlaylistGenerator({
      segmentCount: 5,
      timeShiftDuration: 10000, // Small delay for testing
      bufferService: mockBuffer // Pass the mock buffer service directly
    });
    
    // Generate a playlist
    const playlist = await testGenerator.generatePlaylist();

    // Verify playlist is not empty
    if (!playlist || !playlist.m3u8Content || playlist.m3u8Content.length === 0) {
      throw new Error('Generated playlist is empty');
    }

    logger.info(`Generated playlist (${playlist.m3u8Content.length} bytes):`);
    logger.info(playlist.m3u8Content.split('\n').slice(0, 10).join('\n') + '...');

    // Parse the playlist to verify it's valid
    const parser = new Parser();
    parser.push(playlist.m3u8Content);
    parser.end();
    const parsedPlaylist = parser.manifest;

    // Verify playlist has segments
    if (!parsedPlaylist.segments || parsedPlaylist.segments.length === 0) {
      throw new Error('Playlist has no segments');
    }

    logger.info(`Playlist contains ${parsedPlaylist.segments.length} segments`);
    logger.info('First segment duration:', parsedPlaylist.segments[0].duration);
    logger.info('Mock buffer test passed');

    return parsedPlaylist;
  } catch (error) {
    logger.error(`Error in mock buffer test: ${error.message}`);
    throw error;
  }
}

/**
 * Test playlist generation with an empty buffer
 */
async function testWithEmptyBuffer() {
  try {
    logger.info('Testing playlist generation with empty buffer');

    // Create an empty mock buffer service
    const emptyBuffer = new BufferService();

    // Create a test instance of playlist generator that uses our empty buffer
    const testGenerator = new PlaylistGenerator({
      bufferService: emptyBuffer // Pass the empty buffer service directly
    });

    // Generate a playlist
    const playlist = await testGenerator.generatePlaylist();

    // Verify playlist is not empty (should generate an empty playlist with correct headers)
    if (!playlist || !playlist.m3u8Content || playlist.m3u8Content.length === 0) {
      throw new Error('Generated empty playlist is completely empty');
    }

    logger.info(`Generated empty playlist (${playlist.m3u8Content.length} bytes):`);
    logger.info(playlist.m3u8Content);

    // Verify it contains the expected placeholder
    if (!playlist.m3u8Content.includes('unavailable.ts')) {
      throw new Error('Empty playlist should contain unavailable segment reference');
    }

    logger.info('Empty buffer test passed');

    return playlist;
  } catch (error) {
    logger.error(`Error in empty buffer test: ${error.message}`);
    throw error;
  }
}

/**
 * Test that the generated playlist follows HLS format rules
 */
async function testPlaylistFormat() {
  try {
    logger.info('Testing playlist format validation');

    // Create a mock buffer service with test segments
    const mockBuffer = createMockBufferService();

    // Create a custom test instance of playlist generator
    const testGenerator = new PlaylistGenerator({
      segmentCount: 4,
      timeShiftDuration: 10000, // Small delay for testing
      bufferService: mockBuffer // Pass the mock buffer service directly
    });

    // Generate a playlist
    const playlist = await testGenerator.generatePlaylist();
    
    // Check required HLS tags
    const requiredTags = [
      '#EXTM3U',
      '#EXT-X-VERSION:',
      '#EXT-X-TARGETDURATION:',
      '#EXT-X-MEDIA-SEQUENCE:',
      '#EXTINF:'
    ];
    
    for (const tag of requiredTags) {
      if (!playlist.m3u8Content.includes(tag)) {
        throw new Error(`Required HLS tag ${tag} missing from playlist`);
      }
    }
    
    // Parse the playlist to verify it's valid
    const parser = new Parser();
    parser.push(playlist.m3u8Content);
    parser.end();
    const parsedPlaylist = parser.manifest;
    
    // Check required fields
    if (parsedPlaylist.targetDuration <= 0) {
      throw new Error('Invalid target duration in playlist');
    }
    
    // For this test, we accept either the real segments or the unavailable segment
    const segmentCount = parsedPlaylist.segments.length;
    if (segmentCount < 1) {
      throw new Error(`Expected at least 1 segment but found ${segmentCount}`);
    }
    
    logger.info(`Playlist format validation passed with ${segmentCount} segments`);
    
    return true;
  } catch (error) {
    logger.error(`Error in playlist format test: ${error.message}`);
    throw error;
  }
}

/**
 * Create a mock buffer service with test segments
 */
function createMockBufferService() {
  const mockBuffer = new BufferService();
  
  // Add some test segments to the buffer
  const now = Date.now();
  
  // Create 10 segments with sequential sequence numbers
  for (let i = 0; i < 10; i++) {
    const segmentData = Buffer.from(`Test segment data ${i}`);
    mockBuffer.addSegment(segmentData, {
      url: `http://example.com/segment${i}.ts`,
      sequenceNumber: 1000 + i,
      duration: 10.0
    });
  }
  
  // Override getSegmentAt to return a specific segment
  const originalGetSegmentAt = mockBuffer.getSegmentAt;
  mockBuffer.getSegmentAt = (targetTime) => {
    // Always return the middle segment for testing
    const segments = mockBuffer.segments;
    if (segments.length === 0) return null;
    return segments[Math.floor(segments.length / 2)];
  };
  
  return mockBuffer;
}

// Run the test if this script is executed directly
if (require.main === module) {
  testPlaylistGenerator().catch(error => {
    logger.error(`Unhandled error: ${error.message}`);
    process.exit(1);
  });
}

module.exports = {
  testPlaylistGenerator
}; 