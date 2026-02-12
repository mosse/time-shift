# encore.fm

**Live radio, on your schedule.**

A self-hosted time-shifting proxy for any HLS radio stream. Set your delay, point it at a stream, and listen on your own schedule.

![screenshot placeholder]

---

## Why?

Live radio airs on someone else's clock. encore.fm buffers any HLS stream and plays it back on a configurable delay — 1 hour, 8 hours, whatever fits your life.

**Use cases:**
- Listen to overseas radio in your own timezone
- Catch morning shows on your evening commute

---

## Quick Start

```bash
git clone https://github.com/mosse/encore.fm
cd encore.fm
npm install
npm start
```

Open [http://localhost:3000](http://localhost:3000)

> Buffer fills in real-time. An 8-hour delay needs ~8 hours before playback begins.

---

## Features

- **Any HLS stream** — works with any `.m3u8` URL
- **Configurable delay** — 1 hour to 12+ hours via environment variable
- **Survives restarts** — buffer persists to disk
- **PWA with background audio** — install on mobile, keeps playing when locked
- **Runs on a Raspberry Pi** — minimal resources (~300MB RAM, ~1GB storage)
- **Fully self-hosted** — no accounts, no cloud, no tracking

---

## Configuration

All settings via environment variables:

```bash
# Your stream URL (required for non-BBC streams)
STREAM_URL=https://example.com/stream.m3u8

# Time delay in milliseconds (default: 8 hours)
DELAY_DURATION=28800000

# Buffer size in milliseconds (default: 8.5 hours — should exceed delay)
BUFFER_DURATION=30600000

# Server port (default: 3000)
PORT=3000
```

**Example: 2-hour delay**
```bash
DELAY_DURATION=7200000 BUFFER_DURATION=9000000 npm start
```

---

## BBC Radio Streams (built-in)

Pre-configured station URLs for BBC Radio — just works out of the box:

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

To use a different BBC station, set the station ID in config or use the `getStreamUrl()` helper.

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

**Q: Why does it take so long before I can play?**
The buffer fills in real-time. An 8-hour delay needs 8 hours of buffering first. Set a shorter `DELAY_DURATION` for faster startup.

**Q: What streams work with this?**
Any HLS stream (`.m3u8` URL). This includes most internet radio stations, some TV audio streams, and live event broadcasts.

**Q: What happens if the server restarts?**
The buffer persists to disk. On restart, it reloads existing segments and continues. Any gap during downtime is lost (segments that weren't captured can't be recovered).

**Q: Can I run multiple streams?**
Not yet in a single instance. Run multiple containers/instances with different `STREAM_URL` and `PORT` values.

**Q: Does the default BBC stream work outside the UK?**
Yes. BBC streams work worldwide, though some programmes may be geoblocked due to music licensing.

---

## License

ISC
