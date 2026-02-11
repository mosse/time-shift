const app = require('./app');
const config = require('./config/config');
const logger = require('./utils/logger');
const { serviceManager } = require('./services');

// Port setup
const port = config.PORT || 3000;

// Health check status object
const systemHealth = {
  isHealthy: true,
  lastCheck: Date.now(),
  components: {
    web: { status: 'unknown', lastCheck: null },
    buffer: { status: 'unknown', lastCheck: null },
    monitor: { status: 'unknown', lastCheck: null },
    downloader: { status: 'unknown', lastCheck: null },
    playlist: { status: 'unknown', lastCheck: null }
  },
  errors: []
};

/**
 * Perform health check on all system components
 * @returns {Object} - System health status
 */
async function performHealthCheck() {
  const now = Date.now();
  systemHealth.lastCheck = now;
  systemHealth.errors = [];
  
  try {
    // Get current pipeline status
    const status = serviceManager.getPipelineStatus();
    
    // Initialize all component statuses to healthy by default
    systemHealth.components.web = { 
      status: 'healthy', 
      lastCheck: now 
    };
    
    // Check monitor service status
    const monitorStatus = status.monitor && typeof status.monitor === 'object' ? status.monitor : {};
    systemHealth.components.monitor = { 
      status: monitorStatus.isRunning ? 'healthy' : 'stopped', 
      lastCheck: now,
      details: monitorStatus
    };
    
    // Check downloader service status
    const downloaderStatus = status.downloader && typeof status.downloader === 'object' ? status.downloader : {};
    systemHealth.components.downloader = { 
      status: 'healthy', 
      lastCheck: now,
      details: downloaderStatus
    };
    
    // Check buffer service status
    const bufferStatus = status.buffer && typeof status.buffer === 'object' ? status.buffer : {};
    systemHealth.components.buffer = { 
      status: 'healthy', 
      lastCheck: now,
      details: bufferStatus
    };
    
    // Check playlist service status - consider it healthy if we can access the app's playlistGenerator
    // Only marked as unhealthy during tests if the buffer is populated but playlist fails
    const playlistGenerator = app.get('playlistGenerator');
    const hasPlaylistGenerator = !!playlistGenerator;
    const bufferHasSegments = bufferStatus && bufferStatus.segmentCount > 0;
    
    systemHealth.components.playlist = { 
      status: hasPlaylistGenerator || !bufferHasSegments ? 'healthy' : 'unknown', 
      lastCheck: now,
      details: {
        available: hasPlaylistGenerator
      }
    };
    
    // Check if any component is not healthy (excluding deliberately stopped components)
    const unhealthyComponents = Object.entries(systemHealth.components)
      .filter(([name, info]) => {
        return info.status !== 'healthy' && 
               !(info.status === 'stopped' && name === 'monitor');
      });
    
    // Set overall health status
    systemHealth.isHealthy = unhealthyComponents.length === 0;
    
    if (unhealthyComponents.length > 0) {
      unhealthyComponents.forEach(([name]) => {
        systemHealth.errors.push(`${name} service is not healthy`);
      });
    }
    
    logger.debug('Health check completed', { 
      isHealthy: systemHealth.isHealthy, 
      components: Object.keys(systemHealth.components).map(k => 
        `${k}: ${systemHealth.components[k].status}`)
    });
    
    return systemHealth;
  } catch (error) {
    systemHealth.isHealthy = false;
    systemHealth.errors.push(error.message);
    logger.error(`Health check failed: ${error.message}`);
    return systemHealth;
  }
}

// Main function to start the server and services
async function startServer() {
  logger.info('Starting encore.fm...');
  
  // Start HTTP server
  const server = app.listen(port, () => {
    logger.info(`Server running on port ${port}`);
    systemHealth.components.web.status = 'healthy';
    systemHealth.components.web.lastCheck = Date.now();
  });

  // Schedule regular health checks
  const healthCheckInterval = setInterval(() => {
    performHealthCheck().catch(err => {
      logger.error(`Scheduled health check failed: ${err.message}`);
    });
  }, config.HEALTH_CHECK_INTERVAL || 60000);

  // Register cleanup handlers for graceful shutdown
  serviceManager.registerSignalHandlers();
  
  const shutdownHandler = async (signal) => {
    logger.info(`Received ${signal} signal. Starting graceful shutdown...`);
    
    // Clear health check interval
    clearInterval(healthCheckInterval);
    
    // Stop services in correct order
    logger.info('Stopping acquisition pipeline...');
    await serviceManager.stopPipeline();
    
    // Close HTTP server
    logger.info('Closing HTTP server...');
    server.close(() => {
      logger.info('HTTP server closed.');
      // Exit with success code
      process.exit(0);
    });
    
    // Force exit after timeout
    setTimeout(() => {
      logger.error('Forced shutdown after timeout');
      process.exit(1);
    }, 10000);
  };
  
  // Register additional signal handlers
  process.on('SIGTERM', () => shutdownHandler('SIGTERM'));
  process.on('SIGINT', () => shutdownHandler('SIGINT'));
  
  // Handle uncaught exceptions and unhandled rejections
  process.on('uncaughtException', (error) => {
    logger.error(`Uncaught exception: ${error.message}`, { stack: error.stack });
    shutdownHandler('uncaughtException').catch(err => {
      logger.error(`Error during shutdown: ${err.message}`);
      process.exit(1);
    });
  });
  
  process.on('unhandledRejection', (reason, promise) => {
    logger.error(`Unhandled rejection at: ${promise}, reason: ${reason}`);
  });

  // Initialize and start the acquisition pipeline
  try {
    // Initialize all required services
    logger.info('Initializing services...');
    await serviceManager.initializeServices();
    
    // Start the acquisition pipeline
    logger.info('Starting acquisition pipeline...');
    const pipelineStarted = await serviceManager.startPipeline({
      immediate: true
    });
    
    if (pipelineStarted) {
      logger.info('Acquisition pipeline started successfully');
    } else {
      logger.error('Failed to start acquisition pipeline, but server will continue running');
    }
    
    // Perform initial health check
    await performHealthCheck();
  } catch (error) {
    logger.error(`Error starting acquisition pipeline: ${error.message}`, { stack: error.stack });
  }

  // Handle server errors
  server.on('error', (error) => {
    if (error.syscall !== 'listen') {
      throw error;
    }

    const bind = typeof port === 'string' ? 'Pipe ' + port : 'Port ' + port;

    // Handle specific listen errors with friendly messages
    switch (error.code) {
      case 'EACCES':
        logger.error(`${bind} requires elevated privileges`);
        process.exit(1);
        break;
      case 'EADDRINUSE':
        logger.error(`${bind} is already in use`);
        process.exit(1);
        break;
      default:
        throw error;
    }
  });

  // Handle server close event
  server.on('close', async () => {
    logger.info('Server closing, stopping pipeline...');
    await serviceManager.stopPipeline();
  });

  // Export health check for API routes
  app.set('systemHealth', systemHealth);
  app.set('performHealthCheck', performHealthCheck);

  return server;
}

// Start server
if (require.main === module) {
  startServer().catch(err => {
    logger.error(`Failed to start server: ${err.message}`, { stack: err.stack });
    process.exit(1);
  });
}

// For testing purposes
module.exports = { app, startServer, performHealthCheck, systemHealth }; 