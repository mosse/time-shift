# Time-Shift Radio Stream

A Node.js application for time-shifting HLS radio streams with persistent storage.

## Features

- Buffers radio streams for delayed playback
- Hybrid buffer system with disk persistence for reliability across restarts
- Supports m3u8 playlist formats (HLS)
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
- `BUFFER_DURATION`: Duration of the buffer in ms (default: 30600000, which is 8.5 hours)
- `STORAGE_BASE_DIR`: Directory for storing segments (default: 'data')
- `STORAGE_SEGMENTS_DIR`: Subdirectory for segments (default: 'segments')
- `STORAGE_METADATA_FILE`: Filename for buffer metadata (default: 'buffer-metadata.json')

### Configuring a Custom Stream Source

To use your preferred HLS stream, modify the `src/config/config.js` file:

1. **Locate the stream configuration section**:
   ```javascript
   // Stream configuration
   STREAM: {
     URL: process.env.STREAM_URL || 'https://example.com/stream/audio.m3u8',
     TIME_SHIFT: Number(process.env.TIME_SHIFT) || 8 * 60 * 60 * 1000, // 8 hours in milliseconds
   },
   ```

2. **Change the URL to your preferred stream**:
   ```javascript
   STREAM: {
     URL: 'https://your-stream-provider.com/your-stream-url.m3u8',
     TIME_SHIFT: 8 * 60 * 60 * 1000, // 8 hours in milliseconds
   },
   ```

3. **Alternatively, set the environment variable**:
   ```bash
   export STREAM_URL="https://your-stream-provider.com/your-stream-url.m3u8"
   ```
   
   Or add it to your `.env` file:
   ```
   STREAM_URL=https://your-stream-provider.com/your-stream-url.m3u8
   ```

4. **Adjust the time shift as needed**:
   Change the `TIME_SHIFT` value to your desired delay in milliseconds.
   
   For example, for a 2-hour delay:
   ```javascript
   TIME_SHIFT: 2 * 60 * 60 * 1000, // 2 hours in milliseconds
   ```
   
   Or set it with an environment variable:
   ```bash
   export TIME_SHIFT=7200000  # 2 hours in milliseconds
   ```

5. **Restart the application** for the changes to take effect:
   ```bash
   npm restart
   # or if running as a service
   sudo systemctl restart timeshift
   ```

**Note:** The stream must be an HLS stream with an m3u8 playlist format. Other streaming formats are not currently supported.

## System Architecture

The application consists of several integrated services:

1. **Monitor Service**: Monitors the radio stream for new segments
2. **Downloader Service**: Downloads segments from the stream
3. **Hybrid Buffer Service**: Stores segments on disk with in-memory metadata for delayed playback
4. **Disk Storage Service**: Manages file operations for persistent storage
5. **Playlist Generator**: Creates playlists for time-shifted content
6. **Web Server**: Serves API and content to clients

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
npm run test:system           # Run system integration test
npm run test:pipeline         # Test acquisition pipeline
npm run test:buffer           # Test buffer service
npm run test:disk-storage     # Test disk storage service
npm run test:hybrid-buffer    # Test hybrid buffer service
```

## Project Structure

```
time-shift/
├── src/
│   ├── config/       # Configuration files
│   ├── services/     # Service components
│   │   ├── index.js              # Service manager
│   │   ├── monitor-service.js    # Stream monitor
│   │   ├── downloader-service.js # Segment downloader
│   │   ├── buffer-service.js     # In-memory buffer (legacy)
│   │   ├── hybrid-buffer-service.js # Disk-based buffer with memory index
│   │   ├── disk-storage-service.js # File system operations
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
├── data/             # Segment and metadata storage
│   ├── segments/     # Audio segments
│   └── buffer-metadata.json # Buffer state
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
- Persistent buffer storage for recovery after restart
- Graceful shutdown on SIGTERM and SIGINT signals
- Automatic recovery from connection errors
- Service restart capabilities
- Comprehensive error logging

## Raspberry Pi Deployment

### Hardware Requirements
- Raspberry Pi 4 (2GB RAM minimum, 4GB recommended)
- 32GB or larger microSD card (Class 10 or better)
- Reliable power supply
- Ethernet connection (recommended) or stable WiFi

### Installation Steps

1. **Set up Raspberry Pi OS**
   - Download and install Raspberry Pi OS Lite (64-bit recommended)
   - Set up SSH for headless operation
   - Update the system:
     ```
     sudo apt update && sudo apt upgrade -y
     ```

2. **Install Node.js**
   ```bash
   # Install Node.js repository
   curl -fsSL https://deb.nodesource.com/setup_18.x | sudo -E bash -
   
   # Install Node.js
   sudo apt install -y nodejs
   
   # Verify installation
   node --version
   npm --version
   ```

3. **Clone and Set Up the Application**
   ```bash
   # Create application directory
   mkdir -p ~/apps
   cd ~/apps
   
   # Clone the repository
   git clone https://github.com/mosse/time-shift.git
   cd time-shift
   
   # Install dependencies
   npm install --production
   
   # Create data directories
   mkdir -p data/segments
   ```

4. **Configure the Application**
   ```bash
   # Create environment variables file
   cat > .env << EOF
   PORT=3000
   LOG_LEVEL=info
   BUFFER_DURATION=30600000
   STORAGE_BASE_DIR=data
   STORAGE_SEGMENTS_DIR=segments
   STORAGE_METADATA_FILE=buffer-metadata.json
   STREAM_URL=https://your-stream-provider.com/your-stream-url.m3u8
   TIME_SHIFT=28800000
   EOF
   ```

5. **Set Up Systemd Service for Auto-start**
   ```bash
   # Create service file
   sudo bash -c 'cat > /etc/systemd/system/timeshift.service << EOF
   [Unit]
   Description=Time-Shift Radio Service
   After=network.target
   
   [Service]
   Type=simple
   User=pi
   WorkingDirectory=/home/pi/apps/time-shift
   ExecStart=/usr/bin/node src/index.js
   Restart=always
   RestartSec=10
   StandardOutput=syslog
   StandardError=syslog
   SyslogIdentifier=timeshift
   Environment=NODE_ENV=production
   
   [Install]
   WantedBy=multi-user.target
   EOF'
   
   # Enable and start the service
   sudo systemctl enable timeshift
   sudo systemctl start timeshift
   ```

6. **Monitor the Service**
   ```bash
   # Check service status
   sudo systemctl status timeshift
   
   # View logs
   sudo journalctl -u timeshift -f
   ```

7. **Set Up Storage Management (Optional)**
   ```bash
   # Create a daily cron job to clean up old log files
   (crontab -l 2>/dev/null; echo "0 0 * * * find /home/pi/apps/time-shift/logs -name \"*.log.\" -mtime +7 -delete") | crontab -
   ```

8. **Access the Web Interface**
   
   Open a browser and navigate to `http://<raspberry-pi-ip>:3000`

### Performance Tuning

1. **Adjust swappiness for better performance**
   ```bash
   echo "vm.swappiness=10" | sudo tee -a /etc/sysctl.conf
   sudo sysctl -p
   ```

2. **Optimize file system for SD card longevity**
   ```bash
   # Add to /etc/fstab
   sudo bash -c 'echo "tmpfs /home/pi/apps/time-shift/logs tmpfs defaults,noatime,size=100M 0 0" >> /etc/fstab'
   sudo mount -a
   ```

3. **Monitor resource usage**
   ```bash
   # Install htop for better system monitoring
   sudo apt install htop
   
   # Run htop to monitor system resources
   htop
   ```

### Troubleshooting

If the service fails to start or crashes:

1. Check the logs:
   ```bash
   sudo journalctl -u timeshift -e
   ```

2. Verify disk space:
   ```bash
   df -h
   ```

3. Check memory usage:
   ```bash
   free -h
   ```

4. Manual restart:
   ```bash
   sudo systemctl restart timeshift
   ```

5. Test the application manually:
   ```bash
   cd ~/apps/time-shift
   node src/index.js
   ``` 