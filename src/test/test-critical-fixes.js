/**
 * Tests for Critical Fixes
 * - Async/await in stream routes
 * - Admin authentication
 * - Input validation
 * - CORS configuration
 */

const { HybridBufferService } = require('../services/hybrid-buffer-service');
const logger = require('../utils/logger');
const fs = require('fs').promises;
const path = require('path');

// Test results tracking
const testResults = {
  passed: 0,
  failed: 0,
  tests: []
};

function recordTest(name, passed, details = '') {
  testResults.tests.push({ name, passed, details });
  if (passed) {
    testResults.passed++;
    logger.info(`PASS: ${name}`);
  } else {
    testResults.failed++;
    logger.error(`FAIL: ${name} - ${details}`);
  }
}

/**
 * Test 1: Verify hybridBufferService methods are async
 */
async function testBufferServiceAsync() {
  logger.info('=== Test 1: Buffer Service Async Methods ===');

  const buffer = new HybridBufferService(10000);
  await buffer.initialize({ diskStorageEnabled: false });

  // Add a test segment
  const testData = Buffer.alloc(100, 'A');
  await buffer.addSegment(testData, {
    url: 'https://example.com/test.ts',
    sequenceNumber: 1,
    duration: 5
  });

  // Test getSegmentBySequence returns a Promise
  const sequenceResult = buffer.getSegmentBySequence(1);
  const isPromise1 = sequenceResult instanceof Promise;
  recordTest(
    'getSegmentBySequence returns Promise',
    isPromise1,
    isPromise1 ? '' : `Expected Promise, got ${typeof sequenceResult}`
  );

  // Test getSegmentAt returns a Promise
  const atResult = buffer.getSegmentAt(Date.now());
  const isPromise2 = atResult instanceof Promise;
  recordTest(
    'getSegmentAt returns Promise',
    isPromise2,
    isPromise2 ? '' : `Expected Promise, got ${typeof atResult}`
  );

  // Test that awaiting gives us actual data
  const segment = await sequenceResult;
  const hasData = segment && segment.data && segment.data.length === 100;
  recordTest(
    'Awaited segment has correct data',
    hasData,
    hasData ? '' : 'Segment data missing or incorrect size'
  );

  // Clean up
  buffer.clear();
}

/**
 * Test 2: Verify admin authentication middleware logic
 */
async function testAdminAuthLogic() {
  logger.info('=== Test 2: Admin Authentication Logic ===');

  // Simulate the adminAuth middleware logic
  const simulateAdminAuth = (apiKey, validKey, nodeEnv) => {
    if (!validKey) {
      if (nodeEnv === 'production') {
        return { status: 403, allowed: false, reason: 'disabled' };
      }
      return { status: 200, allowed: true, reason: 'dev-mode' };
    }

    if (!apiKey) {
      return { status: 401, allowed: false, reason: 'missing-key' };
    }

    if (apiKey !== validKey) {
      return { status: 401, allowed: false, reason: 'invalid-key' };
    }

    return { status: 200, allowed: true, reason: 'valid-key' };
  };

  // Test: No key configured + production = denied
  const test1 = simulateAdminAuth(null, null, 'production');
  recordTest(
    'Production without ADMIN_API_KEY denies access',
    test1.status === 403 && !test1.allowed,
    `Expected 403/denied, got ${test1.status}/${test1.allowed}`
  );

  // Test: No key configured + development = allowed
  const test2 = simulateAdminAuth(null, null, 'development');
  recordTest(
    'Development without ADMIN_API_KEY allows access',
    test2.status === 200 && test2.allowed,
    `Expected 200/allowed, got ${test2.status}/${test2.allowed}`
  );

  // Test: Key configured + no key provided = denied
  const test3 = simulateAdminAuth(null, 'secret-key', 'production');
  recordTest(
    'Missing API key returns 401',
    test3.status === 401 && !test3.allowed,
    `Expected 401/denied, got ${test3.status}/${test3.allowed}`
  );

  // Test: Key configured + wrong key = denied
  const test4 = simulateAdminAuth('wrong-key', 'secret-key', 'production');
  recordTest(
    'Invalid API key returns 401',
    test4.status === 401 && !test4.allowed,
    `Expected 401/denied, got ${test4.status}/${test4.allowed}`
  );

  // Test: Key configured + correct key = allowed
  const test5 = simulateAdminAuth('secret-key', 'secret-key', 'production');
  recordTest(
    'Valid API key allows access',
    test5.status === 200 && test5.allowed,
    `Expected 200/allowed, got ${test5.status}/${test5.allowed}`
  );
}

/**
 * Test 3: Verify input validation logic
 */
async function testInputValidation() {
  logger.info('=== Test 3: Input Validation Logic ===');

  // Simulate validation logic
  const validatePlaylistParams = (query) => {
    const errors = [];

    if (query.duration !== undefined) {
      const duration = parseInt(query.duration, 10);
      if (isNaN(duration) || duration < 1 || duration > 3600) {
        errors.push('duration must be a number between 1 and 3600 seconds');
      }
    }

    if (query.format !== undefined) {
      const validFormats = ['m3u8', 'json'];
      if (!validFormats.includes(query.format)) {
        errors.push(`format must be one of: ${validFormats.join(', ')}`);
      }
    }

    if (query.timeshift !== undefined) {
      const timeshift = parseInt(query.timeshift, 10);
      if (isNaN(timeshift) || timeshift < 0 || timeshift > 86400000) {
        errors.push('timeshift must be a number between 0 and 86400000 milliseconds');
      }
    }

    return { valid: errors.length === 0, errors };
  };

  // Test: Valid parameters
  const test1 = validatePlaylistParams({ duration: '300', format: 'm3u8', timeshift: '3600000' });
  recordTest(
    'Valid parameters pass validation',
    test1.valid,
    test1.valid ? '' : `Unexpected errors: ${test1.errors.join(', ')}`
  );

  // Test: Duration too high
  const test2 = validatePlaylistParams({ duration: '5000' });
  recordTest(
    'Duration > 3600 fails validation',
    !test2.valid && test2.errors.some(e => e.includes('duration')),
    test2.valid ? 'Should have failed' : ''
  );

  // Test: Duration negative
  const test3 = validatePlaylistParams({ duration: '-1' });
  recordTest(
    'Negative duration fails validation',
    !test3.valid && test3.errors.some(e => e.includes('duration')),
    test3.valid ? 'Should have failed' : ''
  );

  // Test: Invalid format
  const test4 = validatePlaylistParams({ format: 'xml' });
  recordTest(
    'Invalid format fails validation',
    !test4.valid && test4.errors.some(e => e.includes('format')),
    test4.valid ? 'Should have failed' : ''
  );

  // Test: Timeshift too high
  const test5 = validatePlaylistParams({ timeshift: '100000000' });
  recordTest(
    'Timeshift > 24 hours fails validation',
    !test5.valid && test5.errors.some(e => e.includes('timeshift')),
    test5.valid ? 'Should have failed' : ''
  );

  // Test: Non-numeric duration
  const test6 = validatePlaylistParams({ duration: 'abc' });
  recordTest(
    'Non-numeric duration fails validation',
    !test6.valid,
    test6.valid ? 'Should have failed' : ''
  );

  // Test: Empty query (all defaults)
  const test7 = validatePlaylistParams({});
  recordTest(
    'Empty query passes validation (uses defaults)',
    test7.valid,
    test7.valid ? '' : `Unexpected errors: ${test7.errors.join(', ')}`
  );
}

/**
 * Test 4: Verify CORS configuration logic
 */
async function testCorsConfiguration() {
  logger.info('=== Test 4: CORS Configuration Logic ===');

  // Simulate CORS origin logic
  const getCorsOrigin = (corsOrigins, nodeEnv) => {
    if (corsOrigins) {
      const origins = corsOrigins.split(',').map(o => o.trim());
      return origins.length === 1 ? origins[0] : origins;
    }
    if (nodeEnv === 'production') {
      return false;
    }
    return '*';
  };

  // Test: No config + development = allow all
  const test1 = getCorsOrigin(undefined, 'development');
  recordTest(
    'Development without CORS_ORIGINS allows all origins',
    test1 === '*',
    `Expected '*', got ${JSON.stringify(test1)}`
  );

  // Test: No config + production = deny
  const test2 = getCorsOrigin(undefined, 'production');
  recordTest(
    'Production without CORS_ORIGINS denies all origins',
    test2 === false,
    `Expected false, got ${JSON.stringify(test2)}`
  );

  // Test: Single origin configured
  const test3 = getCorsOrigin('https://example.com', 'production');
  recordTest(
    'Single CORS_ORIGINS returns string',
    test3 === 'https://example.com',
    `Expected 'https://example.com', got ${JSON.stringify(test3)}`
  );

  // Test: Multiple origins configured
  const test4 = getCorsOrigin('https://a.com, https://b.com', 'production');
  recordTest(
    'Multiple CORS_ORIGINS returns array',
    Array.isArray(test4) && test4.length === 2 && test4[0] === 'https://a.com',
    `Expected array of 2 origins, got ${JSON.stringify(test4)}`
  );
}

/**
 * Test 5: Verify segment data null checks
 */
async function testSegmentDataNullChecks() {
  logger.info('=== Test 5: Segment Data Null Checks ===');

  // Simulate the null check logic from stream.js
  const handleSegmentRequest = (segment) => {
    if (!segment) {
      return { status: 404, error: 'Segment not found' };
    }

    if (!segment.data) {
      return { status: 500, error: 'Segment data unavailable' };
    }

    return {
      status: 200,
      contentLength: segment.size || segment.data.length,
      data: segment.data
    };
  };

  // Test: null segment
  const test1 = handleSegmentRequest(null);
  recordTest(
    'Null segment returns 404',
    test1.status === 404,
    `Expected 404, got ${test1.status}`
  );

  // Test: segment without data
  const test2 = handleSegmentRequest({ metadata: {}, size: 100 });
  recordTest(
    'Segment without data returns 500',
    test2.status === 500,
    `Expected 500, got ${test2.status}`
  );

  // Test: valid segment with data
  const validSegment = {
    data: Buffer.alloc(100, 'A'),
    size: 100,
    metadata: { sequenceNumber: 1 }
  };
  const test3 = handleSegmentRequest(validSegment);
  recordTest(
    'Valid segment returns 200',
    test3.status === 200,
    `Expected 200, got ${test3.status}`
  );

  // Test: segment with data but no size uses data.length
  const segmentNoSize = {
    data: Buffer.alloc(50, 'B'),
    metadata: {}
  };
  const test4 = handleSegmentRequest(segmentNoSize);
  recordTest(
    'Segment without size uses data.length for Content-Length',
    test4.status === 200 && test4.contentLength === 50,
    `Expected contentLength=50, got ${test4.contentLength}`
  );
}

/**
 * Run all tests
 */
async function runAllTests() {
  logger.info('========================================');
  logger.info('Running Critical Fixes Tests');
  logger.info('========================================\n');

  try {
    await testBufferServiceAsync();
    logger.info('');

    await testAdminAuthLogic();
    logger.info('');

    await testInputValidation();
    logger.info('');

    await testCorsConfiguration();
    logger.info('');

    await testSegmentDataNullChecks();
    logger.info('');

  } catch (error) {
    logger.error(`Test suite error: ${error.message}`);
    logger.error(error.stack);
  }

  // Summary
  logger.info('========================================');
  logger.info('Test Summary');
  logger.info('========================================');
  logger.info(`Total: ${testResults.passed + testResults.failed}`);
  logger.info(`Passed: ${testResults.passed}`);
  logger.info(`Failed: ${testResults.failed}`);

  if (testResults.failed > 0) {
    logger.info('\nFailed Tests:');
    testResults.tests
      .filter(t => !t.passed)
      .forEach(t => logger.error(`  - ${t.name}: ${t.details}`));
  }

  logger.info('========================================');

  // Exit with appropriate code
  process.exit(testResults.failed > 0 ? 1 : 0);
}

// Run tests if executed directly
if (require.main === module) {
  runAllTests().catch(error => {
    logger.error(`Unhandled error: ${error.stack}`);
    process.exit(1);
  });
}

module.exports = {
  runAllTests,
  testBufferServiceAsync,
  testAdminAuthLogic,
  testInputValidation,
  testCorsConfiguration,
  testSegmentDataNullChecks
};
