module.exports = {
  // Stream URLs - Using public test streams
  STREAM_URLS: {
    AKAMAI: 'https://demo.unified-streaming.com/k8s/features/stable/video/tears-of-steel/tears-of-steel.ism/.m3u8',
    CLOUDFRONT: 'https://d2zihajmogu5jn.cloudfront.net/bipbop-advanced/bipbop_16x9_variant.m3u8'
  },
  
  // Time settings (in milliseconds)
  BUFFER_DURATION: 8.5 * 60 * 60 * 1000, // 8.5 hours
  DELAY_DURATION: 8 * 60 * 60 * 1000,    // 8 hours
  
  // Server settings
  PORT: process.env.PORT || 3000,
  
  // Monitoring and health checks
  HEALTH_CHECK_INTERVAL: process.env.HEALTH_CHECK_INTERVAL || 60000, // 1 minute
  LOG_LEVEL: process.env.LOG_LEVEL || 'info',
  
  // Graceful shutdown settings
  SHUTDOWN_TIMEOUT: process.env.SHUTDOWN_TIMEOUT || 10000, // 10 seconds
  
  // Pipeline settings
  MONITOR_INTERVAL: process.env.MONITOR_INTERVAL || 5000, // 5 seconds
  MAX_RETRIES: process.env.MAX_RETRIES || 3,
  MAX_CONCURRENT_DOWNLOADS: process.env.MAX_CONCURRENT_DOWNLOADS || 3,
  
  // Playlist generation settings
  DEFAULT_PLAYLIST_DURATION: 300, // 5 minutes in seconds
  MAX_PLAYLIST_DURATION: 3600,    // 1 hour in seconds
  
  // System test settings
  TEST_DURATION: process.env.TEST_DURATION || 60000 // 1 minute
}; 