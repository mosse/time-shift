/**
 * Route/API Endpoint Tests
 * Tests all HTTP endpoints for correct responses, status codes, and headers
 */

const http = require('http');
const app = require('../app');
const logger = require('../utils/logger');
const { serviceManager } = require('../services');
const { hybridBufferService } = require('../services/hybrid-buffer-service');

const TEST_PORT = 3099;
let server;

/**
 * Make HTTP request and return response
 */
function makeRequest(options) {
  return new Promise((resolve, reject) => {
    const req = http.request({ port: TEST_PORT, ...options }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          const json = data ? JSON.parse(data) : null;
          resolve({ status: res.statusCode, headers: res.headers, body: json, raw: data });
        } catch {
          resolve({ status: res.statusCode, headers: res.headers, body: null, raw: data });
        }
      });
    });
    req.on('error', reject);
    if (options.body) req.write(options.body);
    req.end();
  });
}

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
 * Test: Root endpoint serves HTML
 */
async function testRootEndpoint() {
  logger.info('Testing GET / endpoint...');

  const res = await makeRequest({ path: '/', method: 'GET' });

  assert(res.status === 200, 'Root endpoint returns 200');
  assert(res.raw.includes('<!DOCTYPE html>'), 'Root serves HTML page');
  assert(res.raw.includes('encore.fm'), 'HTML includes app name');
}

/**
 * Test: Health endpoint
 */
async function testHealthEndpoint() {
  logger.info('Testing GET /health endpoint...');

  const res = await makeRequest({ path: '/health', method: 'GET' });

  assert(res.status === 200 || res.status === 503, 'Health returns 200 or 503');
  assert(res.body !== null, 'Health response is JSON');
  assert(res.body.status !== undefined, 'Health response has status field');
  assert(res.body.timestamp !== undefined, 'Health response has timestamp');
  assert(res.body.services !== undefined, 'Health response has services object');
}

/**
 * Test: Stats endpoint
 */
async function testStatsEndpoint() {
  logger.info('Testing GET /stats endpoint...');

  const res = await makeRequest({ path: '/stats', method: 'GET' });

  assert(res.status === 200, 'Stats returns 200');
  assert(res.body.status === 'ok', 'Stats response status is ok');
  assert(res.body.buffer !== undefined, 'Stats has buffer info');
  assert(res.body.buffer.segmentCount !== undefined, 'Buffer has segment count');
}

/**
 * Test: API status endpoint
 */
async function testApiStatusEndpoint() {
  logger.info('Testing GET /api/status endpoint...');

  const res = await makeRequest({ path: '/api/status', method: 'GET' });

  assert(res.status === 200, 'API status returns 200');
  assert(res.body.timestamp !== undefined, 'Status has timestamp');
  assert(res.body.bufferReady !== undefined, 'Status has bufferReady');
  assert(res.body.pipeline !== undefined, 'Status has pipeline info');
  assert(res.body.logs !== undefined, 'Status has logs info');
}

/**
 * Test: API segments endpoint
 */
async function testApiSegmentsEndpoint() {
  logger.info('Testing GET /api/segments endpoint...');

  const res = await makeRequest({ path: '/api/segments', method: 'GET' });

  assert(res.status === 200, 'API segments returns 200');
  assert(res.body.timestamp !== undefined, 'Segments has timestamp');
  assert(res.body.count !== undefined, 'Segments has count');
  assert(res.body.duration !== undefined, 'Segments has duration');
}

/**
 * Test: API playlist endpoint with format parameter
 */
async function testApiPlaylistEndpoint() {
  logger.info('Testing GET /api/playlist endpoint...');

  // Test JSON format
  const jsonRes = await makeRequest({ path: '/api/playlist?format=json', method: 'GET' });
  assert(jsonRes.status === 200, 'Playlist JSON returns 200');
  assert(jsonRes.headers['cache-control'].includes('no-cache'), 'Playlist has no-cache header');

  // Test m3u8 format
  const m3u8Res = await makeRequest({ path: '/api/playlist?format=m3u8', method: 'GET' });
  assert(m3u8Res.status === 200, 'Playlist m3u8 returns 200');
  assert(m3u8Res.headers['content-type'].includes('mpegurl'), 'Playlist has correct content-type');
  assert(m3u8Res.raw.includes('#EXTM3U'), 'Playlist starts with #EXTM3U');

  // Test with timeshift override
  const timeshiftRes = await makeRequest({ path: '/api/playlist?format=json&timeshift=0', method: 'GET' });
  assert(timeshiftRes.status === 200, 'Playlist with timeshift returns 200');
}

/**
 * Test: API restart endpoint requires POST
 */
async function testApiRestartEndpoint() {
  logger.info('Testing /api/restart endpoint...');

  // GET should fail (method not allowed - 404 since no GET route)
  const getRes = await makeRequest({ path: '/api/restart', method: 'GET' });
  assert(getRes.status === 404, 'Restart GET returns 404');

  // POST without API key should work (when no key configured)
  const postRes = await makeRequest({
    path: '/api/restart',
    method: 'POST',
    headers: { 'Content-Type': 'application/json' }
  });
  assert(postRes.status === 200 || postRes.status === 401 || postRes.status === 500,
    'Restart POST returns expected status');
}

/**
 * Test: 404 for unknown routes
 */
async function testNotFoundHandler() {
  logger.info('Testing 404 handler...');

  const res = await makeRequest({ path: '/nonexistent/route', method: 'GET' });

  assert(res.status === 404, '404 for unknown route');
  assert(res.body.status === 'error', '404 response has error status');
  assert(res.body.statusCode === 404, '404 response has correct statusCode');
}

/**
 * Test: Stream playlist endpoint
 */
async function testStreamPlaylistEndpoint() {
  logger.info('Testing GET /stream.m3u8 endpoint...');

  const res = await makeRequest({ path: '/stream.m3u8', method: 'GET' });

  assert(res.status === 200, 'Stream playlist returns 200');
  assert(res.headers['content-type'].includes('mpegurl'), 'Has correct content-type');
  assert(res.raw.includes('#EXTM3U'), 'Response is valid m3u8');
}

/**
 * Test: Security headers are present on API routes
 */
async function testSecurityHeaders() {
  logger.info('Testing security headers...');

  // Test on API route, not static file
  const res = await makeRequest({ path: '/health', method: 'GET' });

  assert(res.headers['x-content-type-options'] === 'nosniff', 'X-Content-Type-Options header present');
  assert(res.headers['x-xss-protection'] === '1; mode=block', 'X-XSS-Protection header present');
  assert(res.headers['x-frame-options'] === 'DENY', 'X-Frame-Options header present');
}

/**
 * Test: CORS headers
 */
async function testCorsHeaders() {
  logger.info('Testing CORS headers...');

  const res = await makeRequest({
    path: '/',
    method: 'OPTIONS',
    headers: { 'Origin': 'http://example.com' }
  });

  assert(res.headers['access-control-allow-origin'] !== undefined, 'CORS origin header present');
}

/**
 * Run all route tests
 */
async function runRouteTests() {
  logger.info('=== Starting Route Tests ===');

  try {
    // Initialize services for tests
    await serviceManager.initializeServices();

    // Start test server
    server = app.listen(TEST_PORT);
    logger.info(`Test server started on port ${TEST_PORT}`);

    // Wait for server to be ready
    await new Promise(resolve => setTimeout(resolve, 500));

    // Run tests
    await testRootEndpoint();
    await testHealthEndpoint();
    await testStatsEndpoint();
    await testApiStatusEndpoint();
    await testApiSegmentsEndpoint();
    await testApiPlaylistEndpoint();
    await testApiRestartEndpoint();
    await testNotFoundHandler();
    await testStreamPlaylistEndpoint();
    await testSecurityHeaders();
    await testCorsHeaders();

    logger.info('=== All Route Tests Passed ===');

  } catch (error) {
    logger.error(`Route test failed: ${error.message}`);
    throw error;
  } finally {
    if (server) {
      server.close();
      logger.info('Test server closed');
    }
  }
}

// Run tests
runRouteTests()
  .then(() => {
    logger.info('Route tests completed successfully');
    process.exit(0);
  })
  .catch((error) => {
    logger.error(`Route tests failed: ${error.message}`);
    process.exit(1);
  });
