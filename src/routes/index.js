const express = require('express');
const { serviceManager } = require('../services');
const { hybridBufferService } = require('../services/hybrid-buffer-service');
const { metadataService } = require('../services/metadata-service');
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
      buffer: typeof hybridBufferService.isInitialized === 'function' ? hybridBufferService.isInitialized() : false,
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
    const bufferStats = hybridBufferService.getBufferStats();
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
    name: 'encore.fm',
    version: '1.0.0',
    description: 'live radio on your schedule',
    endpoints: [
      { path: '/', method: 'GET', description: 'API information' },
      { path: '/health', method: 'GET', description: 'Server health status' },
      { path: '/stats', method: 'GET', description: 'Service statistics' },
      { path: '/stream.m3u8', method: 'GET', description: 'HLS playlist' },
      { path: '/stream/segment/:sequenceNumber.ts', method: 'GET', description: 'HLS segment data' },
      { path: '/metadata/current', method: 'GET', description: 'Current track metadata' }
    ]
  });
});

/**
 * Current track metadata endpoint
 * Returns metadata for the track currently being played (8 hours delayed)
 * Also includes show/DJ info and station info
 */
router.get('/metadata/current', (req, res) => {
  try {
    // Get the current playback time (8 hours ago)
    const bufferStats = hybridBufferService.getBufferStats();
    const playbackTime = bufferStats.oldestTimestamp || (Date.now() - 28800000);

    // Get metadata for that time
    const track = metadataService.getMetadataAt(playbackTime);
    const show = metadataService.getShowAt(playbackTime);
    const station = metadataService.getStationInfo();

    res.json({
      status: 'ok',
      playbackTime: new Date(playbackTime).toISOString(),
      station,
      show,
      track
    });
  } catch (error) {
    // Never fail the response - metadata is non-critical
    logger.warn(`Metadata endpoint error: ${error.message}`);
    res.json({
      status: 'ok',
      station: metadataService.getStationInfo(),
      show: null,
      track: null,
      message: 'Metadata temporarily unavailable'
    });
  }
});

/**
 * Metadata service stats endpoint
 */
router.get('/metadata/stats', (req, res) => {
  try {
    res.json({
      status: 'ok',
      ...metadataService.getStats()
    });
  } catch (error) {
    res.json({
      status: 'ok',
      message: 'Metadata stats unavailable'
    });
  }
});

module.exports = router; 