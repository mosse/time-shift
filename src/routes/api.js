/**
 * API Routes for Time-Shifted Radio Application
 */

const express = require('express');
const router = express.Router();
const { serviceManager } = require('../services');
const logger = require('../utils/logger');

/**
 * Admin authentication middleware
 * Protects administrative endpoints with API key authentication
 */
const adminAuth = (req, res, next) => {
  const apiKey = req.headers['x-api-key'] || req.query.apiKey;
  const validKey = process.env.ADMIN_API_KEY;

  // If no key is configured
  if (!validKey) {
    // In production, deny all admin access when key not configured
    if (process.env.NODE_ENV === 'production') {
      logger.warn('Admin endpoint accessed without ADMIN_API_KEY configured in production');
      return res.status(403).json({
        status: 'error',
        message: 'Admin access is disabled. Configure ADMIN_API_KEY to enable.'
      });
    }
    // In development, allow access but log a warning
    logger.warn('Admin endpoint accessed without ADMIN_API_KEY configured (allowed in development)');
    return next();
  }

  // Verify API key
  if (!apiKey) {
    logger.warn('Admin endpoint accessed without API key');
    return res.status(401).json({
      status: 'error',
      message: 'API key required. Provide X-API-Key header or apiKey query parameter.'
    });
  }

  if (apiKey !== validKey) {
    logger.warn('Admin endpoint accessed with invalid API key');
    return res.status(401).json({
      status: 'error',
      message: 'Invalid API key'
    });
  }

  next();
};

/**
 * Input validation helpers
 */
const validatePlaylistParams = (req, res, next) => {
  const errors = [];

  // Validate duration
  if (req.query.duration !== undefined) {
    const duration = parseInt(req.query.duration, 10);
    if (isNaN(duration) || duration < 1 || duration > 3600) {
      errors.push('duration must be a number between 1 and 3600 seconds');
    }
  }

  // Validate format
  if (req.query.format !== undefined) {
    const validFormats = ['m3u8', 'json'];
    if (!validFormats.includes(req.query.format)) {
      errors.push(`format must be one of: ${validFormats.join(', ')}`);
    }
  }

  // Validate timeshift
  if (req.query.timeshift !== undefined) {
    const timeshift = parseInt(req.query.timeshift, 10);
    if (isNaN(timeshift) || timeshift < 0 || timeshift > 86400000) {
      errors.push('timeshift must be a number between 0 and 86400000 milliseconds (24 hours)');
    }
  }

  if (errors.length > 0) {
    return res.status(400).json({
      status: 'error',
      message: 'Validation failed',
      errors
    });
  }

  next();
};

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
    
    // Send combined status
    res.json({
      timestamp: Date.now(),
      uptime: logMetrics.uptime,
      uptimeHuman: logMetrics.uptimeHuman,
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
router.get('/playlist', validatePlaylistParams, (req, res) => {
  try {
    const duration = parseInt(req.query.duration, 10) || 300; // Default 5 minutes
    const format = req.query.format || 'm3u8';
    // Allow overriding the time shift for testing purposes
    const timeshift = req.query.timeshift !== undefined ?
      parseInt(req.query.timeshift, 10) : undefined;
    
    const playlistGenerator = req.app.get('playlistGenerator');
    
    if (!playlistGenerator) {
      return res.status(500).json({ 
        error: 'Playlist generator not initialized' 
      });
    }
    
    // Generate playlist
    const playlist = playlistGenerator.generatePlaylist({
      duration,
      baseUrl: `${req.protocol}://${req.get('host')}`,
      timeshift
    });
    
    if (format === 'm3u8') {
      // Return m3u8 format
      res.set('Content-Type', 'application/vnd.apple.mpegurl');
      res.send(playlist.m3u8Content);
    } else {
      // Return JSON format
      res.json(playlist);
    }
  } catch (error) {
    logger.error(`Error generating playlist: ${error.message}`);
    res.status(500).json({ error: error.message });
  }
});

/**
 * @route   GET /api/restart
 * @desc    Restart the pipeline if needed
 * @access  Protected - Requires ADMIN_API_KEY authentication
 */
router.get('/restart', adminAuth, async (req, res) => {
  try {
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