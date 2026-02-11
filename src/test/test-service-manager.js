/**
 * ServiceManager Tests
 * Tests service lifecycle, configuration, and coordination
 */

const logger = require('../utils/logger');
const { ServiceManager } = require('../services');

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
 * Test: ServiceManager initialization with default options
 */
async function testDefaultInitialization() {
  logger.info('Testing ServiceManager default initialization...');

  const manager = new ServiceManager();

  assert(manager.isRunning === false, 'Not running initially');
  assert(manager.servicesInitialized === false, 'Services not initialized initially');
  assert(manager.options.bufferDuration !== undefined, 'Has default buffer duration');
  assert(manager.options.monitorInterval !== undefined, 'Has default monitor interval');
}

/**
 * Test: ServiceManager initialization with custom options
 */
async function testCustomInitialization() {
  logger.info('Testing ServiceManager custom initialization...');

  const customOptions = {
    bufferDuration: 5 * 60 * 1000, // 5 minutes
    monitorInterval: 5000,
    maxRetries: 5,
    maxConcurrentDownloads: 5
  };

  const manager = new ServiceManager(customOptions);

  assert(manager.options.bufferDuration === customOptions.bufferDuration, 'Custom buffer duration applied');
  assert(manager.options.monitorInterval === customOptions.monitorInterval, 'Custom monitor interval applied');
  assert(manager.options.maxRetries === customOptions.maxRetries, 'Custom max retries applied');
  assert(manager.options.maxConcurrentDownloads === customOptions.maxConcurrentDownloads, 'Custom concurrent downloads applied');
}

/**
 * Test: Service initialization
 */
async function testServiceInitialization() {
  logger.info('Testing service initialization...');

  const manager = new ServiceManager({
    bufferDuration: 60000 // 1 minute for testing
  });

  await manager.initializeServices();

  assert(manager.servicesInitialized === true, 'Services marked as initialized');

  // Calling again should warn but not fail
  await manager.initializeServices();
  assert(manager.servicesInitialized === true, 'Double initialization handled');
}

/**
 * Test: Pipeline start and stop
 */
async function testPipelineLifecycle() {
  logger.info('Testing pipeline lifecycle...');

  const manager = new ServiceManager({
    bufferDuration: 60000,
    monitorInterval: 30000 // Long interval to avoid network calls
  });

  // Start pipeline
  const started = await manager.startPipeline({ immediate: false });
  assert(started === true, 'Pipeline starts successfully');
  assert(manager.isRunning === true, 'Manager reports running');

  // Starting again should return false
  const startedAgain = await manager.startPipeline();
  assert(startedAgain === false, 'Double start returns false');

  // Stop pipeline
  const stopped = await manager.stopPipeline();
  assert(stopped === true, 'Pipeline stops successfully');
  assert(manager.isRunning === false, 'Manager reports not running');

  // Stopping again should return false
  const stoppedAgain = await manager.stopPipeline();
  assert(stoppedAgain === false, 'Double stop returns false');
}

/**
 * Test: Pipeline status reporting
 */
async function testPipelineStatus() {
  logger.info('Testing pipeline status reporting...');

  const manager = new ServiceManager({
    bufferDuration: 60000,
    monitorInterval: 30000
  });

  await manager.initializeServices();

  const status = manager.getPipelineStatus();

  assert(status !== undefined, 'Status object returned');
  assert(status.isRunning !== undefined, 'Status has isRunning');
  assert(status.monitor !== undefined, 'Status has monitor info');
  assert(status.downloader !== undefined, 'Status has downloader info');
  assert(status.buffer !== undefined, 'Status has buffer info');
}

/**
 * Test: Service connection (event wiring)
 */
async function testServiceConnection() {
  logger.info('Testing service connection...');

  const manager = new ServiceManager({
    bufferDuration: 60000,
    monitorInterval: 30000
  });

  await manager.initializeServices();

  // Should not throw
  manager.connectServices();
  assert(true, 'Services connected without error');

  // Cleanup
  await manager.stopPipeline();
}

/**
 * Test: Connection before initialization throws
 */
async function testConnectionWithoutInit() {
  logger.info('Testing connection without initialization...');

  const manager = new ServiceManager();

  let threw = false;
  try {
    manager.connectServices();
  } catch (error) {
    threw = true;
    assert(error.message.includes('initialized'), 'Error message mentions initialization');
  }

  assert(threw, 'Throws error when connecting without initialization');
}

/**
 * Test: Graceful shutdown during active pipeline
 */
async function testGracefulShutdown() {
  logger.info('Testing graceful shutdown...');

  const manager = new ServiceManager({
    bufferDuration: 60000,
    monitorInterval: 30000
  });

  await manager.startPipeline({ immediate: false });
  assert(manager.isRunning === true, 'Pipeline is running');

  // Immediate stop
  const stopped = await manager.stopPipeline();
  assert(stopped === true, 'Graceful stop succeeded');
  assert(manager.isRunning === false, 'Pipeline stopped');
}

/**
 * Test: Multiple manager instances
 */
async function testMultipleInstances() {
  logger.info('Testing multiple manager instances...');

  const manager1 = new ServiceManager({ bufferDuration: 60000 });
  const manager2 = new ServiceManager({ bufferDuration: 120000 });

  assert(manager1.options.bufferDuration === 60000, 'Manager 1 has correct config');
  assert(manager2.options.bufferDuration === 120000, 'Manager 2 has correct config');
  assert(manager1 !== manager2, 'Managers are different instances');
}

/**
 * Test: Buffer service reference via singleton
 */
async function testBufferServiceReference() {
  logger.info('Testing buffer service reference...');

  // Import the singleton which has bufferService attached
  const { serviceManager } = require('../services');

  // The singleton should have bufferService attached
  assert(serviceManager.bufferService !== undefined, 'Buffer service accessible on singleton');
  assert(typeof serviceManager.bufferService.getBufferStats === 'function', 'Buffer service has expected methods');
}

/**
 * Test: Pipeline restart after stop
 */
async function testPipelineRestart() {
  logger.info('Testing pipeline restart...');

  const manager = new ServiceManager({
    bufferDuration: 60000,
    monitorInterval: 30000
  });

  // First start
  await manager.startPipeline({ immediate: false });
  assert(manager.isRunning === true, 'First start succeeded');

  // Stop
  await manager.stopPipeline();
  assert(manager.isRunning === false, 'Stop succeeded');

  // Second start
  const restarted = await manager.startPipeline({ immediate: false });
  assert(restarted === true, 'Restart succeeded');
  assert(manager.isRunning === true, 'Running after restart');

  // Cleanup
  await manager.stopPipeline();
}

/**
 * Run all ServiceManager tests
 */
async function runServiceManagerTests() {
  logger.info('=== Starting ServiceManager Tests ===');

  try {
    await testDefaultInitialization();
    await testCustomInitialization();
    await testServiceInitialization();
    await testPipelineLifecycle();
    await testPipelineStatus();
    await testServiceConnection();
    await testConnectionWithoutInit();
    await testGracefulShutdown();
    await testMultipleInstances();
    await testBufferServiceReference();
    await testPipelineRestart();

    logger.info('=== All ServiceManager Tests Passed ===');

  } catch (error) {
    logger.error(`ServiceManager test failed: ${error.message}`, { stack: error.stack });
    throw error;
  }
}

// Run tests
runServiceManagerTests()
  .then(() => {
    logger.info('ServiceManager tests completed successfully');
    process.exit(0);
  })
  .catch((error) => {
    logger.error(`ServiceManager tests failed: ${error.message}`);
    process.exit(1);
  });
