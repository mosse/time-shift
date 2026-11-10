const path = require('path');
const config = require('../config/config');
const logger = require('../utils/logger');
const { hybridBufferService } = require('./hybrid-buffer-service');

/**
 * Playlist Generator Service
 * Creates HLS playlists for time-shifted playback
 */
class PlaylistGenerator {
  constructor(options = {}) {
    this.options = {
      segmentCount: options.segmentCount || 5,
      targetDuration: options.targetDuration || 10,
      timeShiftDuration: options.timeShiftDuration || config.DELAY_DURATION,
      playlistVersion: options.playlistVersion || 3,
      ...options
    };
    
    // Use the provided buffer service or default to hybridBufferService
    this.bufferService = options.bufferService || hybridBufferService;
    
    logger.info(`Initialized playlist generator with time shift: ${this.options.timeShiftDuration}ms`);
  }
  
  /**
   * Generate a time-shifted HLS playlist based on current buffer state
   * @param {Object} options - Options for playlist generation
   * @param {number} options.segmentCount - Number of segments to include in the playlist
   * @param {number} options.timeshift - Optional override for time shift in milliseconds
   * @param {string} options.baseUrl - Base URL for segment URLs
   * @returns {Object} - Generated playlist data with m3u8 content
   */
  async generatePlaylist(options = {}) {
    try {
      const {
        segmentCount = this.options.segmentCount,
        timeshift = undefined,
        baseUrl = '',
        now = Date.now()
      } = options;

      // Use provided timeshift if available, otherwise use default
      let timeShiftDuration = this.options.timeShiftDuration;
      if (timeshift !== undefined) {
        const parsed = parseInt(timeshift);
        if (isNaN(parsed) || parsed < 0) {
          logger.warn(`Invalid timeshift value: ${timeshift}, using default`);
        } else {
          timeShiftDuration = parsed * 1000; // Convert seconds to ms
        }
      }

      const targetTime = now - timeShiftDuration;
      logger.info(`Generating playlist for target time: ${new Date(targetTime).toISOString()}`);

      const anchor = this._anchorAt(targetTime);
      if (!anchor) {
        logger.warn('No segments available at target time');
        return this._generateEmptyPlaylist(baseUrl);
      }

      // A contiguous run of sequence numbers around the playhead. Numbers missing
      // from the buffer are served as gap filler by the segment route, so the
      // window keeps moving through a gap instead of repeating the audio before it.
      const durationMs = (anchor.ref.metadata.duration || 6.4) * 1000;
      const firstSeq = anchor.seq - Math.floor(segmentCount / 2);
      const playlistSegments = [];
      for (let seq = firstSeq; seq < firstSeq + segmentCount; seq++) {
        playlistSegments.push(this.bufferService.segmentsBySequence.get(seq) || {
          timestamp: anchor.ref.timestamp + (seq - anchor.ref.metadata.sequenceNumber) * durationMs,
          metadata: { sequenceNumber: seq, duration: durationMs / 1000 }
        });
      }

      const maxDuration = Math.max(...playlistSegments.map(s => s.metadata.duration || 0));
      return this._formatPlaylist(playlistSegments, maxDuration, baseUrl);
    } catch (error) {
      logger.error(`Error generating playlist: ${error}`);
      return this._generateEmptyPlaylist();
    }
  }
  
  /**
   * Sequence number playing at `targetTime`, interpolated from the last real
   * segment that started at or before it (or back from the oldest)
   * @private
   * @returns {{seq: number, ref: Object}|null}
   */
  _anchorAt(targetTime) {
    const segments = this.bufferService.segments;
    if (!segments.length) return null;

    let lo = 0;
    let hi = segments.length - 1;
    while (lo < hi) {
      const mid = Math.ceil((lo + hi) / 2);
      if (segments[mid].timestamp <= targetTime) lo = mid;
      else hi = mid - 1;
    }
    let ref = segments[lo];
    // Restored-from-disk metadata can lack a sequence number
    if (!Number.isFinite(ref.metadata?.sequenceNumber)) {
      ref = this.bufferService.getNearestValidSegment?.(targetTime);
      if (!ref) return null;
    }

    const durationMs = (ref.metadata.duration || 6.4) * 1000;
    return { seq: ref.metadata.sequenceNumber + Math.floor((targetTime - ref.timestamp) / durationMs), ref };
  }

  /**
   * Format segments into a valid HLS playlist
   * @private
   * @param {Array} segments - Array of segment objects
   * @param {number} maxDuration - Maximum segment duration
   * @param {string} baseUrl - Base URL for segment URLs
   * @returns {Object} - Formatted playlist with m3u8 content and metadata
   */
  _formatPlaylist(segments, maxDuration, baseUrl = '') {
    const targetDuration = Math.ceil(maxDuration || this.options.targetDuration);
    const mediaSequence = segments[0].metadata.sequenceNumber;
    
    // Create playlist header
    let m3u8Content = '#EXTM3U\n';
    m3u8Content += `#EXT-X-VERSION:${this.options.playlistVersion}\n`;
    m3u8Content += `#EXT-X-TARGETDURATION:${targetDuration}\n`;
    m3u8Content += `#EXT-X-MEDIA-SEQUENCE:${mediaSequence}\n`;
    
    // Prepare JSON format segments
    const jsonSegments = [];
    
    // Add segments
    segments.forEach(segment => {
      const duration = segment.metadata.duration || 10;
      const sequenceNumber = segment.metadata.sequenceNumber;
      const uri = `/stream/segment/${sequenceNumber}.ts`;

      // Wall-clock timestamp lets the player know the real capture time of
      // what it's playing (used to align track metadata with the playhead)
      if (Number.isFinite(segment.timestamp)) {
        m3u8Content += `#EXT-X-PROGRAM-DATE-TIME:${new Date(segment.timestamp).toISOString()}\n`;
      }

      // Add segment info to m3u8
      m3u8Content += `#EXTINF:${duration.toFixed(3)},\n`;
      m3u8Content += `${baseUrl}${uri}\n`;
      
      // Add to JSON format
      jsonSegments.push({
        duration,
        uri,
        sequenceNumber
      });
    });
    
    // Return both m3u8 content and structured data
    return {
      m3u8Content,
      segments: jsonSegments,
      mediaSequence,
      targetDuration
    };
  }
  
  /**
   * Generate an empty playlist with appropriate error indicators
   * @private
   * @param {string} baseUrl - Base URL for segment URLs
   * @returns {Object} - Empty m3u8 playlist data
   */
  _generateEmptyPlaylist(baseUrl = '') {
    const uri = `/stream/unavailable.ts`;
    
    let m3u8Content = '#EXTM3U\n';
    m3u8Content += `#EXT-X-VERSION:${this.options.playlistVersion}\n`;
    m3u8Content += `#EXT-X-TARGETDURATION:${this.options.targetDuration}\n`;
    m3u8Content += '#EXT-X-MEDIA-SEQUENCE:0\n';
    m3u8Content += '#EXT-X-DISCONTINUITY\n';
    m3u8Content += `#EXTINF:${this.options.targetDuration.toFixed(3)},\n`;
    m3u8Content += `${baseUrl}${uri}\n`;
    
    return {
      m3u8Content,
      segments: [],
      mediaSequence: 0,
      targetDuration: this.options.targetDuration
    };
  }
}

// Export a singleton instance
const playlistGenerator = new PlaylistGenerator();

module.exports = {
  playlistGenerator,
  PlaylistGenerator // Export class for testing or custom instances
}; 