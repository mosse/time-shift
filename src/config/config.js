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
  PORT: process.env.PORT || 3000
}; 