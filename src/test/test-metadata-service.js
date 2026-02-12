/**
 * MetadataService Tests
 * Tests for the BBC track metadata polling and storage service
 */

const logger = require('../utils/logger');
const { MetadataService } = require('../services/metadata-service');
const config = require('../config/config');

/**
 * Assert helper
 */
function assert(condition, message) {
  if (!condition) {
    throw new Error(`Assertion failed: ${message}`);
  }
  logger.info(`✓ ${message}`);
}

/**
 * Sleep helper
 */
function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Test: MetadataService initialization with default options
 */
async function testDefaultInitialization() {
  logger.info('Testing MetadataService default initialization...');

  const service = new MetadataService();

  assert(service.stationId === 'bbc_6music', 'Default station is BBC 6 Music');
  assert(service.pollInterval === 30000, 'Default poll interval is 30 seconds');
  assert(service.retentionDuration === config.BUFFER_DURATION, 'Retention matches buffer duration');
  assert(service.isRunning === false, 'Not running initially');
  assert(service.metadata.length === 0, 'No metadata initially');
  assert(service.errorCount === 0, 'No errors initially');
  assert(service.successCount === 0, 'No successes initially');
}

/**
 * Test: MetadataService initialization with custom options
 */
async function testCustomInitialization() {
  logger.info('Testing MetadataService custom initialization...');

  const customOptions = {
    stationId: 'bbc_radio_1',
    pollInterval: 60000,
    retentionDuration: 3600000 // 1 hour
  };

  const service = new MetadataService(customOptions);

  assert(service.stationId === 'bbc_radio_1', 'Custom station ID set');
  assert(service.pollInterval === 60000, 'Custom poll interval set');
  assert(service.retentionDuration === 3600000, 'Custom retention duration set');
}

/**
 * Test: Start and stop service
 */
async function testStartStop() {
  logger.info('Testing MetadataService start/stop...');

  const service = new MetadataService({ pollInterval: 60000 }); // Long interval to avoid actual polling

  assert(service.isRunning === false, 'Not running before start');

  service.start();
  assert(service.isRunning === true, 'Running after start');
  assert(service.pollTimer !== null, 'Poll timer created');

  service.stop();
  assert(service.isRunning === false, 'Not running after stop');
  assert(service.pollTimer === null, 'Poll timer cleared');
}

/**
 * Test: Double start is handled gracefully
 */
async function testDoubleStart() {
  logger.info('Testing MetadataService double start handling...');

  const service = new MetadataService({ pollInterval: 60000 });

  service.start();
  const firstTimer = service.pollTimer;

  service.start(); // Should warn but not crash
  assert(service.pollTimer === firstTimer, 'Timer not replaced on double start');

  service.stop();
}

/**
 * Test: getMetadataAt with range-based matching
 */
async function testGetMetadataAt() {
  logger.info('Testing MetadataService getMetadataAt...');

  const service = new MetadataService();
  const now = Date.now();

  // Add test metadata with onset/end ranges (each track ~3 minutes)
  service.metadata = [
    {
      onset: now - 300000,     // Started 5 min ago
      end: now - 120000,       // Ended 2 min ago
      duration: 180000,        // 3 min duration
      data: { id: '1', artist: 'Artist 1', title: 'Track 1' }
    },
    {
      onset: now - 600000,     // Started 10 min ago
      end: now - 420000,       // Ended 7 min ago
      duration: 180000,
      data: { id: '2', artist: 'Artist 2', title: 'Track 2' }
    },
    {
      onset: now - 900000,     // Started 15 min ago
      end: now - 720000,       // Ended 12 min ago
      duration: 180000,
      data: { id: '3', artist: 'Artist 3', title: 'Track 3' }
    }
  ];

  // Test exact range match (time falls within track's onset-end)
  const inRange = service.getMetadataAt(now - 200000); // 3:20 ago - within Track 1's range
  assert(inRange !== null, 'Found metadata for timestamp within range');
  assert(inRange.id === '1', 'Correct metadata returned for range match');

  // Test fallback within tolerance (between tracks)
  const betweenTracks = service.getMetadataAt(now - 400000); // 6:40 ago - between Track 1 and 2
  assert(betweenTracks !== null, 'Found closest metadata for gap between tracks');

  // Test outside tolerance
  const outsideTolerance = service.getMetadataAt(now - 1200000, 60000); // 20 min ago, 1 min tolerance
  assert(outsideTolerance === null, 'No metadata outside tolerance');

  // Test empty metadata
  service.metadata = [];
  const emptyResult = service.getMetadataAt(now);
  assert(emptyResult === null, 'Returns null for empty metadata');
}

/**
 * Test: getMetadataInRange
 */
async function testGetMetadataInRange() {
  logger.info('Testing MetadataService getMetadataInRange...');

  const service = new MetadataService();
  const now = Date.now();

  // Each track ~100s duration
  service.metadata = [
    { onset: now - 100000, end: now, duration: 100000, data: { id: '1' } },
    { onset: now - 200000, end: now - 100000, duration: 100000, data: { id: '2' } },
    { onset: now - 300000, end: now - 200000, duration: 100000, data: { id: '3' } },
    { onset: now - 400000, end: now - 300000, duration: 100000, data: { id: '4' } },
    { onset: now - 500000, end: now - 400000, duration: 100000, data: { id: '5' } }
  ];

  // Get range - should include all tracks that overlap with the range
  // Range: -350000 to -150000 overlaps with tracks 2, 3, 4
  const range = service.getMetadataInRange(now - 350000, now - 150000);
  assert(range.length === 3, 'Returns correct number of entries overlapping range');

  // Narrower range - should include only tracks 2 and 3
  const narrowRange = service.getMetadataInRange(now - 250000, now - 150000);
  assert(narrowRange.length === 2, 'Returns correct entries for narrow range');

  // Empty range - no tracks overlap
  const emptyRange = service.getMetadataInRange(now + 100000, now + 200000);
  assert(emptyRange.length === 0, 'Returns empty array for range with no entries');
}

/**
 * Test: getCurrentTrack
 */
async function testGetCurrentTrack() {
  logger.info('Testing MetadataService getCurrentTrack...');

  const service = new MetadataService();
  const now = Date.now();

  // Empty metadata
  assert(service.getCurrentTrack() === null, 'Returns null for empty metadata');

  // With metadata - should return most recently started track
  service.metadata = [
    { onset: now - 300000, end: now - 200000, duration: 100000, data: { id: '1', artist: 'Old Artist' } },
    { onset: now - 100000, end: now, duration: 100000, data: { id: '2', artist: 'Current Artist' } },
    { onset: now - 200000, end: now - 100000, duration: 100000, data: { id: '3', artist: 'Middle Artist' } }
  ];

  const current = service.getCurrentTrack();
  assert(current !== null, 'Returns current track');
  assert(current.id === '2', 'Returns most recent track');
}

/**
 * Test: Time-based pruning
 */
async function testTimePruning() {
  logger.info('Testing MetadataService time-based pruning...');

  const service = new MetadataService({
    retentionDuration: 300000 // 5 minutes for testing
  });

  const now = Date.now();

  // Add metadata with various ages - pruning is based on track end time
  service.metadata = [
    { onset: now - 120000, end: now - 60000, duration: 60000, data: { id: '1' } },   // Ended 1 min ago - keep
    { onset: now - 240000, end: now - 180000, duration: 60000, data: { id: '2' } },  // Ended 3 min ago - keep
    { onset: now - 420000, end: now - 360000, duration: 60000, data: { id: '3' } },  // Ended 6 min ago - prune
    { onset: now - 660000, end: now - 600000, duration: 60000, data: { id: '4' } }   // Ended 10 min ago - prune
  ];

  // Trigger pruning
  service._pruneOldMetadata();

  assert(service.metadata.length === 2, 'Pruned old entries');
  assert(service.metadata.every(m => m.data.id === '1' || m.data.id === '2'), 'Kept correct entries');
}

/**
 * Test: getStats
 */
async function testGetStats() {
  logger.info('Testing MetadataService getStats...');

  const service = new MetadataService();
  const now = Date.now();

  service.isRunning = true;
  service.successCount = 10;
  service.errorCount = 2;
  service.lastPollTime = now;
  service.metadata = [
    { timestamp: now - 100000, data: { id: '1' } },
    { timestamp: now - 200000, data: { id: '2' } }
  ];

  const stats = service.getStats();

  assert(stats.isRunning === true, 'Stats includes running state');
  assert(stats.stationId === 'bbc_6music', 'Stats includes station ID');
  assert(stats.storedEntries === 2, 'Stats includes entry count');
  assert(stats.successCount === 10, 'Stats includes success count');
  assert(stats.errorCount === 2, 'Stats includes error count');
  assert(stats.lastPollTime === now, 'Stats includes last poll time');
  assert(stats.oldestEntry !== null, 'Stats includes oldest entry');
  assert(stats.newestEntry !== null, 'Stats includes newest entry');
}

/**
 * Test: Image URL formatting
 */
async function testImageUrlFormatting() {
  logger.info('Testing MetadataService image URL formatting...');

  const service = new MetadataService();

  const url = 'https://ichef.bbci.co.uk/images/ic/{recipe}/p0bqcdzf.jpg';
  const formatted = service._formatImageUrl(url);

  assert(formatted === 'https://ichef.bbci.co.uk/images/ic/400x400/p0bqcdzf.jpg', 'Recipe placeholder replaced');

  const nullResult = service._formatImageUrl(null);
  assert(nullResult === null, 'Returns null for null input');
}

/**
 * Test: Error handling in safe poll
 */
async function testSafePollErrorHandling() {
  logger.info('Testing MetadataService safe poll error handling...');

  const service = new MetadataService();

  // Mock _poll to throw
  const originalPoll = service._poll;
  service._poll = async () => {
    throw new Error('Network error');
  };

  // Should not throw
  await service._safePoll();

  assert(service.errorCount === 1, 'Error count incremented');

  // Restore
  service._poll = originalPoll;
}

/**
 * Test: Process response with valid data
 */
async function testProcessResponse() {
  logger.info('Testing MetadataService _processResponse...');

  const service = new MetadataService();

  const mockResponse = {
    data: [
      {
        segment_type: 'music',
        id: 'test123',
        titles: {
          primary: 'Test Artist',
          secondary: 'Test Track'
        },
        image_url: 'https://example.com/{recipe}/image.jpg',
        offset: {
          start: 100,
          end: 300,
          now_playing: true
        }
      },
      {
        segment_type: 'speech', // Should be ignored
        id: 'speech1',
        titles: { primary: 'DJ Talk' }
      }
    ]
  };

  service._processResponse(mockResponse);

  assert(service.metadata.length === 1, 'Only music segments stored');
  assert(service.metadata[0].data.artist === 'Test Artist', 'Artist extracted');
  assert(service.metadata[0].data.title === 'Test Track', 'Title extracted');
  assert(service.metadata[0].data.imageUrl.includes('400x400'), 'Image URL formatted');
}

/**
 * Test: Duplicate detection
 */
async function testDuplicateDetection() {
  logger.info('Testing MetadataService duplicate detection...');

  const service = new MetadataService();

  const mockResponse = {
    data: [
      {
        segment_type: 'music',
        id: 'track1',
        titles: { primary: 'Artist', secondary: 'Track' },
        offset: { start: 0, now_playing: true }
      }
    ]
  };

  service._processResponse(mockResponse);
  assert(service.metadata.length === 1, 'First entry added');

  service._processResponse(mockResponse);
  assert(service.metadata.length === 1, 'Duplicate not added');
}

/**
 * Test: getStationInfo returns static station data
 */
async function testGetStationInfo() {
  logger.info('Testing MetadataService getStationInfo...');

  const service = new MetadataService();
  const stationInfo = service.getStationInfo();

  assert(stationInfo !== null, 'Station info returned');
  assert(stationInfo.id === 'bbc_6music', 'Station ID is correct');
  assert(stationInfo.name === 'BBC Radio 6 Music', 'Station name is correct');
  assert(stationInfo.logoUrl !== null, 'Station logo URL exists');
  assert(stationInfo.logoUrl.includes('bbc_6music'), 'Logo URL references correct station');
}

/**
 * Test: getShowAt returns show for timestamp within range
 */
async function testGetShowAt() {
  logger.info('Testing MetadataService getShowAt...');

  const service = new MetadataService();
  const now = Date.now();

  // Add test shows
  service.shows = [
    {
      start: now - 7200000, // 2 hours ago
      end: now - 3600000,   // 1 hour ago
      data: { id: 'show1', title: 'Morning Show', presenter: 'DJ One' }
    },
    {
      start: now - 3600000, // 1 hour ago
      end: now + 3600000,   // 1 hour from now
      data: { id: 'show2', title: 'Current Show', presenter: 'DJ Two' }
    }
  ];

  // Test finding current show
  const currentShow = service.getShowAt(now);
  assert(currentShow !== null, 'Found show for current time');
  assert(currentShow.id === 'show2', 'Returns correct current show');
  assert(currentShow.title === 'Current Show', 'Show title correct');

  // Test finding past show
  const pastShow = service.getShowAt(now - 5400000); // 1.5 hours ago
  assert(pastShow !== null, 'Found show for past time');
  assert(pastShow.id === 'show1', 'Returns correct past show');

  // Test no show found
  const noShow = service.getShowAt(now - 10800000); // 3 hours ago
  assert(noShow === null, 'Returns null when no show matches');
}

/**
 * Test: Show pruning removes old shows
 */
async function testShowPruning() {
  logger.info('Testing MetadataService show pruning...');

  const service = new MetadataService({
    retentionDuration: 3600000 // 1 hour for testing
  });

  const now = Date.now();

  // Add shows with various ages
  service.shows = [
    {
      start: now - 7200000,
      end: now - 3600000 - 1, // Ends just over 1 hour ago - should be pruned
      data: { id: 'old-show', title: 'Old Show' }
    },
    {
      start: now - 3600000,
      end: now,               // Ends now - should be kept
      data: { id: 'recent-show', title: 'Recent Show' }
    },
    {
      start: now,
      end: now + 3600000,     // Future show - should be kept
      data: { id: 'current-show', title: 'Current Show' }
    }
  ];

  service._pruneOldShows();

  assert(service.shows.length === 2, 'Pruned old show');
  assert(service.shows.every(s => s.data.id !== 'old-show'), 'Old show removed');
  assert(service.shows.some(s => s.data.id === 'recent-show'), 'Recent show kept');
  assert(service.shows.some(s => s.data.id === 'current-show'), 'Current show kept');
}

/**
 * Test: _processScheduleResponse processes show data
 */
async function testProcessScheduleResponse() {
  logger.info('Testing MetadataService _processScheduleResponse...');

  const service = new MetadataService();
  const now = Date.now();

  const mockResponse = {
    data: [{
      data: [
        {
          type: 'broadcast_summary',
          id: 'broadcast1',
          start: new Date(now - 3600000).toISOString(),
          end: new Date(now + 3600000).toISOString(),
          titles: {
            primary: 'Test Show',
            secondary: 'Episode 1',
            tertiary: 'Test Presenter'
          },
          synopses: {
            short: 'A great test show'
          },
          image_url: 'https://example.com/{recipe}/show.jpg',
          network: {
            logo_url: 'https://example.com/{type}_{size}.{format}'
          }
        },
        {
          type: 'other_type', // Should be ignored
          id: 'other1'
        }
      ]
    }]
  };

  service._processScheduleResponse(mockResponse);

  assert(service.shows.length === 1, 'Only broadcast_summary items stored');
  assert(service.shows[0].data.id === 'broadcast1', 'Show ID stored');
  assert(service.shows[0].data.title === 'Test Show', 'Show title extracted');
  assert(service.shows[0].data.subtitle === 'Episode 1', 'Show subtitle extracted');
  assert(service.shows[0].data.presenter === 'Test Presenter', 'Show presenter extracted');
  assert(service.shows[0].data.synopsis === 'A great test show', 'Show synopsis extracted');
  assert(service.shows[0].data.imageUrl.includes('400x400'), 'Image URL formatted');
}

/**
 * Test: Show duplicate detection
 */
async function testShowDuplicateDetection() {
  logger.info('Testing MetadataService show duplicate detection...');

  const service = new MetadataService();
  const now = Date.now();

  const mockResponse = {
    data: [{
      data: [
        {
          type: 'broadcast_summary',
          id: 'show1',
          start: new Date(now).toISOString(),
          end: new Date(now + 3600000).toISOString(),
          titles: { primary: 'Test Show' }
        }
      ]
    }]
  };

  service._processScheduleResponse(mockResponse);
  assert(service.shows.length === 1, 'First show added');

  service._processScheduleResponse(mockResponse);
  assert(service.shows.length === 1, 'Duplicate show not added');
}

/**
 * Run all tests
 */
async function runTests() {
  const tests = [
    testDefaultInitialization,
    testCustomInitialization,
    testStartStop,
    testDoubleStart,
    testGetMetadataAt,
    testGetMetadataInRange,
    testGetCurrentTrack,
    testTimePruning,
    testGetStats,
    testImageUrlFormatting,
    testSafePollErrorHandling,
    testProcessResponse,
    testDuplicateDetection,
    testGetStationInfo,
    testGetShowAt,
    testShowPruning,
    testProcessScheduleResponse,
    testShowDuplicateDetection
  ];

  let passed = 0;
  let failed = 0;

  logger.info('='.repeat(60));
  logger.info('MetadataService Tests');
  logger.info('='.repeat(60));

  for (const test of tests) {
    try {
      await test();
      passed++;
      logger.info(`PASSED: ${test.name}\n`);
    } catch (error) {
      failed++;
      logger.error(`FAILED: ${test.name}`);
      logger.error(`  Error: ${error.message}\n`);
    }
  }

  logger.info('='.repeat(60));
  logger.info(`Results: ${passed} passed, ${failed} failed`);
  logger.info('='.repeat(60));

  return failed === 0;
}

// Run if executed directly
if (require.main === module) {
  runTests()
    .then(success => process.exit(success ? 0 : 1))
    .catch(error => {
      logger.error('Test runner error:', error);
      process.exit(1);
    });
}

module.exports = { runTests };
