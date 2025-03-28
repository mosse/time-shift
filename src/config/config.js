module.exports = {
  // Stream URLs
  STREAM_URLS: {
    AKAMAI: 'https://akamai.example.com/stream.m3u8',
    CLOUDFRONT: 'https://cloudfront.example.com/stream.m3u8'
  },
  
  // Time settings (in milliseconds)
  BUFFER_DURATION: 8.5 * 60 * 60 * 1000, // 8.5 hours
  DELAY_DURATION: 8 * 60 * 60 * 1000,    // 8 hours
  
  // Server settings
  PORT: process.env.PORT || 3000
}; 