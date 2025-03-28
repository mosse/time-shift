const app = require('./app');
const config = require('./config/config');
const logger = require('./utils/logger');
const { serviceManager } = require('./services');

// Port setup
const port = config.PORT || 3000;

// Main function to start the server and services
async function startServer() {
  // Start HTTP server
  const server = app.listen(port, () => {
    logger.info(`Server running on port ${port}`);
  });

  // Register cleanup handlers
  serviceManager.registerSignalHandlers();

  // Initialize and start the acquisition pipeline
  try {
    // Initialize all required services
    serviceManager.initializeServices();
    
    // Start the acquisition pipeline
    const pipelineStarted = await serviceManager.startPipeline({
      immediate: true
    });
    
    if (pipelineStarted) {
      logger.info('Acquisition pipeline started successfully');
    } else {
      logger.error('Failed to start acquisition pipeline, but server will continue running');
    }
  } catch (error) {
    logger.error(`Error starting acquisition pipeline: ${error.message}`);
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

  return server;
}

// Start server
if (require.main === module) {
  startServer().catch(err => {
    logger.error(`Failed to start server: ${err.message}`);
    process.exit(1);
  });
}

// For testing purposes
module.exports = { app, startServer }; 