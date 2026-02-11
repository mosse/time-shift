/**
 * Tests for playlist generator expansion logic
 * Verifies that playlists expand from anchor correctly when segments
 * before the anchor don't exist.
 */

const { PlaylistGenerator } = require('../services/playlist-generator');
const logger = require('../utils/logger');

// Mock buffer service that simulates edge-of-buffer scenario
class MockBufferService {
  constructor(startSequence, segmentCount) {
    this.startSequence = startSequence;
    this.segmentCount = segmentCount;
    this.segments = new Map();

    // Create segments starting from startSequence
    for (let i = 0; i < segmentCount; i++) {
      const seq = startSequence + i;
      this.segments.set(seq, {
        timestamp: Date.now() + (i * 6400),
        metadata: {
          sequenceNumber: seq,
          duration: 6.4,
          url: `https://example.com/segment${seq}.ts`
        },
        size: 81592,
        data: Buffer.alloc(81592)
      });
    }
  }

  async getSegmentAt(targetTime) {
    // Return the first segment as anchor
    return this.segments.get(this.startSequence);
  }

  async getSegmentBySequence(seq) {
    return this.segments.get(seq) || null;
  }

  getOldestSegmentTime() {
    return Date.now();
  }
}

async function testExpansionFromAnchor() {
  logger.info('Test: Playlist expands forward when no segments before anchor');

  // Create buffer with segments 100-109 (no segments before 100)
  const mockBuffer = new MockBufferService(100, 10);

  const generator = new PlaylistGenerator({
    segmentCount: 5,
    timeShiftDuration: 1000,
    bufferService: mockBuffer
  });

  const playlist = await generator.generatePlaylist();

  // Should have 5 segments starting from 100
  const segmentCount = (playlist.m3u8Content.match(/#EXTINF/g) || []).length;

  if (segmentCount !== 5) {
    throw new Error(`Expected 5 segments, got ${segmentCount}`);
  }

  // Should start at sequence 100
  if (!playlist.m3u8Content.includes('#EXT-X-MEDIA-SEQUENCE:100')) {
    throw new Error('Expected media sequence to start at 100');
  }

  // Should include segments 100-104
  for (let i = 100; i <= 104; i++) {
    if (!playlist.m3u8Content.includes(`/stream/segment/${i}.ts`)) {
      throw new Error(`Expected segment ${i} in playlist`);
    }
  }

  logger.info('PASSED: Playlist correctly expands forward from anchor');
}

async function testExpansionBothDirections() {
  logger.info('Test: Playlist expands in both directions when possible');

  // Create buffer with segments 100-109
  const mockBuffer = new MockBufferService(100, 10);

  // Override getSegmentAt to return segment in the middle
  mockBuffer.getSegmentAt = async () => mockBuffer.segments.get(105);

  const generator = new PlaylistGenerator({
    segmentCount: 5,
    timeShiftDuration: 1000,
    bufferService: mockBuffer
  });

  const playlist = await generator.generatePlaylist();

  const segmentCount = (playlist.m3u8Content.match(/#EXTINF/g) || []).length;

  if (segmentCount !== 5) {
    throw new Error(`Expected 5 segments, got ${segmentCount}`);
  }

  // Should have segments around 105 (could be 103-107 or 104-108 depending on expansion order)
  if (!playlist.m3u8Content.includes('/stream/segment/105.ts')) {
    throw new Error('Expected anchor segment 105 in playlist');
  }

  logger.info('PASSED: Playlist correctly expands in both directions');
}

async function testPartialBuffer() {
  logger.info('Test: Playlist handles partial buffer (fewer segments than requested)');

  // Create buffer with only 3 segments
  const mockBuffer = new MockBufferService(100, 3);

  const generator = new PlaylistGenerator({
    segmentCount: 5,  // Request 5 but only 3 available
    timeShiftDuration: 1000,
    bufferService: mockBuffer
  });

  const playlist = await generator.generatePlaylist();

  const segmentCount = (playlist.m3u8Content.match(/#EXTINF/g) || []).length;

  if (segmentCount !== 3) {
    throw new Error(`Expected 3 segments (all available), got ${segmentCount}`);
  }

  logger.info('PASSED: Playlist correctly handles partial buffer');
}

async function runTests() {
  logger.info('=== Running Playlist Expansion Tests ===');

  try {
    await testExpansionFromAnchor();
    await testExpansionBothDirections();
    await testPartialBuffer();

    logger.info('=== All Playlist Expansion Tests PASSED ===');
    process.exit(0);
  } catch (error) {
    logger.error(`Test FAILED: ${error.message}`);
    process.exit(1);
  }
}

if (require.main === module) {
  runTests();
}

module.exports = { runTests };
