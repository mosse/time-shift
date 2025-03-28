const express = require('express');
const path = require('path');
const morgan = require('morgan');
const cors = require('cors');
const logger = require('./utils/logger');
const { serviceManager } = require('./services');
const { PlaylistGenerator } = require('./services/playlist-generator');
const config = require('./config/config');

// Import routes
const routes = require('./routes');
const streamRoutes = require('./routes/stream');
const apiRoutes = require('./routes/api');

// Create Express application
const app = express();

// Initialize playlist generator
const playlistGenerator = new PlaylistGenerator({
  bufferService: serviceManager.bufferService,
  timeShift: config.DELAY_DURATION || 28800000, // 8 hours
  baseUrl: `http://localhost:${config.PORT || 3000}`
});

// Make playlist generator available to routes
app.set('playlistGenerator', playlistGenerator);

// Configure CORS
const corsOptions = {
  origin: '*', // In production, restrict this to specific origins
  methods: ['GET', 'POST', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Range', 'Authorization'],
  exposedHeaders: ['Content-Length', 'Content-Range', 'Accept-Ranges'],
  maxAge: 600 // Cache preflight requests for 10 minutes
};

// Apply middleware
app.use(cors(corsOptions));

// Setup request logging with built-in response time
app.use(morgan(':method :url :status :response-time ms - :res[content-length]', { 
  stream: { 
    write: message => {
      const parts = message.split(' ');
      // Extract response time from log message
      const responseTimeIndex = parts.findIndex(part => part.endsWith('ms'));
      if (responseTimeIndex > 0) {
        const responseTime = parseFloat(parts[responseTimeIndex]);
        if (!isNaN(responseTime)) {
          // Use enhanced logger to track request metrics
          logger.request(
            { method: parts[0], url: parts[1], headers: {} },
            { statusCode: parseInt(parts[2]) },
            responseTime
          );
          return;
        }
      }
      // Fallback to simple logging if response time not found
      logger.info(message.trim());
    } 
  } 
}));

app.use(express.json());
app.use(express.urlencoded({ extended: false }));
app.use(express.static(path.join(__dirname, 'public')));

// Security headers middleware
app.use((req, res, next) => {
  // Security headers
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-XSS-Protection', '1; mode=block');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  
  // For streaming endpoints
  if (req.path.startsWith('/stream')) {
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Accept-Ranges', 'bytes');
  }
  
  next();
});

// Apply routes
app.use('/', routes);
app.use('/', streamRoutes);
app.use('/api', apiRoutes);

// 404 handler
app.use((req, res, next) => {
  const err = new Error('Not Found');
  err.status = 404;
  next(err);
});

// Error handler
app.use((err, req, res, next) => {
  const status = err.status || 500;
  const message = err.message || 'Internal Server Error';
  
  // Log server errors
  if (status === 500) {
    logger.error(`Server error: ${err.message}`, { 
      stack: err.stack,
      path: req.path,
      method: req.method
    });
  }
  
  res.status(status).json({
    status: 'error',
    statusCode: status,
    message: message,
    // Add stack trace in development
    ...(process.env.NODE_ENV !== 'production' && { stack: err.stack })
  });
});

module.exports = app; 