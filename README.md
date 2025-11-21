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

### Server Settings
- `PORT`: Server port (default: 3000)
- `NODE_ENV`: Environment mode - `development` or `production` (default: development)
- `LOG_LEVEL`: Logging level (default: info)

### Security Settings (New)
- `ADMIN_API_KEY`: API key for admin endpoints like `/api/restart`. **Required in production** - without it, admin endpoints return 403.
- `CORS_ORIGINS`: Comma-separated list of allowed origins for CORS. **Required in production** for cross-origin requests. Example: `http://localhost:3000,http://192.168.1.100:3000`

### Pipeline Settings
- `HEALTH_CHECK_INTERVAL`: Interval for health checks in ms (default: 60000)
- `MONITOR_INTERVAL`: Interval for stream monitoring in ms (default: 5000)
- `MAX_RETRIES`: Maximum download retries (default: 3)
- `MAX_CONCURRENT_DOWNLOADS`: Maximum concurrent downloads (default: 3)
- `SHUTDOWN_TIMEOUT`: Timeout for graceful shutdown in ms (default: 10000)

### Storage Settings
- `STORAGE_DIR`: Directory for storing segments (default: './data')

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

### Public Endpoints
- `GET /api/health`: System health status
- `GET /api/status`: Detailed system status and metrics
- `GET /api/segments`: List of segments in buffer
- `GET /api/playlist`: Generate time-shifted playlist (supports `duration`, `format`, `timeshift` query params)

### Protected Endpoints (require `X-API-Key` header or `apiKey` query param)
- `GET /api/restart`: Restart the acquisition pipeline

### Streaming Endpoints
- `GET /stream.m3u8`: Main HLS playlist
- `GET /stream/segment/:sequenceNumber.ts`: Individual segment by sequence number
- `GET /segments/:id`: Time-shifted segment by ID/timestamp
- `GET /stream/status`: Current buffer status for streaming

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
   # Install Node.js 20.x LTS (recommended)
   curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -

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
   # Generate a secure API key
   GENERATED_KEY=$(openssl rand -hex 32)

   # Create environment variables file
   cat > .env << EOF
   # Server
   PORT=3000
   NODE_ENV=production

   # Security (REQUIRED for production)
   ADMIN_API_KEY=${GENERATED_KEY}
   CORS_ORIGINS=http://localhost:3000

   # Logging
   LOG_LEVEL=info

   # Storage
   STORAGE_DIR=./data
   EOF

   # Display the generated API key (save this!)
   echo ""
   echo "=========================================="
   echo "Your ADMIN_API_KEY: ${GENERATED_KEY}"
   echo "=========================================="
   echo "Save this key! You need it to use /api/restart"
   ```

   **Important:** The `ADMIN_API_KEY` is required in production to access admin endpoints like `/api/restart`. Without it, these endpoints will return 403 Forbidden.

   If you need to access the service from other devices on your network, update `CORS_ORIGINS`:
   ```bash
   # Example: Allow access from any device on your local network
   CORS_ORIGINS=http://192.168.1.100:3000,http://localhost:3000
   ```

5. **Set Up Systemd Service for Auto-start**

   **Note:** Replace `pi` with your actual username if different (check with `whoami`).

   ```bash
   # Get current username
   CURRENT_USER=$(whoami)

   # Create service file
   sudo bash -c "cat > /etc/systemd/system/timeshift.service << EOF
   [Unit]
   Description=Time-Shift Radio Service
   After=network.target

   [Service]
   Type=simple
   User=${CURRENT_USER}
   WorkingDirectory=/home/${CURRENT_USER}/apps/time-shift
   EnvironmentFile=/home/${CURRENT_USER}/apps/time-shift/.env
   ExecStart=/usr/bin/node src/index.js
   Restart=always
   RestartSec=10
   StandardOutput=syslog
   StandardError=syslog
   SyslogIdentifier=timeshift

   [Install]
   WantedBy=multi-user.target
   EOF"

   # Reload systemd, enable and start the service
   sudo systemctl daemon-reload
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
   # Create a daily cron job to clean up old log files (runs at midnight)
   (crontab -l 2>/dev/null; echo "0 0 * * * find ~/apps/time-shift/logs -name '*.log*' -mtime +7 -delete") | crontab -
   ```

8. **Configure Firewall (Recommended)**
   ```bash
   # Install and configure UFW firewall
   sudo apt install -y ufw

   # Allow SSH (important - don't lock yourself out!)
   sudo ufw allow 22/tcp

   # Allow the time-shift service
   sudo ufw allow 3000/tcp

   # Enable the firewall
   sudo ufw enable

   # Check status
   sudo ufw status
   ```

9. **Access the Web Interface**

   Open a browser and navigate to `http://<raspberry-pi-ip>:3000`

   To use the admin restart endpoint:
   ```bash
   # Using curl with your API key
   curl -H "X-API-Key: YOUR_ADMIN_API_KEY" http://localhost:3000/api/restart
   ```

### Performance Tuning

1. **Adjust swappiness for better performance**
   ```bash
   echo "vm.swappiness=10" | sudo tee -a /etc/sysctl.conf
   sudo sysctl -p
   ```
   
   **What is swappiness?** 
   Swappiness is a Linux kernel parameter that controls how aggressively the system swaps memory pages from RAM to the swap file. Values range from 0 to 100:
   
   - Higher values (default is 60) make the system more aggressive about moving memory to swap
   - Lower values (like 10) tell the system to avoid swapping unless necessary
   
   **Why change it for this application?**
   
   - The time-shift buffer service keeps metadata indices in memory for performance
   - SD cards have much slower read/write speeds than RAM
   - Excessive swapping causes significant performance degradation on Raspberry Pi
   - Lower swappiness reduces I/O operations on the SD card, extending card lifespan
   - Setting it to 10 (not 0) still allows swapping when memory pressure is high
   
   This adjustment maintains responsive performance while still providing memory protection during peak loads.

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