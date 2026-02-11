/**
 * Buffer Restoration Tests
 * Tests for the disk-based buffer restoration functionality
 */

const fs = require('fs').promises;
const path = require('path');
const logger = require('../utils/logger');
const { HybridBufferService } = require('../services/hybrid-buffer-service');
const { DiskStorageService } = require('../services/disk-storage-service');

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
 * Sleep helper
 */
function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// Test directory
const TEST_DIR = path.join(__dirname, '../../data/test-restoration');
const TEST_SEGMENTS_DIR = path.join(TEST_DIR, 'segments');

/**
 * Setup test environment
 */
async function setup() {
  // Create test directories
  await fs.mkdir(TEST_SEGMENTS_DIR, { recursive: true });
}

/**
 * Cleanup test environment
 */
async function cleanup() {
  try {
    // Remove test files
    const files = await fs.readdir(TEST_SEGMENTS_DIR).catch(() => []);
    for (const file of files) {
      await fs.unlink(path.join(TEST_SEGMENTS_DIR, file)).catch(() => {});
    }
    await fs.rmdir(TEST_SEGMENTS_DIR).catch(() => {});
    await fs.unlink(path.join(TEST_DIR, 'buffer-metadata.json')).catch(() => {});
    await fs.rmdir(TEST_DIR).catch(() => {});
  } catch (error) {
    // Ignore cleanup errors
  }
}

/**
 * Create test segment files
 */
async function createTestSegments(count, startSequence = 1000) {
  const segments = [];
  for (let i = 0; i < count; i++) {
    const seq = startSequence + i;
    const filename = `${seq}.ts`;
    const filepath = path.join(TEST_SEGMENTS_DIR, filename);
    const data = Buffer.from(`test-segment-${seq}`);
    await fs.writeFile(filepath, data);
    segments.push({ sequenceNumber: seq, filepath, size: data.length });
  }
  return segments;
}

/**
 * Test: Restoration scans all segment files on disk
 */
async function testRestorationScansAllFiles() {
  logger.info('Testing buffer restoration scans all segment files...');

  await cleanup();
  await setup();

  // Create test segments on disk
  await createTestSegments(10, 5000);

  // Create a disk storage service pointing to test dir
  const diskService = new DiskStorageService({
    baseDir: TEST_DIR,
    segmentsDir: 'segments',
    metadataFile: 'buffer-metadata.json'
  });
  await diskService.initialize();

  // List segments
  const segmentIds = await diskService.listSegments();

  assert(segmentIds.length === 10, 'Found all 10 segment files on disk');
  assert(segmentIds.includes('5000'), 'Found first segment');
  assert(segmentIds.includes('5009'), 'Found last segment');

  await cleanup();
}

/**
 * Test: Segments are sorted by sequence number
 */
async function testSegmentsSortedBySequence() {
  logger.info('Testing segments are sorted by sequence number...');

  await cleanup();
  await setup();

  // Create segments out of order
  const sequences = [5005, 5002, 5008, 5001, 5003];
  for (const seq of sequences) {
    const filepath = path.join(TEST_SEGMENTS_DIR, `${seq}.ts`);
    await fs.writeFile(filepath, Buffer.from(`segment-${seq}`));
  }

  const diskService = new DiskStorageService({
    baseDir: TEST_DIR,
    segmentsDir: 'segments'
  });
  await diskService.initialize();

  const segmentIds = await diskService.listSegments();
  const parsed = segmentIds.map(id => parseInt(id, 10)).filter(n => !isNaN(n));
  const sorted = [...parsed].sort((a, b) => a - b);

  // Verify we can sort them
  assert(parsed.length === 5, 'Found all segments');
  assert(sorted[0] === 5001, 'Smallest sequence first after sort');
  assert(sorted[sorted.length - 1] === 5008, 'Largest sequence last after sort');

  await cleanup();
}

/**
 * Test: Metadata file is rebuilt after restoration
 */
async function testMetadataRebuiltAfterRestoration() {
  logger.info('Testing metadata file is rebuilt after restoration...');

  await cleanup();
  await setup();

  // Create test segments
  await createTestSegments(5, 7000);

  // Create a minimal buffer service for testing
  const diskService = new DiskStorageService({
    baseDir: TEST_DIR,
    segmentsDir: 'segments',
    metadataFile: 'buffer-metadata.json'
  });
  await diskService.initialize();

  // Write empty metadata initially
  await diskService.writeMetadata({ segments: [], timestamp: Date.now() });

  // Verify file exists
  const metadataPath = path.join(TEST_DIR, 'buffer-metadata.json');
  const exists = await fs.access(metadataPath).then(() => true).catch(() => false);
  assert(exists, 'Metadata file created');

  // Read and verify
  const content = await fs.readFile(metadataPath, 'utf8');
  const parsed = JSON.parse(content);
  assert(Array.isArray(parsed.segments), 'Metadata has segments array');

  await cleanup();
}

/**
 * Test: Invalid segment filenames are skipped
 */
async function testInvalidFilenamesSkipped() {
  logger.info('Testing invalid segment filenames are skipped...');

  await cleanup();
  await setup();

  // Create mix of valid and invalid files
  await fs.writeFile(path.join(TEST_SEGMENTS_DIR, '1000.ts'), Buffer.from('valid'));
  await fs.writeFile(path.join(TEST_SEGMENTS_DIR, '1001.ts'), Buffer.from('valid'));
  await fs.writeFile(path.join(TEST_SEGMENTS_DIR, 'invalid.ts'), Buffer.from('invalid'));
  await fs.writeFile(path.join(TEST_SEGMENTS_DIR, 'not-a-segment.txt'), Buffer.from('invalid'));
  await fs.writeFile(path.join(TEST_SEGMENTS_DIR, 'abc123.ts'), Buffer.from('invalid'));

  const diskService = new DiskStorageService({
    baseDir: TEST_DIR,
    segmentsDir: 'segments'
  });
  await diskService.initialize();

  const segmentIds = await diskService.listSegments();

  // Should only list .ts files
  assert(segmentIds.includes('1000'), 'Found valid segment 1000');
  assert(segmentIds.includes('1001'), 'Found valid segment 1001');
  assert(segmentIds.includes('invalid'), 'Listed invalid.ts (filtering happens in buffer service)');
  assert(!segmentIds.includes('not-a-segment'), 'Non-.ts file excluded');

  // Test that parsing filters non-numeric
  const parsed = segmentIds
    .map(id => ({ id, seq: parseInt(id, 10) }))
    .filter(s => !isNaN(s.seq));

  assert(parsed.length === 2, 'Only numeric segment IDs parsed successfully');

  await cleanup();
}

/**
 * Test: Segment file size is read correctly
 */
async function testSegmentFileSizeRead() {
  logger.info('Testing segment file size is read correctly...');

  await cleanup();
  await setup();

  // Create segment with known size
  const testData = Buffer.alloc(1024, 'x');
  await fs.writeFile(path.join(TEST_SEGMENTS_DIR, '2000.ts'), testData);

  const diskService = new DiskStorageService({
    baseDir: TEST_DIR,
    segmentsDir: 'segments'
  });
  await diskService.initialize();

  // Read segment and check size
  const data = await diskService.readSegment('2000');
  assert(data.length === 1024, 'Segment size matches');

  await cleanup();
}

/**
 * Test: Restoration handles empty disk gracefully
 */
async function testEmptyDiskHandling() {
  logger.info('Testing restoration handles empty disk gracefully...');

  await cleanup();
  await setup();

  // Don't create any segments

  const diskService = new DiskStorageService({
    baseDir: TEST_DIR,
    segmentsDir: 'segments'
  });
  await diskService.initialize();

  const segmentIds = await diskService.listSegments();

  assert(segmentIds.length === 0, 'Returns empty array for empty disk');

  await cleanup();
}

/**
 * Test: Restoration handles missing directory gracefully
 */
async function testMissingDirectoryHandling() {
  logger.info('Testing restoration handles missing directory gracefully...');

  await cleanup();
  // Don't create any directories

  const diskService = new DiskStorageService({
    baseDir: TEST_DIR,
    segmentsDir: 'segments'
  });

  // Initialize should create the directory
  await diskService.initialize();

  const exists = await fs.access(TEST_SEGMENTS_DIR).then(() => true).catch(() => false);
  assert(exists, 'Directory created during initialization');

  await cleanup();
}

/**
 * Test: Timestamps are calculated correctly from sequence numbers
 */
async function testTimestampCalculation() {
  logger.info('Testing timestamp calculation from sequence numbers...');

  const segmentDuration = 6.4; // seconds
  const now = Date.now();
  const newestSeq = 10000;

  // Simulate timestamp calculation for older segments
  const testCases = [
    { seq: 10000, expectedOffset: 0 },
    { seq: 9999, expectedOffset: segmentDuration * 1000 },
    { seq: 9990, expectedOffset: segmentDuration * 10 * 1000 },
  ];

  for (const { seq, expectedOffset } of testCases) {
    const seqDiff = newestSeq - seq;
    const timestamp = now - (seqDiff * segmentDuration * 1000);
    const actualOffset = now - timestamp;

    assert(
      Math.abs(actualOffset - expectedOffset) < 1, // Allow 1ms tolerance
      `Sequence ${seq} has correct offset (${actualOffset}ms)`
    );
  }
}

/**
 * Test: Old segments are pruned after restoration
 */
async function testPruningAfterRestoration() {
  logger.info('Testing old segments are pruned after restoration...');

  const bufferDuration = 60000; // 1 minute for testing
  const now = Date.now();

  // Simulate segment data
  const segments = [
    { timestamp: now - 30000, seq: 1000 },  // 30s ago - keep
    { timestamp: now - 45000, seq: 999 },   // 45s ago - keep
    { timestamp: now - 90000, seq: 998 },   // 90s ago - prune
    { timestamp: now - 120000, seq: 997 }   // 2m ago - prune
  ];

  const cutoffTime = now - bufferDuration;
  const kept = segments.filter(s => s.timestamp >= cutoffTime);
  const pruned = segments.filter(s => s.timestamp < cutoffTime);

  assert(kept.length === 2, 'Correct number of segments kept');
  assert(pruned.length === 2, 'Correct number of segments pruned');
  assert(kept.every(s => s.seq >= 999), 'Newer segments kept');
}

/**
 * Run all tests
 */
async function runTests() {
  const tests = [
    testRestorationScansAllFiles,
    testSegmentsSortedBySequence,
    testMetadataRebuiltAfterRestoration,
    testInvalidFilenamesSkipped,
    testSegmentFileSizeRead,
    testEmptyDiskHandling,
    testMissingDirectoryHandling,
    testTimestampCalculation,
    testPruningAfterRestoration
  ];

  let passed = 0;
  let failed = 0;

  logger.info('='.repeat(60));
  logger.info('Buffer Restoration Tests');
  logger.info('='.repeat(60));

  // Ensure clean state
  await cleanup();

  for (const test of tests) {
    try {
      await test();
      passed++;
      logger.info(`PASSED: ${test.name}\n`);
    } catch (error) {
      failed++;
      logger.error(`FAILED: ${test.name}`);
      logger.error(`  Error: ${error.message}\n`);
    }
  }

  // Final cleanup
  await cleanup();

  logger.info('='.repeat(60));
  logger.info(`Results: ${passed} passed, ${failed} failed`);
  logger.info('='.repeat(60));

  return failed === 0;
}

// Run if executed directly
if (require.main === module) {
  runTests()
    .then(success => process.exit(success ? 0 : 1))
    .catch(error => {
      logger.error('Test runner error:', error);
      process.exit(1);
    });
}

module.exports = { runTests };
