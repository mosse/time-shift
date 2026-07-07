/**
 * API Routes for Time-Shifted Radio Application
 */

const express = require('express');
const router = express.Router();
const { serviceManager } = require('../services');
const logger = require('../utils/logger');
const config = require('../config/config');

/**
 * @route   GET /api/health
 * @desc    Get system health status
 * @access  Public
 */
router.get('/health', async (req, res) => {
  try {
    const app = req.app;
    const performHealthCheck = app.get('performHealthCheck');
    const health = await performHealthCheck();
    
    // Send appropriate status code based on health
    res.status(health.isHealthy ? 200 : 503).json(health);
  } catch (error) {
    logger.error(`Error checking health: ${error.message}`);
    res.status(500).json({ 
      isHealthy: false, 
      errors: [error.message],
      timestamp: Date.now()
    });
  }
});

/**
 * Compute the stream-health rollup for a single listener.
 * Answers: is the recorder alive, how much continuous audio is ahead of
 * the playback position, and where are the holes?
 */
function computeStreamHealth(status, systemHealth) {
  const now = Date.now();
  const buffer = status.buffer || {};
  const capacity = status.capacity || null;

  const bufferService = serviceManager.bufferService;
  const gaps = bufferService && typeof bufferService.getGaps === 'function'
    ? bufferService.getGaps()
    : [];

  // Recorder liveness: age of the newest captured segment
  const lastSegmentAgeSec = buffer.newestTimestamp
    ? Math.round((now - buffer.newestTimestamp) / 1000)
    : null;
  const recorderLive = lastSegmentAgeSec !== null && lastSegmentAgeSec < 60;

  // Playback continuity: walk the gap list forward from the playhead
  const positionTime = now - config.DELAY_DURATION;
  const newest = buffer.newestTimestamp || now;
  const listenWindowGaps = gaps
    .filter(g => g.endTime > positionTime)
    .sort((a, b) => a.startTime - b.startTime)
    .map(g => ({
      start: g.startTime,
      end: g.endTime,
      durationSec: Math.max(1, Math.round((g.endTime - g.startTime) / 1000)),
      reason: g.reason || 'unknown',
      inListenWindow: g.endTime > positionTime && g.startTime < newest
    }));

  let continuousForSec;
  let nextGap = null;
  // The playhead only has content once the buffer reaches back to it
  // (an 8h delay needs 8h of recording before playback starts)
  const playheadBuffered = !!buffer.oldestTimestamp &&
    buffer.oldestTimestamp <= positionTime &&
    newest > positionTime;

  if (!playheadBuffered) {
    continuousForSec = 0;
  } else {
    const firstAhead = listenWindowGaps.find(g => g.end > positionTime);
    if (!firstAhead) {
      continuousForSec = Math.max(0, Math.round((newest - positionTime) / 1000));
    } else if (firstAhead.start <= positionTime) {
      // The playhead is currently inside a gap
      nextGap = { inSec: 0, durationSec: Math.round((firstAhead.end - positionTime) / 1000) };
      continuousForSec = 0;
    } else {
      nextGap = {
        inSec: Math.round((firstAhead.start - positionTime) / 1000),
        durationSec: firstAhead.durationSec
      };
      continuousForSec = nextGap.inSec;
    }
  }

  // Windowed download success rate (computed by the health check loop)
  const downloaderComponent = systemHealth?.components?.downloader || {};
  const successRatePercent = downloaderComponent.windowedSuccessRate !== null &&
    downloaderComponent.windowedSuccessRate !== undefined
    ? downloaderComponent.windowedSuccessRate
    : null;

  // Rolled-up state
  let state = 'good';
  if (!recorderLive ||
      (capacity && !capacity.ok) ||
      (successRatePercent !== null && successRatePercent < 90) ||
      (nextGap && nextGap.inSec < 3600)) {
    state = 'degraded';
  }
  if ((lastSegmentAgeSec !== null && lastSegmentAgeSec > 300) ||
      (nextGap && nextGap.inSec === 0)) {
    state = 'bad';
  }

  return {
    state,
    recorder: { lastSegmentAgeSec, live: recorderLive },
    playback: { positionTime, playheadBuffered, continuousForSec, nextGap },
    gaps: listenWindowGaps,
    downloads: { successRatePercent },
    disk: capacity ? {
      freeBytes: capacity.freeBytes,
      usedBytes: capacity.usedBytes,
      capBytes: capacity.capBytes,
      pressure: !capacity.ok
    } : null
  };
}

/**
 * @route   GET /api/status
 * @desc    Get system status information
 * @access  Public
 */
router.get('/status', (req, res) => {
  try {
    // Get pipeline status
    const status = serviceManager.getPipelineStatus();

    // Get logger metrics
    const logMetrics = logger.getMetrics();

    // Calculate buffer readiness
    const requiredBufferMs = config.DELAY_DURATION;
    const requiredBufferSeconds = Math.floor(requiredBufferMs / 1000);

    // Calculate current buffer time span from oldest to newest segment
    let currentBufferMs = 0;
    if (status.buffer && status.buffer.oldestTimestamp && status.buffer.newestTimestamp) {
      currentBufferMs = status.buffer.newestTimestamp - status.buffer.oldestTimestamp;
    }
    const currentBufferSeconds = Math.floor(currentBufferMs / 1000);

    const ready = currentBufferMs >= requiredBufferMs;
    const secondsUntilReady = ready ? 0 : Math.max(0, requiredBufferSeconds - currentBufferSeconds);

    // Stream-health rollup (recorder liveness, playback continuity, gaps)
    const systemHealth = req.app.get('systemHealth');
    const health = computeStreamHealth(status, systemHealth);

    // Send combined status
    res.json({
      timestamp: Date.now(),
      uptime: logMetrics.uptime,
      uptimeHuman: logMetrics.uptimeHuman,
      bufferReady: {
        ready,
        currentBufferSeconds,
        requiredBufferSeconds,
        secondsUntilReady
      },
      health,
      pipeline: status,
      logs: {
        errors: logMetrics.errors,
        warnings: logMetrics.warnings,
        info: logMetrics.info,
        requests: logMetrics.requests,
        downloads: logMetrics.downloads
      }
    });
  } catch (error) {
    logger.error(`Error fetching status: ${error.message}`);
    res.status(500).json({ error: error.message });
  }
});

/**
 * @route   GET /api/buffer-grid
 * @desc    Get buffer data for visualization (GitHub-style contribution grid)
 * @access  Public
 */
router.get('/buffer-grid', (req, res) => {
  try {
    const status = serviceManager.getPipelineStatus();
    const bufferStatus = status.buffer;

    // Get the required buffer duration (8 hours)
    const requiredBufferMs = config.DELAY_DURATION;
    const now = Date.now();

    // Calculate the time range we need to cover
    // We show the full 8-hour window from (now - 8h) to now
    const windowStart = now - requiredBufferMs;
    const windowEnd = now;

    // Divide into blocks (each block = 10 minutes = 600000ms)
    const blockDuration = 600000; // 10 minutes
    const totalBlocks = Math.ceil(requiredBufferMs / blockDuration); // 48 blocks for 8 hours

    // Build the grid data
    const blocks = [];
    const bufferService = serviceManager.bufferService;
    const segments = bufferService ? bufferService.segments : [];
    const gaps = bufferService && typeof bufferService.getGaps === 'function'
      ? bufferService.getGaps()
      : [];

    // Create a sorted copy for efficient processing
    const sortedSegments = [...segments].sort((a, b) => a.timestamp - b.timestamp);

    for (let i = 0; i < totalBlocks; i++) {
      const blockStart = windowStart + (i * blockDuration);
      const blockEnd = blockStart + blockDuration;

      // Count segments in this block
      const segmentsInBlock = sortedSegments.filter(
        s => s.timestamp >= blockStart && s.timestamp < blockEnd
      ).length;

      // Expected segments per 10-min block (roughly 1 segment per 6.4 seconds = ~94 segments)
      const expectedSegments = Math.floor(blockDuration / 6400);

      // Calculate fill level (0-4 like GitHub contributions)
      let level = 0;
      if (segmentsInBlock > 0) {
        const fillPercent = (segmentsInBlock / expectedSegments) * 100;
        if (fillPercent >= 90) level = 4;
        else if (fillPercent >= 60) level = 3;
        else if (fillPercent >= 30) level = 2;
        else level = 1;
      }

      // Calculate hour offset from "now" for labeling
      const hoursAgo = Math.floor((now - blockStart) / 3600000);

      // Flag blocks that overlap a known recording gap
      const hasGap = gaps.some(g => g.startTime < blockEnd && g.endTime > blockStart);

      blocks.push({
        index: i,
        start: blockStart,
        end: blockEnd,
        segmentCount: segmentsInBlock,
        level,
        hoursAgo,
        hasGap,
        isPlaybackZone: blockStart <= (now - requiredBufferMs + blockDuration) // First block is playback position
      });
    }

    // Calculate overall stats
    const filledBlocks = blocks.filter(b => b.level > 0).length;
    const fullBlocks = blocks.filter(b => b.level >= 3).length;

    res.json({
      timestamp: now,
      windowStart,
      windowEnd,
      blockDurationMs: blockDuration,
      totalBlocks,
      filledBlocks,
      fullBlocks,
      fillPercent: Math.round((filledBlocks / totalBlocks) * 100),
      blocks,
      // Include summary stats
      oldestSegment: bufferStatus.oldestTimestamp,
      newestSegment: bufferStatus.newestTimestamp,
      totalSegments: bufferStatus.segmentCount || 0
    });
  } catch (error) {
    logger.error(`Error generating buffer grid: ${error.message}`);
    res.status(500).json({ error: error.message });
  }
});

/**
 * @route   GET /api/segments
 * @desc    Get list of available segments in buffer
 * @access  Public
 */
router.get('/segments', (req, res) => {
  try {
    const status = serviceManager.getPipelineStatus();
    const bufferStatus = status.buffer;
    
    // Return segment information
    res.json({
      timestamp: Date.now(),
      count: bufferStatus.segmentsStored || 0,
      duration: bufferStatus.bufferDurationSeconds || 0,
      utilization: bufferStatus.utilizationPercentage || 0,
      segments: bufferStatus.segments || []
    });
  } catch (error) {
    logger.error(`Error fetching segments: ${error.message}`);
    res.status(500).json({ error: error.message });
  }
});

/**
 * @route   GET /api/playlist
 * @desc    Generate a playlist for time-shifted content
 * @access  Public
 */
router.get('/playlist', async (req, res) => {
  try {
    const duration = parseInt(req.query.duration) || 300; // Default 5 minutes
    const format = req.query.format || 'm3u8';
    // Allow overriding the time shift for testing purposes
    const timeshift = req.query.timeshift !== undefined ?
      parseInt(req.query.timeshift) : undefined;

    const playlistGenerator = req.app.get('playlistGenerator');

    if (!playlistGenerator) {
      return res.status(500).json({
        error: 'Playlist generator not initialized'
      });
    }

    // Generate playlist
    const playlist = await playlistGenerator.generatePlaylist({
      duration,
      baseUrl: `${req.protocol}://${req.get('host')}`,
      timeshift
    });

    if (format === 'm3u8') {
      // Return m3u8 format with no-cache headers for live streaming
      res.set({
        'Content-Type': 'application/vnd.apple.mpegurl',
        'Cache-Control': 'no-cache, no-store, must-revalidate',
        'Pragma': 'no-cache',
        'Expires': '0'
      });
      res.send(playlist.m3u8Content);
    } else {
      // Return JSON format
      res.set({
        'Cache-Control': 'no-cache, no-store, must-revalidate',
        'Pragma': 'no-cache',
        'Expires': '0'
      });
      res.json(playlist);
    }
  } catch (error) {
    logger.error(`Error generating playlist: ${error.message}`);
    res.status(500).json({ error: error.message });
  }
});

/**
 * @route   POST /api/restart
 * @desc    Restart the pipeline if needed
 * @access  Protected - requires API key via ADMIN_API_KEY env var
 */
router.post('/restart', async (req, res) => {
  try {
    // Require API key if one is configured
    const adminKey = process.env.ADMIN_API_KEY;
    if (adminKey) {
      const provided = req.headers['x-api-key'];
      if (provided !== adminKey) {
        return res.status(401).json({ success: false, message: 'Unauthorized' });
      }
    }

    logger.info('Received request to restart pipeline');

    // Stop the pipeline
    await serviceManager.stopPipeline();

    // Wait a moment
    await new Promise(resolve => setTimeout(resolve, 1000));

    // Start the pipeline again
    const started = await serviceManager.startPipeline({ immediate: true });

    if (started) {
      res.json({
        success: true,
        message: 'Pipeline restarted successfully',
        status: serviceManager.getPipelineStatus()
      });
    } else {
      res.status(500).json({
        success: false,
        message: 'Failed to restart pipeline'
      });
    }
  } catch (error) {
    logger.error(`Error restarting pipeline: ${error.message}`);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

module.exports = router; 