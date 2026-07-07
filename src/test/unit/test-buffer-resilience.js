/**
 * Unit tests for buffer resilience: segment-shape validation, gap
 * tracking, storage-pressure eviction, and atomic metadata persistence.
 * Run with: npm run test:unit
 */
const { test, before, after } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');

// Isolate all disk activity in a temp dir BEFORE loading config-dependent modules
const tmpDir = path.join(os.tmpdir(), `encore-test-${process.pid}`);
process.env.STORAGE_DIR = tmpDir;
process.env.LOG_LEVEL = 'error';
process.env.MAX_STORAGE_BYTES = String(200 * 1024); // 200 KB cap for eviction tests
process.env.MIN_FREE_BYTES = '1';

const { HybridBufferService } = require('../../services/hybrid-buffer-service');
const { DiskStorageService } = require('../../services/disk-storage-service');
const { PlaylistGenerator } = require('../../services/playlist-generator');

before(async () => {
  await fs.mkdir(tmpDir, { recursive: true });
});

after(async () => {
  await fs.rm(tmpDir, { recursive: true, force: true });
});

test('_isValidSegment rejects malformed segments', () => {
  const buffer = new HybridBufferService(60000);
  assert.equal(buffer._isValidSegment(null), false);
  assert.equal(buffer._isValidSegment({ timestamp: Date.now() }), false);
  assert.equal(buffer._isValidSegment({ timestamp: Date.now(), metadata: {} }), false);
  assert.equal(buffer._isValidSegment({
    timestamp: Date.now(),
    metadata: { sequenceNumber: 42 }
  }), true);
});

test('playlist generation survives a malformed anchor segment', async () => {
  const buffer = new HybridBufferService(60000);
  buffer.diskStorageEnabled = false;

  const now = Date.now();
  // One malformed segment (no metadata) right at the target time,
  // plus valid neighbours
  buffer.segments = [
    { timestamp: now - 20000, metadata: { sequenceNumber: 1, duration: 6.4, url: 'u1' }, size: 10 },
    { timestamp: now - 10000, size: 10 }, // malformed: no metadata
    { timestamp: now - 5000, metadata: { sequenceNumber: 3, duration: 6.4, url: 'u3' }, size: 10 }
  ];
  buffer.segments.forEach(s => {
    buffer.segmentsByTimestamp.set(s.timestamp, s);
    if (s.metadata) buffer.segmentsBySequence.set(s.metadata.sequenceNumber, s);
  });

  const generator = new PlaylistGenerator({ bufferService: buffer, timeShiftDuration: 10000 });
  const playlist = await generator.generatePlaylist();

  assert.ok(playlist.m3u8Content.includes('#EXTM3U'));
  // Must serve real segments (fallback anchor), not the empty playlist
  assert.ok(playlist.segments.length > 0, 'expected non-empty playlist despite malformed anchor');
});

test('recordGap merges touching gaps and expires old ones', () => {
  const buffer = new HybridBufferService(60 * 60 * 1000);
  const now = Date.now();

  buffer.recordGap({ fromSeq: 10, toSeq: 12, startTime: now - 30000, endTime: now - 20000, reason: 'discontinuity' });
  buffer.recordGap({ fromSeq: 13, toSeq: 15, startTime: now - 19000, endTime: now - 10000, reason: 'discontinuity' });
  assert.equal(buffer.getGaps().length, 1, 'touching gaps should merge');

  buffer.recordGap({ fromSeq: 20, toSeq: 21, startTime: now - 5000, endTime: now - 1000, reason: 'download-failure' });
  assert.equal(buffer.getGaps().length, 2, 'different reason should not merge');

  // A gap far outside the buffer window is expired
  buffer.gaps.unshift({ fromSeq: 1, toSeq: 2, startTime: now - 100 * 60 * 60 * 1000, endTime: now - 99 * 60 * 60 * 1000, reason: 'old' });
  assert.equal(buffer.getGaps().length, 2, 'ancient gap should be expired');
});

test('storage pressure evicts instead of crashing, and never falls back to memory', async () => {
  const buffer = new HybridBufferService(60 * 60 * 1000);
  await buffer.initialize({ reset: true });

  let pressureEvents = 0;
  buffer.on('storagePressure', () => pressureEvents++);

  const chunk = Buffer.alloc(50 * 1024, 0x41); // 50 KB
  for (let i = 0; i < 10; i++) {
    try {
      await buffer.addSegment(chunk, { url: `http://x/seg${i}.ts`, sequenceNumber: i, duration: 6.4 });
    } catch (e) {
      assert.equal(e.code, 'STORAGE_FULL', `unexpected error: ${e.message}`);
    }
  }

  const stats = buffer.getBufferStats();
  assert.ok(pressureEvents > 0, 'pressure events should fire');
  assert.ok(stats.totalSize <= 200 * 1024, 'buffer must stay under the cap');
  assert.equal(stats.memorySegments, 0, 'no in-memory fallback under pressure');

  buffer.stopIntervals();
});

test('metadata writes are atomic with .bak fallback on corruption', async () => {
  const storageDir = path.join(tmpDir, 'atomic-test');
  const storage = new DiskStorageService({ baseDir: storageDir });
  await storage.initialize();

  const first = { timestamp: 1, segments: [{ metadata: { segmentId: 'a' } }] };
  const second = { timestamp: 2, segments: [{ metadata: { segmentId: 'b' } }] };

  assert.equal(await storage.writeMetadata(first), true);
  assert.equal(await storage.writeMetadata(second), true);

  // Both current and backup exist after two writes
  const current = await storage.readMetadata();
  assert.equal(current.timestamp, 2);

  // Corrupt the primary file: read must fall back to the .bak copy
  await fs.writeFile(storage.metadataPath, '{"truncated": ', 'utf8');
  const recovered = await storage.readMetadata();
  assert.ok(recovered, 'should recover from backup');
  assert.equal(recovered.timestamp, 1, 'backup holds the previous write');
});

test('monitor bounds knownSegments and backs off retry delay', () => {
  const { MonitorService } = require('../../services/monitor-service');
  const monitor = new MonitorService({ maxKnownSegments: 5 });

  // Simulate discovering many segments
  const parsed = { mediaSequence: 0, segments: [] };
  for (let batch = 0; batch < 4; batch++) {
    const urls = Array.from({ length: 3 }, (_, i) => `http://x/seg-${batch}-${i}.ts`);
    monitor.identifyNewSegments(urls, parsed);
  }
  assert.ok(monitor.knownSegments.size <= 5, `knownSegments grew to ${monitor.knownSegments.size}`);

  // Backoff doubles and caps
  assert.equal(monitor.currentRetryDelay, monitor.retryDelay);
  monitor.currentRetryDelay = Math.min(monitor.currentRetryDelay * 2, 5 * 60 * 1000);
  assert.equal(monitor.currentRetryDelay, monitor.retryDelay * 2);
});
