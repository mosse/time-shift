# encore.fm

**Live radio, on your schedule.**

Listen to global radio in your own timezone. encore.fm time-shifts live streams so you can catch BBC 6 Music's breakfast show during *your* morning — wherever you are in the world.

![screenshot placeholder]

---

## Why?

Live radio is scheduled for its home timezone. If you're 8 hours behind London, the breakfast show airs at midnight your time.

encore.fm runs in the background, continuously buffering live radio. When you're ready to listen, it serves the stream on your preferred delay — so 8am in London plays at 8am in San Francisco.

---

## Quick Start

```bash
git clone https://github.com/mosse/encore.fm
cd encore.fm
npm install
npm start
```

Open [http://localhost:3000](http://localhost:3000)

> First run needs ~8 hours to fill the buffer before playback begins.

---

## Features

- **Configurable time-shift** — 1 hour or 12, whatever fits your timezone
- **Survives restarts** — buffer persists to disk
- **PWA with background audio** — install on mobile, keeps playing when locked
- **Runs on a Raspberry Pi** — minimal resources (~300MB RAM, ~1GB storage)
- **Fully self-hosted** — no accounts, no cloud, no tracking

---

## Supported Stations

Pre-configured for BBC Radio:

| Station | ID |
|---------|-----|
| BBC Radio 1 | `bbc_radio_one` |
| BBC Radio 2 | `bbc_radio_two` |
| BBC Radio 3 | `bbc_radio_three` |
| BBC Radio 4 | `bbc_radio_fourfm` |
| BBC Radio 4 Extra | `bbc_radio_four_extra` |
| BBC Radio 5 Live | `bbc_radio_five_live` |
| **BBC Radio 6 Music** | `bbc_6music` *(default)* |
| BBC Asian Network | `bbc_asian_network` |
| BBC World Service | `bbc_world_service` |

Works with any HLS stream — just provide an `.m3u8` URL.

---

## Configuration

Edit `src/config/config.js` or use environment variables:

```bash
# Time delay (default: 8 hours)
DELAY_DURATION=28800000

# Buffer size (default: 8.5 hours)
BUFFER_DURATION=30600000

# Custom stream URL
STREAM_URL=https://example.com/stream.m3u8
```

---

## Deploy

### Docker (recommended)

```bash
docker run -d \
  --name encore-fm \
  --restart unless-stopped \
  -p 3000:3000 \
  -v encore-data:/app/data \
  ghcr.io/mosse/encore-fm:latest
```

Or with Docker Compose:

```bash
git clone https://github.com/mosse/encore.fm
cd encore.fm
docker compose up -d
```

### Node.js

```bash
npm install --production
npm start
```

### Systemd (auto-start on boot)

```bash
sudo cp contrib/encore.service /etc/systemd/system/
sudo systemctl enable encore
sudo systemctl start encore
```

### Raspberry Pi

Runs well on a Pi 3 or newer. See the [full Raspberry Pi guide](#raspberry-pi-deployment) below.

**Minimum specs:**
- Raspberry Pi Zero 2 W or better
- 8GB+ SD card (Class 10)
- Stable network connection

---

## How It Works

```
┌─────────────┐     ┌─────────────┐     ┌─────────────┐
│  Live HLS   │────▶│   Buffer    │────▶│   Player    │
│   Stream    │     │  (8+ hrs)   │     │  (delayed)  │
└─────────────┘     └─────────────┘     └─────────────┘
                          │
                          ▼
                    ┌───────────┐
                    │   Disk    │
                    │ (persist) │
                    └───────────┘
```

1. **Monitor** watches the live HLS stream for new segments
2. **Downloader** fetches segments with retry logic
3. **Buffer** stores segments on disk, indexed in memory
4. **Playlist Generator** creates time-shifted playlists on demand
5. **Web Server** serves the delayed stream to your player

---

## API

| Endpoint | Description |
|----------|-------------|
| `GET /` | Web player |
| `GET /api/health` | Health check |
| `GET /api/status` | Buffer stats and system info |
| `GET /api/playlist` | Time-shifted HLS playlist |
| `GET /api/segments` | List buffered segments |
| `POST /api/restart` | Restart acquisition pipeline |

---

## Sonos / Smart Speakers

You can stream encore.fm to Sonos speakers using TuneIn's custom URL feature.

### Add to Sonos via TuneIn

1. Go to [TuneIn Custom URL](https://tunein.com/myradio/) (log in required)
2. Click **Add Custom URL**
3. Enter:
   - **Station Name:** `encore.fm` (or whatever you like)
   - **Stream URL:** `http://<your-server-ip>:3000/api/stream.m3u8`
4. Save the station

The station will appear in your Sonos app under **My Radio Stations**.

### Direct URL for Other Devices

For devices that support HLS streams directly:

```
http://<your-server-ip>:3000/api/stream.m3u8
```

Works with:
- VLC
- mpv (`mpv http://192.168.1.x:3000/api/stream.m3u8`)
- Kodi
- Home Assistant media players
- Any HLS-compatible player

### Network Requirements

Your encore.fm server must be accessible from the device:
- For Sonos: server and speakers must be on the same local network
- For remote access: set up a reverse proxy with HTTPS (Sonos requires HTTPS for external URLs)

---

## Testing

```bash
npm test              # Run all tests
npm run test:pwa      # PWA/service worker tests
npm run test:routes   # API endpoint tests
npm run test:buffer   # Buffer service tests
```

---

## Raspberry Pi Deployment

### Hardware

- Raspberry Pi 3/4/5 (Pi Zero 2 W works but tight)
- 8GB+ microSD card (Class 10 / A1 rated)
- Ethernet recommended for reliability

### Install

```bash
# Install Node.js 18+
curl -fsSL https://deb.nodesource.com/setup_18.x | sudo -E bash -
sudo apt install -y nodejs

# Clone and install
git clone https://github.com/mosse/encore.fm
cd encore.fm
npm install --production

# Start
npm start
```

### Run as a Service

```bash
sudo nano /etc/systemd/system/encore.service
```

```ini
[Unit]
Description=encore.fm
After=network.target

[Service]
Type=simple
User=pi
WorkingDirectory=/home/pi/encore.fm
ExecStart=/usr/bin/node src/index.js
Restart=always
RestartSec=10
Environment=NODE_ENV=production

[Install]
WantedBy=multi-user.target
```

```bash
sudo systemctl enable encore
sudo systemctl start encore
```

### Performance Tips

```bash
# Reduce swappiness (less SD card wear)
echo "vm.swappiness=10" | sudo tee -a /etc/sysctl.conf
sudo sysctl -p

# Mount logs to RAM
echo "tmpfs /home/pi/encore.fm/logs tmpfs defaults,noatime,size=50M 0 0" | sudo tee -a /etc/fstab
sudo mount -a
```

---

## Project Structure

```
encore.fm/
├── src/
│   ├── config/           # Configuration
│   ├── services/         # Core services
│   │   ├── monitor-service.js
│   │   ├── downloader-service.js
│   │   ├── hybrid-buffer-service.js
│   │   └── playlist-generator.js
│   ├── routes/           # API endpoints
│   ├── public/           # Web player (PWA)
│   └── test/             # Tests
├── data/
│   ├── segments/         # Audio segments
│   └── buffer-metadata.json
└── logs/
```

---

## FAQ

**Q: Why does it need 8 hours to start?**
The buffer needs to fill before playback can begin at the configured delay. You can reduce `DELAY_DURATION` for faster startup (but less time-shift).

**Q: Can I use streams other than BBC?**
Yes — any HLS stream with an `.m3u8` playlist works. Set `STREAM_URL` to your stream.

**Q: What happens if the server restarts?**
The buffer persists to disk. On restart, it reloads existing segments and continues where it left off. Any gap during downtime is lost.

**Q: Does this work outside the UK?**
Yes. The default BBC streams work worldwide (some programmes may be geoblocked due to music licensing).

---

## License

ISC
