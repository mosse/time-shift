const express = require('express');
const { serviceManager } = require('../services');
const { bufferService } = require('../services/buffer-service');
const logger = require('../utils/logger');

const router = express.Router();

/**
 * Health check endpoint
 * Returns status of the server and its services
 */
router.get('/health', (req, res) => {
  const isRunning = serviceManager.isRunning;
  const pipelineStatus = serviceManager.getPipelineStatus();
  
  res.json({
    status: isRunning ? 'ok' : 'degraded',
    uptime: process.uptime(),
    timestamp: new Date().toISOString(),
    services: {
      pipeline: isRunning,
      monitor: pipelineStatus.monitor ? pipelineStatus.monitor.isRunning : false,
      buffer: bufferService.isInitialized(),
      downloader: pipelineStatus.downloader ? pipelineStatus.downloader.activeDownloads >= 0 : false
    }
  });
});

/**
 * Stats endpoint
 * Returns detailed statistics about the buffer and download status
 */
router.get('/stats', (req, res) => {
  try {
    // Get detailed statistics from the services
    const bufferStats = bufferService.getBufferStats();
    const pipelineStatus = serviceManager.getPipelineStatus();
    
    res.json({
      status: 'ok',
      timestamp: new Date().toISOString(),
      buffer: {
        segmentCount: bufferStats.segmentCount,
        totalSize: bufferStats.totalSize,
        totalDuration: bufferStats.totalDuration,
        bufferTimeSpan: bufferStats.bufferTimeSpan,
        memoryUsageMB: bufferStats.memoryUsageMB,
        bufferHealthPercent: bufferStats.bufferLevelPercent || 0,
        hasGaps: bufferStats.sequenceRange ? bufferStats.sequenceRange.gapCount > 0 : false
      },
      downloader: pipelineStatus.downloader ? {
        totalDownloads: pipelineStatus.downloader.totalDownloads || 0,
        successfulDownloads: pipelineStatus.downloader.successfulDownloads || 0,
        failedDownloads: pipelineStatus.downloader.failedDownloads || 0,
        successRate: pipelineStatus.downloader.successRate || '0%',
        activeDownloads: pipelineStatus.downloader.activeDownloads || 0
      } : { status: 'not_available' },
      monitor: pipelineStatus.monitor ? {
        isRunning: pipelineStatus.monitor.isRunning,
        knownSegmentsCount: pipelineStatus.monitor.knownSegmentsCount || 0,
        errorCount: pipelineStatus.monitor.errorCount || 0,
        uptime: pipelineStatus.monitor.uptime || 0
      } : { status: 'not_available' }
    });
  } catch (error) {
    logger.error('Error retrieving stats:', error);
    res.status(500).json({
      status: 'error',
      message: 'Could not retrieve stats',
      error: process.env.NODE_ENV !== 'production' ? error.message : undefined
    });
  }
});

/**
 * Root endpoint
 * Basic welcome message and API info
 */
router.get('/', (req, res) => {
  res.json({
    name: 'Time-Shift Radio API',
    version: '1.0.0',
    description: 'API for accessing time-shifted radio streams',
    endpoints: [
      { path: '/', method: 'GET', description: 'API information' },
      { path: '/health', method: 'GET', description: 'Server health status' },
      { path: '/stats', method: 'GET', description: 'Service statistics' }
    ]
  });
});

module.exports = router; 