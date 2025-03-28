const path = require('path');
const config = require('../config/config');
const logger = require('../utils/logger');
const { bufferService } = require('./buffer-service');

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
  generatePlaylist(options = {}) {
    try {
      const { 
        segmentCount = this.options.segmentCount,
        timeshift = undefined,
        baseUrl = ''
      } = options;
      
      // Calculate target time (current time - delay)
      const now = Date.now();
      // Use provided timeshift if available, otherwise use default
      const timeShiftDuration = timeshift !== undefined ? 
                               parseInt(timeshift) * 1000 : // Convert seconds to ms if provided
                               this.options.timeShiftDuration;
      
      const targetTime = now - timeShiftDuration;
      logger.info(`Generating playlist for target time: ${new Date(targetTime).toISOString()}`);
      
      // Get segment around the target time
      const anchorSegment = bufferService.getSegmentAt(targetTime);
      
      if (!anchorSegment) {
        const oldestTime = bufferService.getOldestSegmentTime();
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
      
      // Calculate sequence range (anchor segment should be in the middle)
      const startSequence = Math.max(0, anchorSequence - Math.floor(segmentCount / 2));
      const endSequence = startSequence + segmentCount - 1;
      
      // Collect segments
      const playlistSegments = [];
      let maxDuration = 0;
      
      for (let seq = startSequence; seq <= endSequence; seq++) {
        const segment = bufferService.getSegmentBySequence(seq);
        if (segment) {
          playlistSegments.push(segment);
          maxDuration = Math.max(maxDuration, segment.metadata.duration || 0);
        } else {
          logger.warn(`Segment with sequence number ${seq} not found`);
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