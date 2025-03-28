module.exports = {
  // Stream URLs - BBC 6 Music streams
  STREAM_URLS: {
    AKAMAI: 'http://as-hls-ww-live.akamaized.net/pool_81827798/live/ww/bbc_6music/bbc_6music.isml/bbc_6music-audio%3d96000.norewind.m3u8',
    CLOUDFRONT: 'http://as-hls-ww.live.cf.md.bbci.co.uk/pool_81827798/live/ww/bbc_6music/bbc_6music.isml/bbc_6music-audio%3d96000.norewind.m3u8'
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