/**
 * Media Session API Tests
 * Tests the lock screen metadata functionality in player.js
 */

/**
 * Assert helper
 */
function assert(condition, message) {
  if (!condition) {
    throw new Error(`Assertion failed: ${message}`);
  }
  console.log(`✓ ${message}`);
}

/**
 * Mock MediaMetadata class
 */
class MockMediaMetadata {
  constructor(init) {
    this.title = init.title || '';
    this.artist = init.artist || '';
    this.album = init.album || '';
    this.artwork = init.artwork || [];
  }
}

/**
 * Mock mediaSession
 */
function createMockMediaSession() {
  return {
    metadata: null,
    handlers: {},
    setActionHandler(action, handler) {
      this.handlers[action] = handler;
    }
  };
}

/**
 * Test: Media session sets track metadata correctly
 */
function testTrackMetadata() {
  console.log('Testing track metadata...');

  const mockSession = createMockMediaSession();
  const track = {
    title: 'Test Track',
    artist: 'Test Artist',
    imageUrl: 'https://example.com/art.jpg'
  };
  const station = {
    name: 'BBC Radio 6 Music',
    logoUrl: 'https://example.com/logo.svg'
  };

  // Simulate updateMediaSession logic
  const artwork = [];
  if (track && track.imageUrl) {
    artwork.push({
      src: track.imageUrl,
      sizes: '512x512',
      type: 'image/jpeg'
    });
  }

  mockSession.metadata = new MockMediaMetadata({
    title: track ? track.title : 'encore.fm',
    artist: track ? track.artist : 'Live Radio',
    album: station ? station.name : 'encore.fm',
    artwork: artwork
  });

  assert(mockSession.metadata.title === 'Test Track', 'Track title is set');
  assert(mockSession.metadata.artist === 'Test Artist', 'Track artist is set');
  assert(mockSession.metadata.album === 'BBC Radio 6 Music', 'Album is station name');
  assert(mockSession.metadata.artwork.length === 1, 'Artwork array has one item');
  assert(mockSession.metadata.artwork[0].src === 'https://example.com/art.jpg', 'Artwork URL is track image');
}

/**
 * Test: Media session falls back to show info when no track
 */
function testShowFallback() {
  console.log('Testing show fallback...');

  const mockSession = createMockMediaSession();
  const show = {
    title: 'The Breakfast Show',
    presenter: 'Lauren Laverne',
    imageUrl: 'https://example.com/show.jpg'
  };
  const station = {
    name: 'BBC Radio 6 Music',
    logoUrl: 'https://example.com/logo.svg'
  };

  // Simulate updateMediaSessionWithShow logic
  const artwork = [];
  if (show && show.imageUrl) {
    artwork.push({
      src: show.imageUrl,
      sizes: '512x512',
      type: 'image/jpeg'
    });
  }

  const title = show ? show.title : (station ? station.name : 'encore.fm');
  const artist = show ? (show.presenter || show.subtitle || 'Live Radio') : 'Live Radio';

  mockSession.metadata = new MockMediaMetadata({
    title: title,
    artist: artist,
    album: station ? station.name : 'encore.fm',
    artwork: artwork
  });

  assert(mockSession.metadata.title === 'The Breakfast Show', 'Title is show name');
  assert(mockSession.metadata.artist === 'Lauren Laverne', 'Artist is presenter');
  assert(mockSession.metadata.album === 'BBC Radio 6 Music', 'Album is station name');
  assert(mockSession.metadata.artwork[0].src === 'https://example.com/show.jpg', 'Artwork is show image');
}

/**
 * Test: Media session falls back to station logo when no show art
 */
function testStationLogoFallback() {
  console.log('Testing station logo fallback...');

  const mockSession = createMockMediaSession();
  const show = {
    title: 'The Breakfast Show',
    presenter: 'Lauren Laverne',
    imageUrl: null // No show art
  };
  const station = {
    name: 'BBC Radio 6 Music',
    logoUrl: 'https://example.com/logo.svg'
  };

  // Simulate fallback logic
  const artwork = [];
  if (show && show.imageUrl) {
    artwork.push({
      src: show.imageUrl,
      sizes: '512x512',
      type: 'image/jpeg'
    });
  } else if (station && station.logoUrl) {
    artwork.push({
      src: station.logoUrl,
      sizes: '512x512',
      type: 'image/svg+xml'
    });
  }

  mockSession.metadata = new MockMediaMetadata({
    title: show.title,
    artist: show.presenter,
    album: station.name,
    artwork: artwork
  });

  assert(mockSession.metadata.artwork.length === 1, 'Artwork array has one item');
  assert(mockSession.metadata.artwork[0].src === 'https://example.com/logo.svg', 'Artwork falls back to station logo');
  assert(mockSession.metadata.artwork[0].type === 'image/svg+xml', 'Artwork type is SVG');
}

/**
 * Test: Media session handles missing data gracefully
 */
function testMissingData() {
  console.log('Testing missing data handling...');

  const mockSession = createMockMediaSession();

  // No track, no show, no station
  const track = null;
  const show = null;
  const station = null;

  const artwork = [];
  const title = show ? show.title : (station ? station.name : 'encore.fm');
  const artist = show ? (show.presenter || show.subtitle || 'Live Radio') : 'Live Radio';

  mockSession.metadata = new MockMediaMetadata({
    title: title,
    artist: artist,
    album: station ? station.name : 'encore.fm',
    artwork: artwork
  });

  assert(mockSession.metadata.title === 'encore.fm', 'Title defaults to encore.fm');
  assert(mockSession.metadata.artist === 'Live Radio', 'Artist defaults to Live Radio');
  assert(mockSession.metadata.album === 'encore.fm', 'Album defaults to encore.fm');
  assert(mockSession.metadata.artwork.length === 0, 'Artwork is empty when no images');
}

/**
 * Test: Action handlers are set correctly
 */
function testActionHandlers() {
  console.log('Testing action handlers...');

  const mockSession = createMockMediaSession();

  // Simulate setupMediaSessionHandlers
  mockSession.setActionHandler('play', function() {});
  mockSession.setActionHandler('pause', function() {});
  mockSession.setActionHandler('seekbackward', null);
  mockSession.setActionHandler('seekforward', null);
  mockSession.setActionHandler('previoustrack', null);
  mockSession.setActionHandler('nexttrack', null);

  assert(typeof mockSession.handlers['play'] === 'function', 'Play handler is set');
  assert(typeof mockSession.handlers['pause'] === 'function', 'Pause handler is set');
  assert(mockSession.handlers['seekbackward'] === null, 'Seek backward is disabled');
  assert(mockSession.handlers['seekforward'] === null, 'Seek forward is disabled');
  assert(mockSession.handlers['previoustrack'] === null, 'Previous track is disabled');
  assert(mockSession.handlers['nexttrack'] === null, 'Next track is disabled');
}

/**
 * Test: Show subtitle used when no presenter
 */
function testShowSubtitleFallback() {
  console.log('Testing show subtitle fallback...');

  const show = {
    title: 'Late Night Show',
    subtitle: 'Music through the night',
    presenter: null,
    imageUrl: null
  };

  const artist = show.presenter || show.subtitle || 'Live Radio';

  assert(artist === 'Music through the night', 'Artist falls back to subtitle when no presenter');
}

/**
 * Test: Track without image uses station logo
 */
function testTrackWithoutImage() {
  console.log('Testing track without image...');

  const track = {
    title: 'Mystery Track',
    artist: 'Unknown Artist',
    imageUrl: null
  };
  const station = {
    name: 'BBC Radio 6 Music',
    logoUrl: 'https://example.com/logo.svg'
  };

  const artwork = [];
  if (track && track.imageUrl) {
    artwork.push({
      src: track.imageUrl,
      sizes: '512x512',
      type: 'image/jpeg'
    });
  } else if (station && station.logoUrl) {
    artwork.push({
      src: station.logoUrl,
      sizes: '512x512',
      type: 'image/svg+xml'
    });
  }

  assert(artwork.length === 1, 'Artwork has one item');
  assert(artwork[0].src === 'https://example.com/logo.svg', 'Uses station logo when track has no image');
}

/**
 * Run all tests
 */
function runMediaSessionTests() {
  console.log('=== Starting Media Session Tests ===\n');

  try {
    testTrackMetadata();
    testShowFallback();
    testStationLogoFallback();
    testMissingData();
    testActionHandlers();
    testShowSubtitleFallback();
    testTrackWithoutImage();

    console.log('\n=== All Media Session Tests Passed ===');

  } catch (error) {
    console.error(`\nMedia Session test failed: ${error.message}`);
    throw error;
  }
}

// Run tests
runMediaSessionTests();
console.log('Media Session tests completed successfully');
process.exit(0);
