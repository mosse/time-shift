/**
 * API Routes for Time-Shifted Radio Application
 */

const express = require('express');
const router = express.Router();
const { serviceManager } = require('../services');
const logger = require('../utils/logger');

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
router.get('/playlist', (req, res) => {
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
 * @access  Protected - In a production app, would require auth
 */
router.get('/restart', async (req, res) => {
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