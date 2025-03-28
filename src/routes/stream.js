const express = require('express');
const { playlistGenerator } = require('../services/playlist-generator');
const { bufferService } = require('../services/buffer-service');
const logger = require('../utils/logger');

const router = express.Router();

/**
 * Main HLS playlist endpoint
 * Returns a time-shifted playlist based on current buffer state
 */
router.get('/stream.m3u8', (req, res) => {
  try {
    logger.info('Playlist requested');
    
    // Generate a playlist with default settings
    const playlist = playlistGenerator.generatePlaylist();
    
    // Set appropriate headers
    res.set({
      'Content-Type': 'application/vnd.apple.mpegurl',
      'Cache-Control': 'no-cache, max-age=3',
      'Access-Control-Allow-Origin': '*',
      'X-Content-Type-Options': 'nosniff'
    });
    
    res.send(playlist);
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
router.get('/stream/segment/:sequenceNumber.ts', (req, res) => {
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
    const segment = bufferService.getSegmentBySequence(sequenceNumber);
    
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
      'Content-Length': segment.size
    });
    
    // Send the segment data
    res.send(Buffer.from(segment.data));
    logger.debug(`Segment ${sequenceNumber} served successfully`);
  } catch (error) {
    logger.error(`Error serving segment: ${error.message}`);
    res.status(500).json({
      status: 'error',
      message: 'Error retrieving segment',
      error: process.env.NODE_ENV !== 'production' ? error.message : undefined
    });
  }
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
    'Content-Length': emptySegment.length
  });
  
  res.send(emptySegment);
});

module.exports = router; 