const express = require('express');
const { playlistGenerator } = require('../services/playlist-generator');
const { hybridBufferService } = require('../services/hybrid-buffer-service');
const logger = require('../utils/logger');
const config = require('../config/config');
const perf = require('perf_hooks').performance;

const router = express.Router();

/**
 * Main HLS playlist endpoint
 * Returns a time-shifted playlist based on current buffer state
 */
router.get('/stream.m3u8', async (req, res) => {
  try {
    logger.info('Playlist requested');

    // Generate a playlist with default settings
    const playlist = await playlistGenerator.generatePlaylist();

    // Set appropriate headers
    res.set({
      'Content-Type': 'application/vnd.apple.mpegurl',
      'Cache-Control': 'no-cache, max-age=3',
      'Access-Control-Allow-Origin': '*',
      'X-Content-Type-Options': 'nosniff'
    });

    res.send(playlist.m3u8Content);
    logger.debug('Playlist served successfully');
  } catch (error) {
    logger.error(`Error serving playlist: ${error.message}`);
    res.status(500).json({
      status: 'error',
      message: 'Error generating playlist',
      error: process.env.NODE_ENV !== 'production' ? error.message : undefined
    });
  }
});

/**
 * Segment endpoint
 * Returns a specific segment from the buffer
 */
router.get('/stream/segment/:sequenceNumber.ts', async (req, res) => {
  const startTime = perf.now();
  let success = false;

  try {
    const sequenceNumber = parseInt(req.params.sequenceNumber, 10);
    logger.info(`Segment requested: ${sequenceNumber}`);

    if (isNaN(sequenceNumber)) {
      logger.warn(`Invalid sequence number requested: ${req.params.sequenceNumber}`);
      return res.status(400).json({
        status: 'error',
        message: 'Invalid sequence number'
      });
    }

    // Retrieve the segment from the buffer
    const segment = await hybridBufferService.getSegmentBySequence(sequenceNumber);

    if (!segment) {
      logger.warn(`Segment not found: ${sequenceNumber}`);
      return res.status(404).json({
        status: 'error',
        message: 'Segment not found'
      });
    }

    // Set appropriate headers
    res.set({
      'Content-Type': 'video/mp2t',
      'Cache-Control': 'public, max-age=86400', // Cache segments for up to 24 hours
      'Content-Length': segment.size,
      'Access-Control-Allow-Origin': '*'
    });

    // Send the segment data
    res.send(Buffer.from(segment.data));
    success = true;

    const responseTime = perf.now() - startTime;
    logger.debug(`Segment ${sequenceNumber} served successfully in ${responseTime.toFixed(2)}ms`);
  } catch (error) {
    logger.error(`Error serving segment: ${error.message}`);
    res.status(500).json({
      status: 'error',
      message: 'Error retrieving segment',
      error: process.env.NODE_ENV !== 'production' ? error.message : undefined
    });
  } finally {
    if (!success) {
      const responseTime = perf.now() - startTime;
      logger.warn(`Failed to serve segment in ${responseTime.toFixed(2)}ms`);
    }
  }
});

/**
 * Time-shifted segment delivery endpoint 
 * Calculates and delivers the segment from 8 hours ago
 */
router.get('/segments/:id', async (req, res) => {
  const startTime = perf.now();
  let success = false;
  let fallbackUsed = false;

  try {
    const segmentId = req.params.id;
    logger.info(`Time-shifted segment requested: ${segmentId}`);

    // Parse segment ID (could be numeric or a timestamp)
    let targetTime;

    if (/^\d+$/.test(segmentId)) {
      // If it's a numeric ID, assume it's a timestamp in milliseconds
      targetTime = parseInt(segmentId, 10);

      // If the number is too small to be a valid timestamp, it might be a sequence number
      if (targetTime < 1000000000000) {
        logger.debug(`Segment ID ${segmentId} interpreted as sequence number`);

        // Convert to current time minus delay
        const now = Date.now();
        targetTime = now - config.DELAY_DURATION;
      }
    } else {
      // If it's not numeric, return an error
      logger.warn(`Invalid segment ID requested: ${segmentId}`);
      return res.status(400).json({
        status: 'error',
        message: 'Invalid segment ID format'
      });
    }

    // Calculate the time-shifted target (current time - delay)
    const timeShiftedTime = targetTime;
    logger.debug(`Looking for segment at time: ${new Date(timeShiftedTime).toISOString()}`);

    // Try to get the segment closest to the target time
    let segment = await hybridBufferService.getSegmentAt(timeShiftedTime);

    if (!segment) {
      logger.warn(`No segment found for time: ${new Date(timeShiftedTime).toISOString()}`);
      return res.redirect('/stream/unavailable.ts');
    }

    // Calculate how far off the segment is from the requested time
    const timeDifference = Math.abs(segment.timestamp - timeShiftedTime);
    const maxAcceptableDifference = 30 * 1000; // 30 seconds in milliseconds

    if (timeDifference > maxAcceptableDifference) {
      logger.warn(`Found segment is ${timeDifference}ms away from requested time, exceeding the ${maxAcceptableDifference}ms threshold`);
      fallbackUsed = true;

      // Try to find a better segment by sequence number if this is too far off
      const sequenceRangeWidth = 10;
      const sequenceNumber = segment.metadata.sequenceNumber;
      const lowerSequence = Math.max(0, sequenceNumber - sequenceRangeWidth);
      const upperSequence = sequenceNumber + sequenceRangeWidth;

      let bestSegment = segment;
      let smallestDifference = timeDifference;

      // Check a range of sequence numbers to find a better match
      for (let seq = lowerSequence; seq <= upperSequence; seq++) {
        const candidateSegment = await hybridBufferService.getSegmentBySequence(seq);
        if (candidateSegment) {
          const candidateDifference = Math.abs(candidateSegment.timestamp - timeShiftedTime);
          if (candidateDifference < smallestDifference) {
            bestSegment = candidateSegment;
            smallestDifference = candidateDifference;
          }
        }
      }

      if (bestSegment !== segment) {
        logger.debug(`Found better segment with sequence ${bestSegment.metadata.sequenceNumber}, ${smallestDifference}ms from target`);
        segment = bestSegment;
      }
    }

    // Set appropriate content type based on file extension if available
    let contentType = 'audio/mpeg';
    if (segment.metadata.url) {
      if (segment.metadata.url.endsWith('.aac')) {
        contentType = 'audio/aac';
      } else if (segment.metadata.url.endsWith('.mp4')) {
        contentType = 'audio/mp4';
      } else if (segment.metadata.url.endsWith('.ts')) {
        contentType = 'video/mp2t';
      }
    }

    // Set appropriate headers
    res.set({
      'Content-Type': contentType,
      'Content-Length': segment.size,
      'Cache-Control': 'public, max-age=86400', // Cache segments for up to 24 hours
      'Access-Control-Allow-Origin': '*',
      'X-Sequence-Number': segment.metadata.sequenceNumber || 0,
      'X-Segment-Timestamp': segment.timestamp,
      'X-Segment-Duration': segment.metadata.duration || 0,
      'X-Fallback-Used': fallbackUsed ? 'true' : 'false'
    });

    // Send the segment data
    res.send(Buffer.from(segment.data));
    success = true;

    const responseTime = perf.now() - startTime;
    logger.debug(`Segment ${segmentId} served successfully in ${responseTime.toFixed(2)}ms${fallbackUsed ? ' (with fallback)' : ''}`);
  } catch (error) {
    logger.error(`Error serving time-shifted segment: ${error.message}`, { stack: error.stack });
    res.status(500).json({
      status: 'error',
      message: 'Error retrieving segment',
      error: process.env.NODE_ENV !== 'production' ? error.message : undefined
    });
  } finally {
    if (!success) {
      const responseTime = perf.now() - startTime;
      logger.warn(`Failed to serve time-shifted segment in ${responseTime.toFixed(2)}ms`);
    }
  }
});

/**
 * Audio-only segment endpoint 
 * Convenient for audio-only streams
 */
router.get('/audio/:id', (req, res) => {
  // This is just a convenience endpoint that redirects to the main segments endpoint
  // It's helpful for clients that specifically want audio segments
  res.set({
    'Access-Control-Allow-Origin': '*',
  });
  res.redirect(`/segments/${req.params.id}`);
});

/**
 * Fallback segment for unavailable content
 */
router.get('/stream/unavailable.ts', (req, res) => {
  logger.warn('Unavailable segment requested');
  
  // Send a minimum valid empty MPEG-TS segment
  // This is a simplified empty MPEG-TS packet (188 bytes)
  const emptySegment = Buffer.alloc(188);
  emptySegment[0] = 0x47; // Sync byte
  
  res.set({
    'Content-Type': 'video/mp2t',
    'Cache-Control': 'no-cache',
    'Content-Length': emptySegment.length,
    'Access-Control-Allow-Origin': '*',
    'X-Empty-Segment': 'true'
  });
  
  res.send(emptySegment);
});

/**
 * Fallback silence segment for audio streams 
 */
router.get('/silence', (req, res) => {
  logger.warn('Silence segment requested');
  
  // Create a silence AAC segment (2 seconds)
  // This is a very basic AAC frame with silence
  const silenceSegment = Buffer.from([
    0xFF, 0xF1, 0x50, 0x80, 0x00, 0x1F, 0xFC, 0x21, 0x00, 0x00, 0x00, 0x00,  // AAC header + empty payload
    0xFF, 0xF1, 0x50, 0x80, 0x00, 0x1F, 0xFC, 0x21, 0x00, 0x00, 0x00, 0x00,
    0xFF, 0xF1, 0x50, 0x80, 0x00, 0x1F, 0xFC, 0x21, 0x00, 0x00, 0x00, 0x00,
    0xFF, 0xF1, 0x50, 0x80, 0x00, 0x1F, 0xFC, 0x21, 0x00, 0x00, 0x00, 0x00
  ]);
  
  res.set({
    'Content-Type': 'audio/aac',
    'Cache-Control': 'public, max-age=3600',
    'Content-Length': silenceSegment.length,
    'Access-Control-Allow-Origin': '*',
    'X-Silence-Segment': 'true',
    'X-Segment-Duration': '2.0'
  });
  
  res.send(silenceSegment);
});

/**
 * Stream status endpoint
 * Provides information about the current buffer state for streaming
 */
router.get('/stream/status', (req, res) => {
  try {
    // Get buffer stats
    const bufferStats = hybridBufferService.getBufferStats();
    
    // Calculate streaming metrics
    const now = Date.now();
    const oldestBufferedTime = bufferStats.oldestTimestamp || now;
    const newestBufferedTime = bufferStats.newestTimestamp || now;
    const timeShiftTarget = now - config.DELAY_DURATION;
    
    // Check if we have content at the requested delay point
    const hasContentAtRequestedDelay = 
      oldestBufferedTime <= timeShiftTarget && 
      newestBufferedTime >= timeShiftTarget;
    
    // Calculate buffer health
    const bufferHealth = hybridBufferService.getBufferHealth();
    
    res.json({
      status: hasContentAtRequestedDelay ? 'ok' : 'limited',
      timestamp: new Date().toISOString(),
      timeShift: {
        delayMs: config.DELAY_DURATION,
        delayHours: config.DELAY_DURATION / (1000 * 60 * 60),
        targetTime: new Date(timeShiftTarget).toISOString(),
        hasContentAtTarget: hasContentAtRequestedDelay
      },
      buffer: {
        oldestSegmentTime: bufferStats.oldestTimestamp ? new Date(bufferStats.oldestTimestamp).toISOString() : null,
        newestSegmentTime: bufferStats.newestTimestamp ? new Date(bufferStats.newestTimestamp).toISOString() : null,
        segmentCount: bufferStats.segmentCount,
        durationSeconds: bufferStats.totalDuration,
        bufferHealthPercent: bufferHealth.bufferLevelPercent,
        isHealthy: bufferHealth.isHealthy,
        hasGaps: bufferHealth.hasSequenceGaps
      }
    });
  } catch (error) {
    logger.error(`Error serving stream status: ${error.message}`);
    res.status(500).json({
      status: 'error',
      message: 'Error retrieving stream status',
      error: process.env.NODE_ENV !== 'production' ? error.message : undefined
    });
  }
});

module.exports = router; 