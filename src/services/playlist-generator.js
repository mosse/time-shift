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
   * @returns {string} - Generated m3u8 playlist content
   */
  generatePlaylist(options = {}) {
    try {
      const { segmentCount = this.options.segmentCount } = options;
      
      // Calculate target time (current time - delay)
      const now = Date.now();
      const targetTime = now - this.options.timeShiftDuration;
      logger.info(`Generating playlist for target time: ${new Date(targetTime).toISOString()}`);
      
      // Get segment around the target time
      const anchorSegment = bufferService.getSegmentAt(targetTime);
      
      if (!anchorSegment) {
        logger.warn('No segments available at target time');
        return this._generateEmptyPlaylist();
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
          maxDuration = Math.max(maxDuration, segment.metadata.duration);
        }
      }
      
      if (playlistSegments.length === 0) {
        logger.warn('No valid segments found for playlist');
        return this._generateEmptyPlaylist();
      }
      
      // Sort segments by sequence number to ensure correct order
      playlistSegments.sort((a, b) => a.metadata.sequenceNumber - b.metadata.sequenceNumber);
      
      return this._formatPlaylist(playlistSegments, maxDuration);
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
   * @returns {string} - Formatted m3u8 playlist
   */
  _formatPlaylist(segments, maxDuration) {
    const targetDuration = Math.ceil(maxDuration || this.options.targetDuration);
    const mediaSequence = segments[0].metadata.sequenceNumber;
    
    // Create playlist header
    let playlist = '#EXTM3U\n';
    playlist += `#EXT-X-VERSION:${this.options.playlistVersion}\n`;
    playlist += `#EXT-X-TARGETDURATION:${targetDuration}\n`;
    playlist += `#EXT-X-MEDIA-SEQUENCE:${mediaSequence}\n`;
    
    // Add segments
    segments.forEach(segment => {
      // Add segment info
      playlist += `#EXTINF:${segment.metadata.duration.toFixed(3)},\n`;
      
      // For segment URI, use a relative URL pattern that maps to our stream endpoint
      // The segment ID will be the sequence number for easy retrieval
      playlist += `/stream/segment/${segment.metadata.sequenceNumber}.ts\n`;
    });
    
    // Don't add an end tag as this is a live stream
    
    return playlist;
  }
  
  /**
   * Generate an empty playlist with appropriate error indicators
   * @private
   * @returns {string} - Empty m3u8 playlist
   */
  _generateEmptyPlaylist() {
    let playlist = '#EXTM3U\n';
    playlist += `#EXT-X-VERSION:${this.options.playlistVersion}\n`;
    playlist += `#EXT-X-TARGETDURATION:${this.options.targetDuration}\n`;
    playlist += '#EXT-X-MEDIA-SEQUENCE:0\n';
    playlist += '#EXT-X-DISCONTINUITY\n';
    playlist += `#EXTINF:${this.options.targetDuration.toFixed(3)},\n`;
    playlist += `/stream/unavailable.ts\n`;
    
    return playlist;
  }
}

// Export a singleton instance
const playlistGenerator = new PlaylistGenerator();

module.exports = {
  playlistGenerator,
  PlaylistGenerator // Export class for testing or custom instances
}; 