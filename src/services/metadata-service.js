const EventEmitter = require('events');
const logger = require('../utils/logger');
const config = require('../config/config');

/**
 * Metadata Service
 * Polls BBC API for track metadata and stores it with timestamps.
 * Designed to be completely independent of audio streaming -
 * any failures here should never impact audio playback.
 */
class MetadataService extends EventEmitter {
  constructor(options = {}) {
    super();

    // Configuration
    this.stationId = options.stationId || 'bbc_6music';
    this.pollInterval = options.pollInterval || 30000; // 30 seconds
    this.retentionDuration = options.retentionDuration || config.BUFFER_DURATION; // Match audio buffer
    this.apiBaseUrl = 'https://rms.api.bbc.co.uk/v2';

    // Station info (static)
    this.stationInfo = {
      id: 'bbc_6music',
      name: 'BBC Radio 6 Music',
      shortName: 'Radio 6 Music',
      logoUrl: 'https://sounds.files.bbci.co.uk/3.9.4/networks/bbc_6music/colour_default.svg'
    };

    // State - track metadata
    this.metadata = []; // Array of { onset, end, duration, data } objects

    // State - show/schedule metadata
    this.shows = []; // Array of { start, end, data } objects

    this.pollTimer = null;
    this.isRunning = false;
    this.lastPollTime = null;
    this.errorCount = 0;
    this.successCount = 0;

    logger.info(`Metadata service initialized for station: ${this.stationId}`);
  }

  /**
   * Start polling for metadata
   */
  start() {
    if (this.isRunning) {
      logger.warn('Metadata service already running');
      return;
    }

    this.isRunning = true;
    logger.info('Metadata service started');

    // Initial fetch
    this._safePoll();

    // Set up polling interval
    this.pollTimer = setInterval(() => {
      this._safePoll();
    }, this.pollInterval);

    // Don't let this timer keep the process alive
    this.pollTimer.unref();
  }

  /**
   * Stop polling for metadata
   */
  stop() {
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }
    this.isRunning = false;
    logger.info('Metadata service stopped');
  }

  /**
   * Safe wrapper for polling - catches all errors
   * @private
   */
  async _safePoll() {
    try {
      await this._poll();
    } catch (error) {
      // Log but never throw - metadata failures must not propagate
      this.errorCount++;
      logger.warn(`Metadata poll failed (error #${this.errorCount}): ${error.message}`);
    }
  }

  /**
   * Poll the BBC API for current track and show metadata
   * @private
   */
  async _poll() {
    // Fetch tracks and schedule in parallel
    await Promise.all([
      this._pollTracks(),
      this._pollSchedule()
    ]);
  }

  /**
   * Poll for track metadata
   * @private
   */
  async _pollTracks() {
    const url = `${this.apiBaseUrl}/services/${this.stationId}/segments/latest?experience=domestic&limit=10`;

    // Use dynamic import for fetch (Node 18+)
    const fetch = globalThis.fetch || (await import('node-fetch')).default;

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10000); // 10s timeout

    try {
      const response = await fetch(url, {
        signal: controller.signal,
        headers: {
          'Accept': 'application/json',
          'User-Agent': 'encore.fm/1.0'
        }
      });

      clearTimeout(timeout);

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      const data = await response.json();
      this._processResponse(data);

      this.lastPollTime = Date.now();
      this.successCount++;

    } catch (error) {
      clearTimeout(timeout);
      throw error;
    }
  }

  /**
   * Process API response and store metadata
   * @private
   */
  _processResponse(response) {
    if (!response?.data || !Array.isArray(response.data)) {
      logger.debug('No metadata in API response');
      return;
    }

    const now = Date.now();
    let newItems = 0;

    for (const item of response.data) {
      if (item.segment_type !== 'music') continue;

      // Calculate the actual broadcast time based on offset
      // offset.start is seconds since the track started playing
      const offsetStartMs = (item.offset?.start || 0) * 1000;
      const durationMs = ((item.offset?.end || 0) - (item.offset?.start || 0)) * 1000;
      const onsetTime = now - offsetStartMs;
      const endTime = onsetTime + durationMs;

      // Check if we already have this item (by ID)
      const existingIndex = this.metadata.findIndex(m => m.data.id === item.id);
      if (existingIndex >= 0) continue;

      // Create metadata entry with precise timing
      const entry = {
        onset: onsetTime,           // When track started (ms timestamp)
        end: endTime,               // When track ends (ms timestamp)
        duration: durationMs,       // Track duration in ms
        storedAt: now,
        data: {
          id: item.id,
          artist: item.titles?.primary || 'Unknown Artist',
          title: item.titles?.secondary || 'Unknown Track',
          imageUrl: this._formatImageUrl(item.image_url),
          isNowPlaying: item.offset?.now_playing || false,
          duration: durationMs / 1000  // Duration in seconds for display
        }
      };

      this.metadata.push(entry);
      newItems++;

      // Emit event for new track (useful for real-time UI updates)
      if (item.offset?.now_playing) {
        this.emit('nowPlaying', entry.data);
      }
    }

    if (newItems > 0) {
      logger.debug(`Stored ${newItems} new metadata entries`);
      this._pruneOldMetadata();
      this._saveMetadata();
    }
  }

  /**
   * Format image URL with a reasonable size
   * @private
   */
  _formatImageUrl(url) {
    if (!url) return null;
    // Replace {recipe} placeholder with a size
    return url.replace('{recipe}', '400x400');
  }

  /**
   * Poll for schedule/show metadata
   * @private
   */
  async _pollSchedule() {
    const url = `${this.apiBaseUrl}/experience/inline/schedules/${this.stationId}?time=now`;

    try {
      const fetch = globalThis.fetch || (await import('node-fetch')).default;

      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 10000);

      const response = await fetch(url, {
        signal: controller.signal,
        headers: {
          'Accept': 'application/json',
          'User-Agent': 'encore.fm/1.0'
        }
      });

      clearTimeout(timeout);

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      const data = await response.json();
      this._processScheduleResponse(data);

    } catch (error) {
      // Log but don't throw - schedule is non-critical
      logger.debug(`Schedule poll failed: ${error.message}`);
    }
  }

  /**
   * Process schedule API response
   * @private
   */
  _processScheduleResponse(response) {
    if (!response?.data?.[0]?.data) {
      return;
    }

    const scheduleItems = response.data[0].data;
    const now = Date.now();

    for (const item of scheduleItems) {
      if (item.type !== 'broadcast_summary') continue;

      const start = new Date(item.start).getTime();
      const end = new Date(item.end).getTime();

      // Skip if we already have this show
      const existing = this.shows.find(s => s.data.id === item.id);
      if (existing) continue;

      // Create show entry
      const entry = {
        start,
        end,
        storedAt: now,
        data: {
          id: item.id,
          title: item.titles?.primary || 'BBC Radio 6 Music',
          subtitle: item.titles?.secondary || '',
          presenter: item.titles?.tertiary || '',
          synopsis: item.synopses?.short || '',
          imageUrl: this._formatImageUrl(item.image_url),
          networkLogo: item.network?.logo_url?.replace('{type}', 'colour').replace('{size}', 'default').replace('{format}', 'svg')
        }
      };

      this.shows.push(entry);
    }

    // Prune old shows
    this._pruneOldShows();
  }

  /**
   * Remove shows older than retention duration
   * @private
   */
  _pruneOldShows() {
    const cutoffTime = Date.now() - this.retentionDuration;
    this.shows = this.shows.filter(show => show.end >= cutoffTime);
  }

  /**
   * Get show info for a specific timestamp
   * @param {number} timestamp - The timestamp to find show for
   * @returns {Object|null} The show info or null
   */
  getShowAt(timestamp) {
    for (const show of this.shows) {
      if (timestamp >= show.start && timestamp <= show.end) {
        return show.data;
      }
    }
    return null;
  }

  /**
   * Get station info (static)
   * @returns {Object} Station information
   */
  getStationInfo() {
    return this.stationInfo;
  }

  /**
   * Remove metadata entries older than retention duration
   * Aligned with audio buffer cleanup strategy
   * @private
   */
  _pruneOldMetadata() {
    const now = Date.now();
    const cutoffTime = now - this.retentionDuration;

    const beforeCount = this.metadata.length;

    // Remove tracks that ended before the cutoff
    this.metadata = this.metadata.filter(entry => entry.end >= cutoffTime);

    const removedCount = beforeCount - this.metadata.length;
    if (removedCount > 0) {
      logger.debug(`Pruned ${removedCount} metadata entries older than ${new Date(cutoffTime).toISOString()}`);
    }
  }

  /**
   * Get metadata for a specific timestamp using range-based matching
   * Returns the track that was playing at the given time
   * @param {number} timestamp - The timestamp to find metadata for
   * @param {number} tolerance - Fallback tolerance in ms if no exact match (default 30s)
   * @returns {Object|null} The metadata or null if not found
   */
  getMetadataAt(timestamp, tolerance = 30000) {
    if (this.metadata.length === 0) return null;

    // First: try exact range match (timestamp falls within onset → end)
    for (const entry of this.metadata) {
      if (timestamp >= entry.onset && timestamp <= entry.end) {
        return entry.data;
      }
    }

    // Fallback: find most recent past track within tolerance
    // (handles gaps between tracks, e.g., DJ talking)
    let mostRecentPast = null;
    let smallestGap = Infinity;

    for (const entry of this.metadata) {
      // Only consider tracks that have ended before this timestamp
      if (entry.end <= timestamp) {
        const gap = timestamp - entry.end;
        if (gap < smallestGap && gap <= tolerance) {
          mostRecentPast = entry;
          smallestGap = gap;
        }
      }
    }

    return mostRecentPast?.data || null;
  }

  /**
   * Get metadata for a time range
   * @param {number} startTime - Start timestamp
   * @param {number} endTime - End timestamp
   * @returns {Array} Array of metadata entries in the range
   */
  getMetadataInRange(startTime, endTime) {
    return this.metadata
      .filter(entry => entry.end >= startTime && entry.onset <= endTime)
      .map(entry => ({ ...entry.data, onset: entry.onset, end: entry.end }))
      .sort((a, b) => a.onset - b.onset);
  }

  /**
   * Get the most recently started track
   * @returns {Object|null} The current track or null
   */
  getCurrentTrack() {
    if (this.metadata.length === 0) return null;

    // Sort by onset descending and return most recent
    const sorted = [...this.metadata].sort((a, b) => b.onset - a.onset);
    return sorted[0]?.data || null;
  }

  /**
   * Get service statistics
   */
  getStats() {
    return {
      isRunning: this.isRunning,
      stationId: this.stationId,
      storedEntries: this.metadata.length,
      lastPollTime: this.lastPollTime,
      successCount: this.successCount,
      errorCount: this.errorCount,
      oldestEntry: this.metadata.length > 0
        ? Math.min(...this.metadata.map(m => m.onset))
        : null,
      newestEntry: this.metadata.length > 0
        ? Math.max(...this.metadata.map(m => m.onset))
        : null
    };
  }

  /**
   * Save metadata to disk (fire and forget)
   * @private
   */
  async _saveMetadata() {
    try {
      const fs = require('fs').promises;
      const path = require('path');
      const metadataPath = path.join(config.STORAGE.BASE_DIR, 'track-metadata.json');

      // Only save essential data
      const toSave = {
        savedAt: Date.now(),
        stationId: this.stationId,
        entries: this.metadata.slice(0, 1000) // Save up to 1000 entries
      };

      await fs.writeFile(metadataPath, JSON.stringify(toSave), 'utf8');
      logger.debug('Saved track metadata to disk');
    } catch (error) {
      // Never throw from save - just log
      logger.warn(`Failed to save metadata: ${error.message}`);
    }
  }

  /**
   * Load metadata from disk
   */
  async loadFromDisk() {
    try {
      const fs = require('fs').promises;
      const path = require('path');
      const metadataPath = path.join(config.STORAGE.BASE_DIR, 'track-metadata.json');

      const data = await fs.readFile(metadataPath, 'utf8');
      const parsed = JSON.parse(data);

      if (parsed.entries && Array.isArray(parsed.entries)) {
        // Migrate old format (timestamp) to new format (onset/end)
        this.metadata = parsed.entries.map(entry => {
          if (entry.onset !== undefined) {
            return entry; // Already new format
          }
          // Convert old format
          const duration = (entry.data?.duration || 180) * 1000; // Default 3 min
          return {
            onset: entry.timestamp,
            end: entry.timestamp + duration,
            duration: duration,
            storedAt: entry.storedAt,
            data: entry.data
          };
        });

        logger.info(`Loaded ${this.metadata.length} metadata entries from disk`);
      }
    } catch (error) {
      // File doesn't exist or is invalid - that's fine
      if (error.code !== 'ENOENT') {
        logger.warn(`Failed to load metadata: ${error.message}`);
      }
    }
  }
}

// Singleton instance
const metadataService = new MetadataService();

module.exports = {
  metadataService,
  MetadataService
};
