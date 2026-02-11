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
        baseUrl = ''
      } = options;

      // Calculate target time (current time - delay)
      const now = Date.now();
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

      // Get segment around the target time
      const anchorSegment = await this.bufferService.getSegmentAt(targetTime);

      if (!anchorSegment) {
        const oldestTime = this.bufferService.getOldestSegmentTime();
        if (oldestTime) {
          logger.warn(`Target time ${new Date(targetTime).toISOString()} is earlier than oldest segment ${new Date(oldestTime).toISOString()}`);
        } else {
          logger.warn('No segments available at target time');
        }
        return this._generateEmptyPlaylist(baseUrl);
      }

      // Find the sequence number of the anchor segment
      const anchorSequence = anchorSegment.metadata.sequenceNumber;
      logger.debug(`Found anchor segment with sequence: ${anchorSequence}`);

      // Collect segments starting from anchor and expanding outward
      const playlistSegments = [anchorSegment];
      let maxDuration = anchorSegment.metadata.duration || 0;

      // Try to get segments before and after the anchor
      let beforeSeq = anchorSequence - 1;
      let afterSeq = anchorSequence + 1;

      while (playlistSegments.length < segmentCount) {
        let foundAny = false;

        // Try to get a segment after
        if (playlistSegments.length < segmentCount) {
          const afterSegment = await this.bufferService.getSegmentBySequence(afterSeq);
          if (afterSegment) {
            playlistSegments.push(afterSegment);
            maxDuration = Math.max(maxDuration, afterSegment.metadata.duration || 0);
            foundAny = true;
          }
          afterSeq++;
        }

        // Try to get a segment before
        if (playlistSegments.length < segmentCount && beforeSeq >= 0) {
          const beforeSegment = await this.bufferService.getSegmentBySequence(beforeSeq);
          if (beforeSegment) {
            playlistSegments.unshift(beforeSegment);
            maxDuration = Math.max(maxDuration, beforeSegment.metadata.duration || 0);
            foundAny = true;
          }
          beforeSeq--;
        }

        // If we couldn't find any more segments, stop looking
        if (!foundAny) {
          break;
        }
      }

      if (playlistSegments.length === 0) {
        logger.warn('No valid segments found for playlist');
        return this._generateEmptyPlaylist(baseUrl);
      }

      // Sort segments by sequence number to ensure correct order
      playlistSegments.sort((a, b) => a.metadata.sequenceNumber - b.metadata.sequenceNumber);

      return this._formatPlaylist(playlistSegments, maxDuration, baseUrl);
    } catch (error) {
      logger.error(`Error generating playlist: ${error}`);
      return this._generateEmptyPlaylist();
    }
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