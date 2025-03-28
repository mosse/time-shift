const express = require('express');
const path = require('path');
const morgan = require('morgan');
const cors = require('cors');
const logger = require('./utils/logger');

// Import routes
const routes = require('./routes');
const streamRoutes = require('./routes/stream');

// Create Express application
const app = express();

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
app.use(morgan('combined', { stream: { write: message => logger.info(message.trim()) } }));
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