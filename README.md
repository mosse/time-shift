# Time-Shift Radio Stream

A Node.js application for time-shifting radio streams.

## Features

- Buffers radio streams for delayed playback
- Supports m3u8 playlist formats
- Configurable delay and buffer durations

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

Stream URLs and time settings can be configured in `src/config/config.js`

## Project Structure

```
time-shift/
├── src/
│   ├── config/       # Configuration files
│   ├── services/     # Business logic
│   ├── routes/       # API endpoints
│   ├── utils/        # Helper functions
│   └── public/       # Static files
├── test/             # Tests
└── logs/             # Log files
``` 