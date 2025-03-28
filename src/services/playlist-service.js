const axios = require('axios');
const { Parser } = require('m3u8-parser');
const config = require('../config/config');
const logger = require('../utils/logger');

/**
 * Fetches an HLS playlist from the specified URL with retry capability
 * @param {string} url - The URL of the playlist to fetch (defaults to Akamai URL in config)
 * @param {number} maxRetries - Maximum number of retry attempts
 * @param {number} retryDelay - Delay between retries in ms
 * @returns {Promise<string>} - The playlist content as a string
 */
async function fetchPlaylist(url = config.STREAM_URLS.AKAMAI, maxRetries = 3, retryDelay = 1000) {
  let retries = 0;
  
  while (true) {
    try {
      logger.info(`Fetching playlist from: ${url}`);
      const response = await axios.get(url, {
        timeout: 10000,
        headers: {
          'Accept': 'application/vnd.apple.mpegurl',
          'User-Agent': 'time-shift-radio/1.0.0'
        }
      });
      
      return response.data;
    } catch (error) {
      retries++;
      
      if (retries > maxRetries) {
        logger.error(`Failed to fetch playlist after ${maxRetries} attempts: ${error.message}`);
        throw new Error(`Failed to fetch playlist: ${error.message}`);
      }
      
      logger.warn(`Attempt ${retries}/${maxRetries} failed: ${error.message}. Retrying in ${retryDelay}ms...`);
      await new Promise(resolve => setTimeout(resolve, retryDelay));
    }
  }
}

/**
 * Parses an HLS playlist using m3u8-parser
 * @param {string} playlistContent - The raw playlist content as a string
 * @returns {Object} - The parsed playlist object
 */
function parsePlaylist(playlistContent) {
  try {
    logger.info('Parsing playlist');
    const parser = new Parser();
    parser.push(playlistContent);
    parser.end();
    
    return parser.manifest;
  } catch (error) {
    logger.error(`Error parsing playlist: ${error.message}`);
    throw new Error(`Failed to parse playlist: ${error.message}`);
  }
}

/**
 * Extracts media segment URLs from a parsed playlist
 * @param {Object} parsedPlaylist - The parsed playlist object 
 * @param {string} baseUrl - The base URL to resolve relative URLs
 * @returns {Array<string>} - Array of segment URLs
 */
function getSegmentUrls(parsedPlaylist, baseUrl) {
  try {
    logger.info('Extracting segment URLs');
    
    // If it's a master playlist, we need to first get the media playlist URLs
    if (parsedPlaylist.playlists && parsedPlaylist.playlists.length) {
      logger.info('Master playlist detected, returning variant stream URLs');
      return parsedPlaylist.playlists.map(playlist => {
        // Handle relative URLs
        if (playlist.uri.startsWith('http')) {
          return playlist.uri;
        } else {
          return new URL(playlist.uri, baseUrl).toString();
        }
      });
    }
    
    // For media playlists, get segment URLs
    if (!parsedPlaylist || !parsedPlaylist.segments || !parsedPlaylist.segments.length) {
      throw new Error('No segments found in playlist');
    }
    
    return parsedPlaylist.segments.map(segment => {
      // Handle relative URLs
      if (segment.uri.startsWith('http')) {
        return segment.uri;
      } else {
        return new URL(segment.uri, baseUrl).toString();
      }
    });
  } catch (error) {
    logger.error(`Error extracting segment URLs: ${error.message}`);
    throw new Error(`Failed to extract segment URLs: ${error.message}`);
  }
}

/**
 * Gets information about the playlist
 * @param {Object} parsedPlaylist - The parsed playlist object
 * @returns {Object} - Object with playlist information
 */
function getPlaylistInfo(parsedPlaylist) {
  try {
    if (parsedPlaylist.playlists && parsedPlaylist.playlists.length) {
      // Master playlist
      return {
        type: 'master',
        variantCount: parsedPlaylist.playlists.length,
        variants: parsedPlaylist.playlists.map(playlist => ({
          bandwidth: playlist.attributes.BANDWIDTH,
          resolution: playlist.attributes.RESOLUTION,
          codecs: playlist.attributes.CODECS
        }))
      };
    } else {
      // Media playlist
      return {
        type: 'media',
        version: parsedPlaylist.version,
        targetDuration: parsedPlaylist.targetDuration,
        segmentCount: parsedPlaylist.segments.length,
        totalDuration: parsedPlaylist.segments.reduce((acc, segment) => acc + segment.duration, 0)
      };
    }
  } catch (error) {
    logger.error(`Error getting playlist info: ${error.message}`);
    throw new Error(`Failed to get playlist info: ${error.message}`);
  }
}

module.exports = {
  fetchPlaylist,
  parsePlaylist,
  getSegmentUrls,
  getPlaylistInfo
}; 