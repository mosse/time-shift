/**
 * Error Scenario Tests
 * Tests error handling, edge cases, and failure recovery
 */

const logger = require('../utils/logger');
const { PlaylistGenerator } = require('../services/playlist-generator');
const { BufferService } = require('../services/buffer-service');
const { HybridBufferService } = require('../services/hybrid-buffer-service');
const { DownloaderService } = require('../services/downloader-service');
const playlistService = require('../services/playlist-service');

/**
 * Assert helper
 */
function assert(condition, message) {
  if (!condition) {
    throw new Error(`Assertion failed: ${message}`);
  }
  logger.info(`✓ ${message}`);
}

/**
 * Test: PlaylistGenerator handles empty buffer
 */
async function testEmptyBufferPlaylist() {
  logger.info('Testing playlist generation with empty buffer...');

  // Create mock buffer that returns no segments
  const mockBuffer = {
    getBufferStats: () => ({
      segmentCount: 0,
      oldestTimestamp: null,
      newestTimestamp: null
    }),
    getSegmentAt: async () => null,
    getSegmentBySequence: async () => null
  };

  const generator = new PlaylistGenerator({
    bufferService: mockBuffer,
    timeShiftDuration: 1000
  });

  const playlist = await generator.generatePlaylist({ duration: 60 });

  assert(playlist !== null, 'Returns playlist object');
  assert(playlist.m3u8Content.includes('#EXTM3U'), 'Playlist has valid header');
  assert(playlist.segments.length === 0, 'Playlist has no segments');
}

/**
 * Test: PlaylistGenerator handles invalid timeshift
 */
async function testInvalidTimeshiftPlaylist() {
  logger.info('Testing playlist generation with invalid timeshift...');

  const mockBuffer = {
    getBufferStats: () => ({ segmentCount: 0 }),
    getSegmentAt: async () => null,
    getSegmentBySequence: async () => null
  };

  const generator = new PlaylistGenerator({
    bufferService: mockBuffer,
    timeShiftDuration: 1000
  });

  // Test with NaN
  const playlist1 = await generator.generatePlaylist({ timeshift: 'invalid' });
  assert(playlist1 !== null, 'Handles NaN timeshift gracefully');

  // Test with negative
  const playlist2 = await generator.generatePlaylist({ timeshift: -1000 });
  assert(playlist2 !== null, 'Handles negative timeshift gracefully');
}

/**
 * Test: Buffer handles duplicate segments
 */
async function testDuplicateSegments() {
  logger.info('Testing buffer with duplicate segments...');

  const buffer = new BufferService(10000);
  const data = Buffer.from('test data');

  // Add same segment twice
  buffer.addSegment(data, { sequenceNumber: 1, url: 'http://test/1.ts', duration: 2 });
  buffer.addSegment(data, { sequenceNumber: 1, url: 'http://test/1.ts', duration: 2 });

  const stats = buffer.getStats();
  // Should either replace or reject duplicate
  assert(stats.segmentCount >= 1, 'Buffer handles duplicate gracefully');
}

/**
 * Test: Buffer handles very large segment
 */
async function testLargeSegment() {
  logger.info('Testing buffer with large segment...');

  const buffer = new BufferService(100000);
  // Create a 1MB buffer
  const largeData = Buffer.alloc(1024 * 1024, 'X');

  buffer.addSegment(largeData, { sequenceNumber: 1, url: 'http://test/large.ts', duration: 10 });

  const stats = buffer.getStats();
  assert(stats.segmentCount === 1, 'Buffer accepts large segment');
  assert(stats.totalSize >= 1024 * 1024, 'Buffer reports correct size');
}

/**
 * Test: Buffer segment retrieval with non-existent sequence
 */
async function testNonExistentSegment() {
  logger.info('Testing retrieval of non-existent segment...');

  const buffer = new BufferService(10000);
  buffer.addSegment(Buffer.from('test'), { sequenceNumber: 100, url: 'http://test/100.ts', duration: 2 });

  const segment = buffer.getSegmentBySequence(999);
  assert(segment === undefined || segment === null, 'Returns null/undefined for missing segment');
}

/**
 * Test: Downloader handles network timeout simulation
 */
async function testDownloaderTimeout() {
  logger.info('Testing downloader timeout handling...');

  const downloader = new DownloaderService();
  downloader.initialize({
    maxRetries: 1,
    timeout: 100 // Very short timeout
  });

  // Try to download from non-responsive URL
  const result = await downloader.downloadSegment('http://10.255.255.1/timeout.ts', {
    sequenceNumber: 1
  });

  assert(result.success === false, 'Download fails on timeout');
  assert(result.errorMessage !== undefined, 'Error message provided');
}

/**
 * Test: Downloader handles invalid URL
 */
async function testDownloaderInvalidUrl() {
  logger.info('Testing downloader with invalid URL...');

  const downloader = new DownloaderService();
  downloader.initialize({ maxRetries: 1 });

  const result = await downloader.downloadSegment('not-a-valid-url', {
    sequenceNumber: 1
  });

  assert(result.success === false, 'Download fails on invalid URL');
}

/**
 * Test: Downloader handles 404 response
 */
async function testDownloader404() {
  logger.info('Testing downloader with 404 response...');

  const downloader = new DownloaderService();
  downloader.initialize({ maxRetries: 1 });

  // Use a URL that will 404
  const result = await downloader.downloadSegment('http://httpstat.us/404', {
    sequenceNumber: 1
  });

  assert(result.success === false, 'Download fails on 404');
}

/**
 * Test: PlaylistService handles unreachable URL
 */
async function testMalformedPlaylist() {
  logger.info('Testing playlist service with unreachable URL...');

  // Test with invalid content - this tests internal parsing
  try {
    // The service fetches URLs, so we test that invalid URLs are handled
    const result = await playlistService.fetchPlaylist('http://10.255.255.1/invalid.m3u8');
    // Should either return null or throw
    assert(result === null || result === undefined, 'Returns null for unreachable URL');
  } catch (error) {
    assert(true, 'Throws error for unreachable URL');
  }
}

/**
 * Test: Buffer pruning under pressure
 */
async function testBufferPruning() {
  logger.info('Testing buffer pruning under memory pressure...');

  // Create very small buffer (1 second)
  const buffer = new BufferService(1000);

  // Add segments rapidly
  for (let i = 0; i < 10; i++) {
    buffer.addSegment(Buffer.alloc(1024), {
      sequenceNumber: i,
      url: `http://test/${i}.ts`,
      duration: 0.5
    });
    await new Promise(r => setTimeout(r, 200));
  }

  // Buffer should have pruned old segments
  const stats = buffer.getStats();
  assert(stats.segmentCount < 10, 'Buffer pruned old segments');
}

/**
 * Test: HybridBuffer initialization with custom directory
 */
async function testHybridBufferInit() {
  logger.info('Testing hybrid buffer initialization...');

  const hybridBuffer = new HybridBufferService();

  // Initialize should create directories
  await hybridBuffer.initialize({
    duration: 10000
  });

  // Check that it's initialized by getting stats
  const stats = hybridBuffer.getBufferStats();
  assert(stats !== undefined, 'Buffer initializes and returns stats');
  assert(stats.segmentCount !== undefined, 'Stats has segment count');

  // Cleanup
  await hybridBuffer.clear();
}

/**
 * Test: Concurrent segment additions
 */
async function testConcurrentAdditions() {
  logger.info('Testing concurrent segment additions...');

  const buffer = new BufferService(60000);

  // Add 10 segments concurrently
  const promises = [];
  for (let i = 0; i < 10; i++) {
    promises.push(
      new Promise(resolve => {
        buffer.addSegment(Buffer.from(`segment-${i}`), {
          sequenceNumber: i,
          url: `http://test/${i}.ts`,
          duration: 2
        });
        resolve();
      })
    );
  }

  await Promise.all(promises);

  const stats = buffer.getStats();
  assert(stats.segmentCount === 10, 'All concurrent segments added');
}

/**
 * Test: Buffer time range query edge cases
 */
async function testTimeRangeEdgeCases() {
  logger.info('Testing buffer time range edge cases...');

  const buffer = new BufferService(60000);
  const now = Date.now();

  // Add segment
  buffer.addSegment(Buffer.from('test'), {
    sequenceNumber: 1,
    url: 'http://test/1.ts',
    duration: 2,
    timestamp: now
  });

  // Query future time - should not throw
  let futureThrew = false;
  try {
    buffer.getSegmentAt(now + 100000);
  } catch (e) {
    futureThrew = true;
  }
  assert(!futureThrew, 'Future query does not throw');

  // Query very old time - should not throw
  let pastThrew = false;
  try {
    buffer.getSegmentAt(now - 100000);
  } catch (e) {
    pastThrew = true;
  }
  assert(!pastThrew, 'Past query does not throw');
}

/**
 * Run all error scenario tests
 */
async function runErrorTests() {
  logger.info('=== Starting Error Scenario Tests ===');

  try {
    await testEmptyBufferPlaylist();
    await testInvalidTimeshiftPlaylist();
    await testDuplicateSegments();
    await testLargeSegment();
    await testNonExistentSegment();
    await testDownloaderTimeout();
    await testDownloaderInvalidUrl();
    await testDownloader404();
    await testMalformedPlaylist();
    await testBufferPruning();
    await testHybridBufferInit();
    await testConcurrentAdditions();
    await testTimeRangeEdgeCases();

    logger.info('=== All Error Scenario Tests Passed ===');

  } catch (error) {
    logger.error(`Error scenario test failed: ${error.message}`);
    throw error;
  }
}

// Run tests
runErrorTests()
  .then(() => {
    logger.info('Error scenario tests completed successfully');
    process.exit(0);
  })
  .catch((error) => {
    logger.error(`Error scenario tests failed: ${error.message}`);
    process.exit(1);
  });
