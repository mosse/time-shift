// BBC Radio station definitions
const BBC_STATIONS = {
  bbc_6music: {
    id: 'bbc_6music',
    name: 'BBC Radio 6 Music',
    shortName: '6 Music'
  },
  bbc_radio_one: {
    id: 'bbc_radio_one',
    name: 'BBC Radio 1',
    shortName: 'Radio 1'
  },
  bbc_radio_two: {
    id: 'bbc_radio_two',
    name: 'BBC Radio 2',
    shortName: 'Radio 2'
  },
  bbc_radio_three: {
    id: 'bbc_radio_three',
    name: 'BBC Radio 3',
    shortName: 'Radio 3'
  },
  bbc_radio_fourfm: {
    id: 'bbc_radio_fourfm',
    name: 'BBC Radio 4',
    shortName: 'Radio 4'
  },
  bbc_radio_four_extra: {
    id: 'bbc_radio_four_extra',
    name: 'BBC Radio 4 Extra',
    shortName: 'Radio 4 Extra'
  },
  bbc_radio_five_live: {
    id: 'bbc_radio_five_live',
    name: 'BBC Radio 5 Live',
    shortName: '5 Live'
  },
  bbc_asian_network: {
    id: 'bbc_asian_network',
    name: 'BBC Asian Network',
    shortName: 'Asian Network'
  },
  bbc_world_service: {
    id: 'bbc_world_service',
    name: 'BBC World Service',
    shortName: 'World Service'
  }
};

// Helper to build stream URLs for a station
const getStreamUrl = (stationId, bitrate = 320000) => ({
  // Third-party proxy (more stable, works worldwide)
  proxy: `https://lstn.lv/bbcradio.m3u8?station=${stationId}&bitrate=${bitrate}`,
  // Direct Akamai (worldwide)
  akamai: `https://as-hls-ww-live.akamaized.net/pool_81827798/live/ww/${stationId}/${stationId}.isml/${stationId}-audio=${bitrate}.m3u8`,
  // Direct Akamai with norewind (96kbps only, but more reliable)
  akamaiNorewind: `http://as-hls-ww-live.akamaized.net/pool_81827798/live/ww/${stationId}/${stationId}.isml/${stationId}-audio%3d96000.norewind.m3u8`
});

// Default station
const DEFAULT_STATION = 'bbc_6music';

module.exports = {
  // Available BBC Radio stations
  BBC_STATIONS,
  DEFAULT_STATION,
  getStreamUrl,

  // Stream URLs - BBC 6 Music streams (legacy, for backwards compatibility)
  STREAM_URLS: {
    AKAMAI: getStreamUrl(DEFAULT_STATION).akamaiNorewind,
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
  TEST_DURATION: process.env.TEST_DURATION || 60000, // 1 minute
  
  // Disk storage settings
  STORAGE: {
    BASE_DIR: process.env.STORAGE_DIR || './data',
    SEGMENTS_DIR: 'segments',
    METADATA_FILE: 'buffer-metadata.json',
    MAX_WRITE_RETRIES: 3,
    WRITE_RETRY_DELAY: 500, // milliseconds
    CLEANUP_INTERVAL: 60000, // 1 minute
    USE_DISK_STORAGE: true
  }
}; 