const winston = require('winston');
const path = require('path');
const fs = require('fs');

// Ensure logs directory exists
const logsDir = path.join(process.cwd(), 'logs');
if (!fs.existsSync(logsDir)) {
  fs.mkdirSync(logsDir);
}

// Performance monitoring
const performanceMetrics = {
  startTime: Date.now(),
  counters: {
    errors: 0,
    warnings: 0,
    info: 0,
    requests: 0,
    downloads: 0
  },
  timers: {}
};

// Custom format for console output
const consoleFormat = winston.format.printf(info => {
  const { timestamp, level, message, ...rest } = info;
  const metaData = Object.keys(rest).length ? 
    `\n${JSON.stringify(rest, null, 2)}` : '';
  
  return `${timestamp} ${level}: ${message}${metaData}`;
});

// Create the logger
const logger = winston.createLogger({
  level: process.env.LOG_LEVEL || 'info',
  format: winston.format.combine(
    winston.format.timestamp({
      format: 'YYYY-MM-DD HH:mm:ss'
    }),
    winston.format.errors({ stack: true }),
    winston.format.splat(),
    winston.format.json()
  ),
  defaultMeta: {
    service: 'encore.fm',
    hostname: require('os').hostname(),
    pid: process.pid
  },
  transports: [
    new winston.transports.Console({
      format: winston.format.combine(
        winston.format.colorize(),
        consoleFormat
      )
    }),
    new winston.transports.File({ 
      filename: path.join(logsDir, 'error.log'), 
      level: 'error',
      maxsize: 5242880, // 5MB
      maxFiles: 5,
    }),
    new winston.transports.File({ 
      filename: path.join(logsDir, 'combined.log'),
      maxsize: 10485760, // 10MB
      maxFiles: 5,
    })
  ]
});

// Add a daily rotation file transport for production
if (process.env.NODE_ENV === 'production') {
  const { DailyRotateFile } = require('winston-daily-rotate-file');
  
  logger.add(new DailyRotateFile({
    filename: path.join(logsDir, 'app-%DATE%.log'),
    datePattern: 'YYYY-MM-DD',
    maxSize: '20m',
    maxFiles: '14d'
  }));
}

// Count log events by level
logger.on('logged', (info) => {
  if (info.level in performanceMetrics.counters) {
    performanceMetrics.counters[info.level]++;
  }
});

// Enhanced logger with performance tracking
const enhancedLogger = {
  error: (message, meta = {}) => {
    performanceMetrics.counters.errors++;
    return logger.error(message, meta);
  },
  warn: (message, meta = {}) => {
    performanceMetrics.counters.warnings++;
    return logger.warn(message, meta);
  },
  info: (message, meta = {}) => {
    performanceMetrics.counters.info++;
    return logger.info(message, meta);
  },
  debug: (message, meta = {}) => logger.debug(message, meta),
  verbose: (message, meta = {}) => logger.verbose(message, meta),
  
  // Track HTTP requests
  request: (req, res, responseTime) => {
    performanceMetrics.counters.requests++;
    return logger.info(`HTTP ${req.method} ${req.url} ${res.statusCode} - ${responseTime}ms`, {
      method: req.method,
      url: req.url,
      status: res.statusCode,
      responseTime,
      userAgent: req.headers['user-agent'],
      ip: req.ip || req.headers['x-forwarded-for'] || req.socket?.remoteAddress
    });
  },
  
  // Start a timer for performance measurement
  startTimer: (label) => {
    performanceMetrics.timers[label] = process.hrtime();
    return label;
  },
  
  // End a timer and log the result
  endTimer: (label, logLevel = 'debug') => {
    if (!performanceMetrics.timers[label]) {
      return logger.warn(`Timer "${label}" does not exist`);
    }
    
    const elapsed = process.hrtime(performanceMetrics.timers[label]);
    const elapsedMs = (elapsed[0] * 1000) + (elapsed[1] / 1000000);
    
    delete performanceMetrics.timers[label];
    
    logger[logLevel](`Timer "${label}" completed in ${elapsedMs.toFixed(2)}ms`, {
      timer: label,
      durationMs: elapsedMs
    });
    
    return elapsedMs;
  },
  
  // Track a download
  downloadComplete: (url, size, durationMs, success = true) => {
    performanceMetrics.counters.downloads++;
    return logger.info(`Download ${success ? 'completed' : 'failed'}: ${url}`, {
      url,
      size,
      durationMs,
      success,
      type: 'download'
    });
  },
  
  // Get performance metrics
  getMetrics: () => {
    const uptime = Date.now() - performanceMetrics.startTime;
    return {
      uptime,
      uptimeHuman: formatUptime(uptime),
      ...performanceMetrics.counters,
      activeTimers: Object.keys(performanceMetrics.timers)
    };
  },
  
  // Reset counters
  resetCounters: () => {
    Object.keys(performanceMetrics.counters).forEach(key => {
      performanceMetrics.counters[key] = 0;
    });
  }
};

// Helper function to format uptime
function formatUptime(ms) {
  const seconds = Math.floor(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);
  
  return `${days}d ${hours % 24}h ${minutes % 60}m ${seconds % 60}s`;
}

module.exports = enhancedLogger; 