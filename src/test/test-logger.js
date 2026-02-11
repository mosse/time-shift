/**
 * Logger Utility Tests
 * Tests logging functionality, metrics collection, and timer operations
 */

const logger = require('../utils/logger');

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
 * Sleep helper
 */
function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Test: Basic logging methods exist
 */
function testLoggingMethodsExist() {
  console.log('Testing logging methods exist...');

  assert(typeof logger.error === 'function', 'error method exists');
  assert(typeof logger.warn === 'function', 'warn method exists');
  assert(typeof logger.info === 'function', 'info method exists');
  assert(typeof logger.debug === 'function', 'debug method exists');
  assert(typeof logger.verbose === 'function', 'verbose method exists');
}

/**
 * Test: Logging methods execute without error
 */
function testLoggingExecution() {
  console.log('Testing logging execution...');

  // These should not throw
  logger.info('Test info message');
  logger.warn('Test warning message');
  logger.debug('Test debug message');
  logger.verbose('Test verbose message');

  // Error with metadata
  logger.error('Test error message', { code: 'TEST_ERROR', details: 'test' });

  assert(true, 'All logging methods execute without error');
}

/**
 * Test: Request logging
 */
function testRequestLogging() {
  console.log('Testing request logging...');

  // Mock request and response objects
  const mockReq = {
    method: 'GET',
    url: '/api/test',
    headers: { 'user-agent': 'test-agent' },
    ip: '127.0.0.1',
    socket: { remoteAddress: '127.0.0.1' }
  };

  const mockRes = {
    statusCode: 200
  };

  // Should not throw
  logger.request(mockReq, mockRes, 50);

  assert(true, 'Request logging works');
}

/**
 * Test: Timer functionality
 */
async function testTimerFunctionality() {
  console.log('Testing timer functionality...');

  // Start a timer
  const label = logger.startTimer('test-operation');
  assert(label === 'test-operation', 'Timer returns label');

  // Wait a bit
  await sleep(50);

  // End timer
  const elapsed = logger.endTimer('test-operation');
  assert(typeof elapsed === 'number', 'Timer returns elapsed time');
  assert(elapsed >= 50, 'Elapsed time is reasonable');
}

/**
 * Test: Timer with non-existent label
 */
function testNonExistentTimer() {
  console.log('Testing non-existent timer...');

  // Should not throw, just log warning
  let threw = false;
  try {
    logger.endTimer('non-existent-timer');
  } catch (e) {
    threw = true;
  }
  assert(!threw, 'Non-existent timer does not throw');
}

/**
 * Test: Metrics collection
 */
function testMetricsCollection() {
  console.log('Testing metrics collection...');

  // Reset counters first
  logger.resetCounters();

  // Generate some log events
  logger.info('Metrics test info 1');
  logger.info('Metrics test info 2');
  logger.warn('Metrics test warning');
  logger.error('Metrics test error');

  const metrics = logger.getMetrics();

  assert(metrics !== undefined, 'Metrics object returned');
  assert(typeof metrics.uptime === 'number', 'Uptime is a number');
  assert(typeof metrics.uptimeHuman === 'string', 'Uptime human readable');
  assert(metrics.info >= 2, 'Info counter incremented');
  assert(metrics.warnings >= 1, 'Warning counter incremented');
  assert(metrics.errors >= 1, 'Error counter incremented');
}

/**
 * Test: Metrics reset
 */
function testMetricsReset() {
  console.log('Testing metrics reset...');

  // Add some counts
  logger.info('Reset test');
  logger.error('Reset test error');

  // Reset
  logger.resetCounters();

  const metrics = logger.getMetrics();

  assert(metrics.info === 0, 'Info counter reset');
  assert(metrics.errors === 0, 'Error counter reset');
  assert(metrics.warnings === 0, 'Warning counter reset');
}

/**
 * Test: Download tracking
 */
function testDownloadTracking() {
  console.log('Testing download tracking...');

  logger.resetCounters();

  // Log some downloads
  logger.downloadComplete('http://test.com/segment1.ts', 10240, 150, true);
  logger.downloadComplete('http://test.com/segment2.ts', 10240, 200, true);
  logger.downloadComplete('http://test.com/segment3.ts', 0, 500, false);

  const metrics = logger.getMetrics();

  assert(metrics.downloads >= 3, 'Downloads counter incremented');
}

/**
 * Test: Active timers tracking
 */
function testActiveTimersTracking() {
  console.log('Testing active timers tracking...');

  // Start some timers
  logger.startTimer('timer-1');
  logger.startTimer('timer-2');

  const metrics = logger.getMetrics();

  assert(Array.isArray(metrics.activeTimers), 'Active timers is array');
  assert(metrics.activeTimers.includes('timer-1'), 'Timer 1 is active');
  assert(metrics.activeTimers.includes('timer-2'), 'Timer 2 is active');

  // Clean up
  logger.endTimer('timer-1');
  logger.endTimer('timer-2');

  const metricsAfter = logger.getMetrics();
  assert(metricsAfter.activeTimers.length === 0, 'Timers cleaned up');
}

/**
 * Test: Logging with metadata
 */
function testLoggingWithMetadata() {
  console.log('Testing logging with metadata...');

  // Should not throw with various metadata types
  logger.info('With object', { key: 'value', nested: { a: 1 } });
  logger.info('With array', { items: [1, 2, 3] });
  logger.info('With null', { nullable: null });
  logger.warn('Warning with meta', { code: 'WARN_001' });

  assert(true, 'Logging with metadata works');
}

/**
 * Test: Uptime formatting
 */
function testUptimeFormatting() {
  console.log('Testing uptime formatting...');

  const metrics = logger.getMetrics();

  assert(metrics.uptimeHuman.includes('d'), 'Uptime includes days');
  assert(metrics.uptimeHuman.includes('h'), 'Uptime includes hours');
  assert(metrics.uptimeHuman.includes('m'), 'Uptime includes minutes');
  assert(metrics.uptimeHuman.includes('s'), 'Uptime includes seconds');
}

/**
 * Test: Multiple timer operations
 */
async function testMultipleTimers() {
  console.log('Testing multiple concurrent timers...');

  // Start multiple timers
  logger.startTimer('fast-op');
  logger.startTimer('slow-op');

  await sleep(50);
  const fastTime = logger.endTimer('fast-op');

  await sleep(50);
  const slowTime = logger.endTimer('slow-op');

  // Allow 10ms tolerance for timing variations
  assert(fastTime < slowTime, 'Timer durations are independent');
  assert(fastTime >= 40, 'Fast timer measured correctly');
  assert(slowTime >= 90, 'Slow timer measured correctly');
}

/**
 * Run all logger tests
 */
async function runLoggerTests() {
  console.log('=== Starting Logger Tests ===');

  try {
    testLoggingMethodsExist();
    testLoggingExecution();
    testRequestLogging();
    await testTimerFunctionality();
    testNonExistentTimer();
    testMetricsCollection();
    testMetricsReset();
    testDownloadTracking();
    testActiveTimersTracking();
    testLoggingWithMetadata();
    testUptimeFormatting();
    await testMultipleTimers();

    console.log('=== All Logger Tests Passed ===');

  } catch (error) {
    console.error(`Logger test failed: ${error.message}`);
    throw error;
  }
}

// Run tests
runLoggerTests()
  .then(() => {
    console.log('Logger tests completed successfully');
    process.exit(0);
  })
  .catch((error) => {
    console.error(`Logger tests failed: ${error.message}`);
    process.exit(1);
  });
