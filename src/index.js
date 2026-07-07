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
    playlist: { status: 'unknown', lastCheck: null },
    disk: { status: 'unknown', lastCheck: null }
  },
  errors: [],
  selfHeal: { lastAttempt: null, attempts: 0 }
};

// Health thresholds
const HEALTH_THRESHOLDS = {
  ZOMBIE_MS: 2 * 60 * 1000,        // monitor claims running but no fetch attempts
  STALE_BUFFER_MS: 3 * 60 * 1000,  // no new segments while pipeline is running
  EMPTY_BUFFER_GRACE_MS: 5 * 60 * 1000, // startup grace before an empty buffer is unhealthy
  MIN_WINDOW_DOWNLOADS: 5,          // min downloads between checks to judge success rate
  SELF_HEAL_COOLDOWN_MS: 5 * 60 * 1000,
  MAX_ZOMBIE_CHECKS_BEFORE_EXIT: 5  // consecutive zombie checks (with failed self-heal) before exiting
};

const serverStartTime = Date.now();

// Windowed downloader stats: compare totals between health checks so one
// bad hour doesn't poison a lifetime success rate (and vice versa)
let lastDownloaderSnapshot = null;
let consecutiveZombieChecks = 0;

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

    // Detect zombie state: isRunning but no recent fetch attempts.
    // Note lastFetchTime updates even on FAILED fetches, so a zombie means
    // the fetch loop itself has stopped ticking (process-local fault),
    // not that the upstream is down.
    const lastFetchAge = monitorStatus.lastFetchTime ? now - monitorStatus.lastFetchTime : Infinity;
    const isZombie = monitorStatus.isRunning && lastFetchAge > HEALTH_THRESHOLDS.ZOMBIE_MS;

    let monitorHealthStatus = 'stopped';
    if (monitorStatus.isRunning) {
      monitorHealthStatus = isZombie ? 'zombie' : 'healthy';
    }

    systemHealth.components.monitor = {
      status: monitorHealthStatus,
      lastCheck: now,
      lastFetchAge: lastFetchAge === Infinity ? null : lastFetchAge,
      isZombie,
      details: monitorStatus
    };

    // Check downloader service status via windowed success rate
    const downloaderStatus = status.downloader && typeof status.downloader === 'object' ? status.downloader : {};
    const downloaderTotals = {
      total: downloaderStatus.totalDownloads || 0,
      success: downloaderStatus.successfulDownloads || 0
    };
    let downloaderHealthStatus = 'healthy';
    let windowedSuccessRate = null;
    if (lastDownloaderSnapshot) {
      const windowTotal = downloaderTotals.total - lastDownloaderSnapshot.total;
      const windowSuccess = downloaderTotals.success - lastDownloaderSnapshot.success;
      if (windowTotal >= HEALTH_THRESHOLDS.MIN_WINDOW_DOWNLOADS) {
        windowedSuccessRate = Math.round((windowSuccess / windowTotal) * 100);
        if (windowedSuccessRate < 50) {
          downloaderHealthStatus = 'degraded';
        }
      }
    }
    lastDownloaderSnapshot = downloaderTotals;

    systemHealth.components.downloader = {
      status: downloaderHealthStatus,
      lastCheck: now,
      windowedSuccessRate,
      details: downloaderStatus
    };

    // Check buffer service status: the recorder is stale if no new segment
    // has landed recently while the pipeline claims to be running
    const bufferStatus = status.buffer && typeof status.buffer === 'object' ? status.buffer : {};
    const newestTimestamp = bufferStatus.newestTimestamp || null;
    const newestSegmentAge = newestTimestamp ? now - newestTimestamp : null;
    let bufferStale = false;
    if (status.isRunning) {
      if (newestSegmentAge !== null) {
        bufferStale = newestSegmentAge > HEALTH_THRESHOLDS.STALE_BUFFER_MS;
      } else {
        // Empty buffer: allow a startup grace period before flagging
        bufferStale = now - serverStartTime > HEALTH_THRESHOLDS.EMPTY_BUFFER_GRACE_MS;
      }
    }

    systemHealth.components.buffer = {
      status: bufferStale ? 'stale' : 'healthy',
      lastCheck: now,
      newestSegmentAge,
      details: bufferStatus
    };

    // Check disk capacity (populated by the storage guard)
    const capacity = status.capacity || null;
    systemHealth.components.disk = {
      status: capacity ? (capacity.ok ? 'healthy' : 'pressure') : 'unknown',
      lastCheck: now,
      details: capacity
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
    
    // Check if any component is not healthy. 'unknown' (not yet measured)
    // and a deliberately stopped monitor don't count against health.
    const unhealthyComponents = Object.entries(systemHealth.components)
      .filter(([name, info]) => {
        if (info.status === 'healthy' || info.status === 'unknown') return false;
        if (info.status === 'stopped' && name === 'monitor') return false;
        return true;
      });

    // Set overall health status
    systemHealth.isHealthy = unhealthyComponents.length === 0;

    if (unhealthyComponents.length > 0) {
      unhealthyComponents.forEach(([name, info]) => {
        systemHealth.errors.push(`${name} service is not healthy (${info.status})`);
      });
    }

    // Self-heal: a zombie monitor or stale recorder can often be fixed by
    // restarting the monitor loop. Attempt at most once per cooldown.
    const recorderSick = isZombie || (bufferStale && monitorStatus.isRunning);
    if (recorderSick) {
      const lastAttempt = systemHealth.selfHeal.lastAttempt || 0;
      if (now - lastAttempt > HEALTH_THRESHOLDS.SELF_HEAL_COOLDOWN_MS) {
        systemHealth.selfHeal.lastAttempt = now;
        systemHealth.selfHeal.attempts++;
        logger.warn('Health check: recorder appears stuck, restarting monitor (self-heal)');
        serviceManager.restartMonitor().catch(err => {
          logger.error(`Self-heal monitor restart failed: ${err.message}`);
        });
      }
    }

    // Exit escalation: ONLY for the zombie state. A zombie means our own
    // fetch loop died (process-local fault a restart will fix). Upstream
    // outages (fetch errors, stale buffer with a live fetch loop) must NOT
    // kill the process - it can still serve the buffered audio.
    if (isZombie) {
      consecutiveZombieChecks++;
      if (consecutiveZombieChecks >= HEALTH_THRESHOLDS.MAX_ZOMBIE_CHECKS_BEFORE_EXIT) {
        logger.error(`Monitor zombie for ${consecutiveZombieChecks} consecutive checks and self-heal failed; exiting so the container restarts clean`);
        try {
          await serviceManager.stopPipeline();
        } catch (e) {
          logger.error(`Pipeline stop during zombie exit failed: ${e.message}`);
        }
        process.exit(1);
      }
    } else {
      consecutiveZombieChecks = 0;
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
    // Socket-level errors from disconnecting clients (or a closed log pipe)
    // are not fatal - shutting down over them killed the app 42 times in
    // production. Log and keep serving.
    if (error.code === 'EPIPE' || error.code === 'ECONNRESET') {
      logger.warn(`Ignoring non-fatal socket error: ${error.code} - ${error.message}`);
      return;
    }

    logger.error(`Uncaught exception: ${error.message}`, { stack: error.stack });
    shutdownHandler('uncaughtException').catch(err => {
      logger.error(`Error during shutdown: ${err.message}`);
      process.exit(1);
    });
  });

  process.on('unhandledRejection', (reason, promise) => {
    const stack = reason instanceof Error ? reason.stack : undefined;
    logger.error(`Unhandled rejection: ${reason instanceof Error ? reason.message : reason}`, { stack });
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