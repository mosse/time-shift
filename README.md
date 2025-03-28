# Time-Shift Radio Stream

A Node.js application for time-shifting radio streams.

## Features

- Buffers radio streams for delayed playback
- Supports m3u8 playlist formats
- Configurable delay and buffer durations
- Comprehensive monitoring and logging
- Graceful shutdown and error handling
- System health checks

## Setup

1. Install dependencies:
   ```
   npm install
   ```

2. Start the server:
   ```
   npm start
   ```

   For development with auto-restart:
   ```
   npm run dev
   ```

## Configuration

Stream URLs and time settings can be configured in `src/config/config.js`. The following environment variables can be set:

- `PORT`: Server port (default: 3000)
- `LOG_LEVEL`: Logging level (default: info)
- `HEALTH_CHECK_INTERVAL`: Interval for health checks in ms (default: 60000)
- `MONITOR_INTERVAL`: Interval for stream monitoring in ms (default: 5000)
- `MAX_RETRIES`: Maximum download retries (default: 3)
- `MAX_CONCURRENT_DOWNLOADS`: Maximum concurrent downloads (default: 3)
- `SHUTDOWN_TIMEOUT`: Timeout for graceful shutdown in ms (default: 10000)

## System Architecture

The application consists of several integrated services:

1. **Monitor Service**: Monitors the radio stream for new segments
2. **Downloader Service**: Downloads segments from the stream
3. **Buffer Service**: Stores segments in memory for delayed playback
4. **Playlist Generator**: Creates playlists for time-shifted content
5. **Web Server**: Serves API and content to clients

All services are orchestrated by a central Service Manager that handles:
- Service initialization and startup
- Inter-service communication
- Graceful shutdown procedures
- Error handling and recovery

## API Endpoints

- `/api/health`: System health status
- `/api/status`: Detailed system status and metrics
- `/api/segments`: List of segments in buffer
- `/api/playlist`: Generate time-shifted playlist
- `/api/restart`: Restart the acquisition pipeline

## Testing

Run all tests:
```
npm test
```

Run specific test:
```
npm run test:system    # Run system integration test
npm run test:pipeline  # Test acquisition pipeline
npm run test:buffer    # Test buffer service
```

## Project Structure

```
time-shift/
├── src/
│   ├── config/       # Configuration files
│   ├── services/     # Service components
│   │   ├── index.js           # Service manager
│   │   ├── monitor-service.js  # Stream monitor
│   │   ├── downloader-service.js # Segment downloader
│   │   ├── buffer-service.js   # Segment buffer
│   │   └── playlist-generator.js # Playlist creation
│   ├── routes/       # API endpoints
│   ├── utils/        # Helper functions
│   │   └── logger.js # Enhanced logging
│   ├── test/         # Component tests
│   ├── public/       # Static files
│   ├── app.js        # Express application
│   └── index.js      # Application orchestrator
├── test/             # System tests
│   └── system-test.js # End-to-end test
└── logs/             # Log files
```

## Logging and Monitoring

The application includes comprehensive logging with:
- Formatted console output
- File-based logs with rotation
- Performance metrics
- Request tracking

Health checks monitor all system components and can be accessed via the `/api/health` endpoint.

## Error Handling and Recovery

The system implements:
- Graceful shutdown on SIGTERM and SIGINT signals
- Automatic recovery from connection errors
- Service restart capabilities
- Comprehensive error logging 