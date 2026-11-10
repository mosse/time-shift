const fs = require('fs');
const path = require('path');
const config = require('../config/config');

/**
 * Gap audio: builds a stand-in segment for a sequence number missing from the
 * buffer, so playback runs through a recording gap instead of looping.
 *
 * BBC segments are HE-AAC in MPEG-TS, 150 ADTS frames per 6.4s segment, and
 * their PTS advances exactly 576000 ticks per sequence number (continuous
 * across our gaps). A filler built from the same codec with the PTS the real
 * segment would have had splices in seamlessly: no discontinuity, no re-init.
 */

const SEGMENT_FRAMES = 150;
const FRAME_TICKS = 3840; // 2048 samples at 48 kHz, in 90 kHz ticks
const SEGMENT_TICKS = SEGMENT_FRAMES * FRAME_TICKS;
const FRAMES_PER_PES = 6; // matches the BBC muxer
const PCR_LEAD = 11250; // BBC sends PCR 125ms ahead of PTS
const PTS_WRAP = 2 ** 33;
const ANNOUNCE_EVERY = 19; // segments, ~2 minutes
const MIN_ANNOUNCED_GAP = 3; // shorter gaps just get silence
const LEAD_IN_FRAMES = 47; // ~2s of quiet before each notice

const CLIP_DIR = path.join(__dirname, '../assets/announcements');
let clips;

const mod = n => ((n % PTS_WRAP) + PTS_WRAP) % PTS_WRAP;

function adtsFrames(buf) {
  const frames = [];
  for (let i = 0; i + 7 <= buf.length;) {
    const len = ((buf[i + 3] & 3) << 11) | (buf[i + 4] << 3) | (buf[i + 5] >> 5);
    const frame = Buffer.from(buf.subarray(i, i + len));
    frame[1] = 0xf1; // MPEG-4 ADTS id like the BBC stream (afconvert writes MPEG-2)
    frames.push(frame);
    i += len;
  }
  return frames;
}

function clip(name) {
  clips ??= Object.fromEntries(fs.readdirSync(CLIP_DIR).map(f =>
    [path.basename(f, '.aac'), adtsFrames(fs.readFileSync(path.join(CLIP_DIR, f)))]
  ));
  return clips[name];
}

/** Spoken notice; resumeAt is a wall-clock ms time, or null while recording is down. */
function announcementFrames(resumeAt) {
  if (!resumeAt) return clip('interrupted');
  // Uses the process time zone (TZ in docker-compose.yml) for the listener's clock
  const at = new Date(Math.ceil(resumeAt / 300000) * 300000);
  const hour = at.getHours() % 12 || 12;
  const minute = String(at.getMinutes()).padStart(2, '0');
  return [...clip('returns'), ...clip(`h${hour}`), ...clip(`m${minute}`)];
}

/** The 150 frames for missing sequence `seq`, given its real neighbours. */
function fillerFrames(seq, prev, next) {
  const prevSeq = prev?.metadata.sequenceNumber;
  const nextSeq = next?.metadata.sequenceNumber;
  const gapLength = prev && next ? nextSeq - prevSeq - 1 : Infinity;

  const silence = clip('silence');
  const quiet = silence[Math.floor(silence.length / 2)];

  let frames = [];
  if (gapLength >= MIN_ANNOUNCED_GAP) {
    const start = prev ? prevSeq + 1 : seq - (seq % ANNOUNCE_EVERY);
    const part = (seq - start) % ANNOUNCE_EVERY;
    const resumeAt = next ? next.timestamp + config.DELAY_DURATION : null;
    const notice = [...Array(LEAD_IN_FRAMES).fill(quiet), ...announcementFrames(resumeAt)];
    frames = notice.slice(part * SEGMENT_FRAMES, (part + 1) * SEGMENT_FRAMES);
  }
  while (frames.length < SEGMENT_FRAMES) frames.push(quiet);
  return frames;
}

/** PAT, PMT, audio PID and first PTS of a real segment, to mux fillers the same way. */
function readTemplate(ts) {
  const packets = [];
  for (let i = 0; i + 188 <= ts.length; i += 188) packets.push(ts.subarray(i, i + 188));
  const pidOf = p => ((p[1] & 0x1f) << 8) | p[2];
  const payloadAt = p => (((p[3] >> 4) & 3) >= 2 ? 5 + p[4] : 4);

  const pes = packets.find(p => (p[1] & 0x40) && p.subarray(payloadAt(p), payloadAt(p) + 3).equals(Buffer.from([0, 0, 1])));
  const pid = pidOf(pes);
  const h = payloadAt(pes) + 9;
  const pts = (pes[h] >> 1 & 7) * 2 ** 30 + pes[h + 1] * 2 ** 22 + (pes[h + 2] >> 1) * 2 ** 15 + pes[h + 3] * 2 ** 7 + (pes[h + 4] >> 1);
  return {
    pat: packets.find(p => pidOf(p) === 0),
    pmt: packets.find(p => pidOf(p) !== 0 && pidOf(p) !== pid),
    pid,
    pts
  };
}

function pesHeader(pts, dataLength) {
  const h = Buffer.alloc(14);
  h.writeUInt32BE(0x000001c0, 0);
  h.writeUInt16BE(8 + dataLength, 4);
  h[6] = 0x80;
  h[7] = 0x80; // PTS only
  h[8] = 5;
  h[9] = 0x21 | ((Math.floor(pts / 2 ** 30) & 7) << 1);
  h[10] = Math.floor(pts / 2 ** 22) & 0xff;
  h[11] = ((Math.floor(pts / 2 ** 15) & 0x7f) << 1) | 1;
  h[12] = Math.floor(pts / 2 ** 7) & 0xff;
  h[13] = ((pts % 128) << 1) | 1;
  return h;
}

/** Split one PES into TS packets; the first carries a PCR, the last is stuffed to 188 bytes. */
function packetize(pid, pes, pcr, cc, out) {
  for (let pos = 0; pos < pes.length; cc++) {
    const first = pos === 0;
    const chunk = pes.subarray(pos, pos + 184 - (first ? 8 : 0));
    const adaptation = 184 - chunk.length;
    const p = Buffer.alloc(188, 0xff);
    p[0] = 0x47;
    p[1] = (first ? 0x40 : 0) | (pid >> 8);
    p[2] = pid & 0xff;
    p[3] = (adaptation ? 0x30 : 0x10) | (cc & 15);
    if (adaptation) {
      p[4] = adaptation - 1;
      if (adaptation > 1) p[5] = first ? 0x10 : 0;
      if (first) {
        p.writeUInt32BE(Math.floor(pcr / 2), 6);
        p[10] = ((pcr % 2) << 7) | 0x7e;
        p[11] = 0;
      }
    }
    chunk.copy(p, 4 + adaptation);
    out.push(p);
    pos += chunk.length;
  }
  return cc;
}

function muxSegment(frames, pts, template) {
  const out = [template.pat, template.pmt];
  let cc = 0;
  for (let i = 0; i < frames.length; i += FRAMES_PER_PES) {
    const framePts = mod(pts + i * FRAME_TICKS);
    const data = Buffer.concat(frames.slice(i, i + FRAMES_PER_PES));
    cc = packetize(template.pid, Buffer.concat([pesHeader(framePts, data.length), data]), mod(framePts - PCR_LEAD), cc, out);
  }
  return Buffer.concat(out);
}

/**
 * Build the stand-in for missing sequence `seq`: silence, with a spoken notice
 * at the start of a gap and every ~2 minutes. Returns null if there's no real
 * segment to take the stream layout from.
 */
async function fillerSegment(seq, bufferService) {
  const { prev, next } = bufferService.findSequenceNeighbors(seq);
  const neighbour = prev || next;
  if (!neighbour) return null;

  const real = await bufferService.getSegmentBySequence(neighbour.metadata.sequenceNumber);
  if (!real?.data) return null;

  const template = readTemplate(Buffer.from(real.data));
  const pts = mod(template.pts + (seq - neighbour.metadata.sequenceNumber) * SEGMENT_TICKS);
  return muxSegment(fillerFrames(seq, prev, next), pts, template);
}

module.exports = { fillerSegment, fillerFrames, readTemplate, muxSegment, ANNOUNCE_EVERY, SEGMENT_FRAMES, SEGMENT_TICKS };
