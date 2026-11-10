/**
 * Unit tests for outage handling: the monitor's single polling loop,
 * discontinuity detection, playing through buffer gaps with filler audio,
 * and removing out-of-window segment files on restore.
 * Run with: npm run test:unit
 */
const { test, before, after } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');

const tmpDir = path.join(os.tmpdir(), `encore-gap-test-${process.pid}`);
process.env.STORAGE_DIR = tmpDir;
process.env.LOG_LEVEL = 'error';
process.env.MIN_FREE_BYTES = '1';

const playlistService = require('../../services/playlist-service');
const { MonitorService } = require('../../services/monitor-service');
const { HybridBufferService } = require('../../services/hybrid-buffer-service');
const { diskStorageService } = require('../../services/disk-storage-service');
const { PlaylistGenerator } = require('../../services/playlist-generator');
const gapAudio = require('../../services/gap-audio');

const sleep = ms => new Promise(r => setTimeout(r, ms));

before(async () => {
  await fs.mkdir(tmpDir, { recursive: true });
});

after(async () => {
  await fs.rm(tmpDir, { recursive: true, force: true });
});

test('monitor never overlaps fetches and leaves no timers when stopped', async () => {
  const original = playlistService.fetchPlaylist;
  let inFlight = 0;
  let maxInFlight = 0;
  let calls = 0;
  playlistService.fetchPlaylist = async () => {
    calls++;
    inFlight++;
    maxInFlight = Math.max(maxInFlight, inFlight);
    await sleep(15); // slower than the polling interval
    inFlight--;
    throw new Error('getaddrinfo ENOTFOUND');
  };

  try {
    const monitor = new MonitorService({ url: 'http://x/live.m3u8', interval: 5, retryDelay: 5, maxConsecutiveErrors: 2 });
    let maxErrorsEvents = 0;
    monitor.on('error', () => {});
    monitor.on('maxErrorsReached', () => maxErrorsEvents++);

    monitor.startMonitoring();
    await sleep(150);

    assert.equal(maxInFlight, 1, 'fetches must not overlap');
    assert.ok(monitor.currentRetryDelay > 5, 'backoff should grow while failing');
    assert.equal(maxErrorsEvents, 1, 'maxErrorsReached fires once per outage');

    monitor.stopMonitoring();
    const callsAtStop = calls;
    await sleep(150);
    assert.ok(calls <= callsAtStop + 1, 'no fetches scheduled after stop (one may already be in flight)');
  } finally {
    playlistService.fetchPlaylist = original;
  }
});

test('monitor reports segments skipped while the live playlist was unreachable', () => {
  const monitor = new MonitorService();
  const events = [];
  monitor.on('discontinuity', e => events.push(e));
  const batch = (first, count) => monitor.identifyNewSegments(
    Array.from({ length: count }, (_, i) => `http://x/seg-${first + i}.ts`),
    { mediaSequence: first, segments: [] }
  );

  batch(100, 6);
  batch(101, 6); // normal overlap: one new segment
  assert.equal(events.length, 0);

  batch(440, 6);
  assert.deepEqual(events, [{ expected: 107, actual: 440, skippedCount: 333 }]);
});

function bufferWith(seqs, { start, durationMs = 6400 }) {
  const buffer = new HybridBufferService(24 * 60 * 60 * 1000);
  buffer.diskStorageEnabled = false;
  for (const seq of seqs) {
    const segment = { timestamp: start + (seq - seqs[0]) * durationMs, metadata: { sequenceNumber: seq, duration: durationMs / 1000 }, size: 10 };
    buffer.segments.push(segment);
    buffer.segmentsByTimestamp.set(segment.timestamp, segment);
    buffer.segmentsBySequence.set(seq, segment);
  }
  return buffer;
}

const mediaSequence = m3u8 => Number(/#EXT-X-MEDIA-SEQUENCE:(\d+)/.exec(m3u8)[1]);

test('playlist keeps moving through a gap instead of repeating', async () => {
  // Segments 0-9 and 60-69 recorded; 10-59 missing
  const start = 1_000_000;
  const seqs = [...Array(10).keys(), ...Array.from({ length: 10 }, (_, i) => 60 + i)];
  const buffer = bufferWith(seqs, { start });
  const generator = new PlaylistGenerator({ bufferService: buffer, timeShiftDuration: 0 });

  let last = -1;
  for (let seq = 5; seq < 65; seq++) {
    const { m3u8Content, segments } = await generator.generatePlaylist({ now: start + seq * 6400 + 100 });
    const first = mediaSequence(m3u8Content);
    assert.equal(first, seq - 2, `window should be centred on ${seq}`);
    assert.ok(first > last, 'media sequence must advance');
    assert.deepEqual(segments.map(s => s.sequenceNumber), [seq - 2, seq - 1, seq, seq + 1, seq + 2]);
    last = first;
  }
});

test('playlist plays before the oldest and after the newest segment', async () => {
  const start = 1_000_000;
  const buffer = bufferWith([50, 51, 52], { start });
  const generator = new PlaylistGenerator({ bufferService: buffer, timeShiftDuration: 0 });

  const before = await generator.generatePlaylist({ now: start - 10 * 6400 });
  assert.equal(mediaSequence(before.m3u8Content), 38);

  const later = await generator.generatePlaylist({ now: start + 20 * 6400 + 100 });
  assert.equal(mediaSequence(later.m3u8Content), 68);
});

// A minimal real-looking segment: PAT, PMT and one PES, muxed by gap-audio itself
function syntheticSegment(pts) {
  const packet = pid => {
    const p = Buffer.alloc(188, 0xff);
    p[0] = 0x47; p[1] = 0x40 | (pid >> 8); p[2] = pid & 0xff; p[3] = 0x10;
    return p;
  };
  const frames = gapAudio.fillerFrames(0, null, null).slice(0, 6);
  return gapAudio.muxSegment(frames, pts, { pat: packet(0), pmt: packet(32), pid: 34 });
}

test('filler segment carries the PTS the missing segment would have had', async () => {
  const refPts = 2 ** 33 - 576000; // wraps around within the gap
  const real = { timestamp: 0, metadata: { sequenceNumber: 100 } };
  const next = { timestamp: 10 * 6400, metadata: { sequenceNumber: 110 } };
  const buffer = {
    findSequenceNeighbors: () => ({ prev: real, next }),
    getSegmentBySequence: async () => ({ data: syntheticSegment(refPts) })
  };

  const template = gapAudio.readTemplate(syntheticSegment(refPts));
  assert.equal(template.pid, 34);
  assert.equal(template.pts, refPts);

  const filler = await gapAudio.fillerSegment(103, buffer);
  assert.equal(filler.length % 188, 0);
  assert.equal(gapAudio.readTemplate(filler).pts, (refPts + 3 * gapAudio.SEGMENT_TICKS) % 2 ** 33);
});

test('filler announces at the start of a gap and every ~2 minutes, silence otherwise', () => {
  const prev = { timestamp: 0, metadata: { sequenceNumber: 100 } };
  const next = { timestamp: 0, metadata: { sequenceNumber: 200 } };
  const silent = gapAudio.fillerFrames(150, null, null).at(-1);
  const isSilent = frames => frames.every(f => f.equals(silent));

  assert.ok(!isSilent(gapAudio.fillerFrames(101, prev, next)), 'notice at gap start');
  assert.ok(isSilent(gapAudio.fillerFrames(110, prev, next)), 'silence between notices');
  assert.ok(!isSilent(gapAudio.fillerFrames(101 + gapAudio.ANNOUNCE_EVERY, prev, next)), 'notice repeats');

  const shortGap = { timestamp: 0, metadata: { sequenceNumber: 103 } };
  assert.ok(isSilent(gapAudio.fillerFrames(101, prev, shortGap)), 'tiny gaps stay silent');
  assert.equal(gapAudio.fillerFrames(101, prev, next).length, gapAudio.SEGMENT_FRAMES);
});

test('restore deletes segment files outside the buffer window', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => { throw new Error('offline'); };
  try {
    await diskStorageService.initialize();
    const dir = diskStorageService.segmentsPath;
    const recent = Array.from({ length: 5 }, (_, i) => 5000 + i);
    for (const seq of [1, 2, ...recent]) await fs.writeFile(path.join(dir, `${seq}.ts`), 'x');

    const buffer = new HybridBufferService(60 * 60 * 1000); // 1h window
    await buffer.initialize();
    buffer.stopIntervals();

    const left = (await fs.readdir(dir)).sort();
    assert.deepEqual(left, recent.map(s => `${s}.ts`).sort());
    assert.equal(buffer.segments.length, recent.length);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('failed downloads and skipped segments from one outage merge into one gap', () => {
  const buffer = new HybridBufferService(24 * 60 * 60 * 1000);
  const t = Date.now() - 60 * 60 * 1000;
  buffer.recordGap({ fromSeq: 454, toSeq: 455, startTime: t, endTime: t + 30000, reason: 'download-failure' });
  buffer.recordGap({ fromSeq: 456, toSeq: 785, startTime: t + 12800, endTime: t + 35 * 60000, reason: 'discontinuity' });

  const gaps = buffer.getGaps();
  assert.equal(gaps.length, 1);
  assert.deepEqual([gaps[0].fromSeq, gaps[0].toSeq, gaps[0].startTime, gaps[0].endTime], [454, 785, t, t + 35 * 60000]);
});

test('restore widens a recorded gap to the missing sequence numbers it overlaps', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => { throw new Error('offline'); };
  try {
    await diskStorageService.initialize();
    const dir = diskStorageService.segmentsPath;
    for (const f of await fs.readdir(dir)) await fs.rm(path.join(dir, f));
    // 5005-5009 missing; offline, so timestamps count back from the newest file (5014) at "now"
    for (const seq of [5000, 5001, 5002, 5003, 5004, 5010, 5011, 5012, 5013, 5014]) {
      await fs.writeFile(path.join(dir, `${seq}.ts`), 'x');
    }
    const now = Date.now();
    await diskStorageService.writeMetadata({
      timestamp: now,
      segments: [],
      gaps: [{ fromSeq: 5005, toSeq: 5005, startTime: now - 9 * 6400, endTime: now - 8 * 6400, reason: 'download-failure' }]
    });

    const buffer = new HybridBufferService(60 * 60 * 1000);
    await buffer.initialize();
    buffer.stopIntervals();

    const gaps = buffer.getGaps();
    assert.equal(gaps.length, 1);
    assert.deepEqual([gaps[0].fromSeq, gaps[0].toSeq], [5005, 5009]);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
