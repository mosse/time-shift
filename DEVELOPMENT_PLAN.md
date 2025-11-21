# Time-Shift Radio Stream - Development Plan

## Executive Summary

This document outlines a phased improvement plan for the Time-Shift Radio Stream application. The plan addresses critical bugs, security vulnerabilities, reliability improvements, and long-term maintenance goals.

---

## Phase 1: Critical Fixes (Priority: IMMEDIATE)

**Timeline: Days 1-2**

### 1.1 Fix Async/Await Mismatch in Stream Routes

**Files:** `src/routes/stream.js`
**Impact:** CRITICAL - Core streaming functionality is broken

**Problem:**
Route handlers call async methods from `hybridBufferService` synchronously, receiving Promises instead of actual segment data.

**Affected Code:**
- Line 62: `getSegmentBySequence()` called without await
- Line 143: `getSegmentAt()` called without await
- Line 169: `getSegmentBySequence()` in fallback loop called without await

**Solution:**
Convert route handlers to async functions and add `await` to all buffer service calls.

```javascript
// Before (BROKEN):
router.get('/stream/segment/:sequenceNumber.ts', (req, res) => {
  const segment = hybridBufferService.getSegmentBySequence(sequenceNumber);
  // segment is a Promise, not actual data!
});

// After (FIXED):
router.get('/stream/segment/:sequenceNumber.ts', async (req, res) => {
  const segment = await hybridBufferService.getSegmentBySequence(sequenceNumber);
  // segment now contains actual data
});
```

**Testing:**
- Unit test for each route endpoint
- Integration test for segment delivery
- Manual test with HLS player

---

### 1.2 Fix Security Vulnerabilities in Dependencies

**Impact:** HIGH - Known CVEs in production dependencies

**Problem:**
```
CRITICAL: form-data (GHSA-fjxv-7rqg-78g4) - unsafe random function
HIGH:     axios (GHSA-4hjh-wcwx-xvwj) - DoS vulnerability
HIGH:     on-headers (GHSA-76c9-3jph-rj3q) - HTTP header manipulation
```

**Solution:**
```bash
npm audit fix
npm update axios
```

**Testing:**
- Run `npm audit` to verify all issues resolved
- Run existing test suite to ensure no regressions

---

### 1.3 Add Authentication to Admin Endpoints

**File:** `src/routes/api.js`
**Impact:** HIGH - Unprotected administrative operations

**Problem:**
The `/api/restart` endpoint allows unauthenticated users to restart the streaming pipeline.

**Solution:**
Implement API key authentication for admin endpoints:

```javascript
// Middleware for admin authentication
const adminAuth = (req, res, next) => {
  const apiKey = req.headers['x-api-key'] || req.query.apiKey;
  const validKey = process.env.ADMIN_API_KEY;

  if (!validKey) {
    // If no key configured, deny all admin access in production
    if (process.env.NODE_ENV === 'production') {
      return res.status(403).json({ error: 'Admin access disabled' });
    }
    return next(); // Allow in development
  }

  if (apiKey !== validKey) {
    return res.status(401).json({ error: 'Invalid API key' });
  }

  next();
};
```

**Testing:**
- Test with valid API key
- Test with invalid API key
- Test with no API key
- Test in production vs development modes

---

### 1.4 Restrict CORS Configuration

**File:** `src/app.js`
**Impact:** HIGH - API exposed to all origins

**Problem:**
CORS is configured with `origin: '*'`, allowing any website to access the API.

**Solution:**
Make CORS configurable via environment variables:

```javascript
const corsOptions = {
  origin: process.env.CORS_ORIGINS
    ? process.env.CORS_ORIGINS.split(',')
    : (process.env.NODE_ENV === 'production' ? false : '*'),
  methods: ['GET', 'POST', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Range', 'Authorization', 'X-API-Key'],
  exposedHeaders: ['Content-Length', 'Content-Range', 'Accept-Ranges'],
  maxAge: 600
};
```

**Testing:**
- Test with allowed origin
- Test with disallowed origin
- Test preflight requests

---

### 1.5 Add Input Validation

**File:** `src/routes/api.js`
**Impact:** MEDIUM - Potential for injection/DoS

**Problem:**
Query parameters (`duration`, `timeshift`, `format`) are not validated.

**Solution:**
Add validation middleware:

```javascript
const validatePlaylistParams = (req, res, next) => {
  const duration = parseInt(req.query.duration);
  const timeshift = req.query.timeshift !== undefined
    ? parseInt(req.query.timeshift) : undefined;
  const format = req.query.format || 'm3u8';

  // Validate duration
  if (req.query.duration !== undefined) {
    if (isNaN(duration) || duration < 1 || duration > 3600) {
      return res.status(400).json({
        error: 'Invalid duration: must be between 1 and 3600 seconds'
      });
    }
  }

  // Validate format
  if (!['m3u8', 'json'].includes(format)) {
    return res.status(400).json({
      error: 'Invalid format: must be m3u8 or json'
    });
  }

  // Store validated params
  req.validatedParams = { duration, timeshift, format };
  next();
};
```

**Testing:**
- Test with valid parameters
- Test with invalid parameters (negative, too large, wrong type)
- Test boundary conditions

---

## Phase 2: Security Hardening (Priority: HIGH)

**Timeline: Days 3-5**

### 2.1 Add Rate Limiting

**Impact:** MEDIUM - API vulnerable to DoS

**Solution:**
```bash
npm install express-rate-limit
```

```javascript
const rateLimit = require('express-rate-limit');

// General rate limiter
const generalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 1000, // limit each IP to 1000 requests per window
  message: { error: 'Too many requests, please try again later' }
});

// Strict limiter for admin endpoints
const adminLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 10, // limit each IP to 10 admin requests per hour
  message: { error: 'Too many admin requests' }
});

app.use('/api/', generalLimiter);
app.use('/api/restart', adminLimiter);
```

### 2.2 Remove Stack Trace Exposure

**File:** `src/app.js`
**Current:** Stack traces exposed when `NODE_ENV !== 'production'`
**Solution:** Never expose stack traces to clients; log internally only

### 2.3 Add Request Validation Middleware

**Solution:**
```bash
npm install express-validator
```

Use express-validator for comprehensive input validation.

### 2.4 Add Security Headers

**Solution:**
```bash
npm install helmet
```

Replace manual security headers with Helmet middleware.

---

## Phase 3: Reliability Improvements (Priority: MEDIUM)

**Timeline: Week 2**

### 3.1 Fix Race Condition in Metadata Persistence

**File:** `src/services/hybrid-buffer-service.js`

**Problem:**
`_saveMetadataToDisk()` is called without `await`, potentially causing write interleaving.

**Solution:**
Add await and implement a write queue:

```javascript
async addSegment(segmentData, metadata) {
  // ... existing code ...
  await this._saveMetadataToDisk(); // Add await
  // ...
}
```

### 3.2 Add Resource Limits

**Problem:** No maximum buffer size limit

**Solution:**
```javascript
const MAX_BUFFER_SIZE = process.env.MAX_BUFFER_SIZE_MB
  ? parseInt(process.env.MAX_BUFFER_SIZE_MB) * 1024 * 1024
  : 10 * 1024 * 1024 * 1024; // 10GB default

async addSegment(segmentData, metadata) {
  // Check size limit before adding
  if (this.totalSize + segmentData.length > MAX_BUFFER_SIZE) {
    await this._pruneOldSegments(segmentData.length);
  }
  // ... rest of method
}
```

### 3.3 Add Disk Space Monitoring

```javascript
const checkDiskSpace = require('check-disk-space');

async _checkDiskSpace() {
  const space = await checkDiskSpace(config.STORAGE.BASE_DIR);
  if (space.free < MIN_FREE_SPACE) {
    logger.warn('Low disk space, triggering cleanup');
    await this._pruneOldSegments();
  }
}
```

### 3.4 Implement Automatic Service Recovery

Add health monitoring that restarts failed services automatically.

---

## Phase 4: Testing Improvements (Priority: MEDIUM)

**Timeline: Week 2-3**

### 4.1 Add Route Handler Tests

Create tests for all Express endpoints:
- `test/routes/stream.test.js`
- `test/routes/api.test.js`

### 4.2 Add Error Condition Tests

Test scenarios:
- Network failures
- Disk full
- Invalid segment data
- Concurrent access
- Buffer overflow

### 4.3 Add Integration Tests

- End-to-end segment delivery test
- Time-shift accuracy test
- Recovery after restart test

### 4.4 Add Load/Performance Tests

```bash
npm install artillery
```

Create load test scenarios:
- Sustained playlist requests
- Concurrent segment downloads
- Mixed workload

---

## Phase 5: Observability (Priority: MEDIUM)

**Timeline: Week 3**

### 5.1 Add Prometheus Metrics

```bash
npm install prom-client
```

Expose metrics:
- `buffer_segments_total`
- `buffer_size_bytes`
- `segment_download_duration_seconds`
- `request_duration_seconds`
- `errors_total`

### 5.2 Create Health Check Dashboard

Add `/api/dashboard` endpoint with:
- Real-time buffer status
- Download statistics
- Error rates
- System resource usage

### 5.3 Implement Alerting

Add configurable alerts for:
- Low buffer levels
- High error rates
- Disk space warnings
- Service unavailability

---

## Phase 6: Developer Experience (Priority: LOW)

**Timeline: Week 4**

### 6.1 API Documentation

Generate OpenAPI/Swagger documentation:
```bash
npm install swagger-jsdoc swagger-ui-express
```

### 6.2 Docker Support

Create `Dockerfile` and `docker-compose.yml`:

```dockerfile
FROM node:18-alpine
WORKDIR /app
COPY package*.json ./
RUN npm ci --only=production
COPY . .
EXPOSE 3000
CMD ["npm", "start"]
```

### 6.3 Environment Configuration

Create `.env.example`:
```env
# Server
PORT=3000
NODE_ENV=development

# Security
ADMIN_API_KEY=your-secret-key
CORS_ORIGINS=http://localhost:3000

# Storage
STORAGE_DIR=./data
MAX_BUFFER_SIZE_MB=10240

# Logging
LOG_LEVEL=info
```

### 6.4 Documentation

- Architecture diagram
- Troubleshooting guide
- Performance tuning guide
- Contributing guidelines

---

## Implementation Checklist

### Phase 1 (Critical)
- [ ] Fix async/await in stream.js routes
- [ ] Run npm audit fix
- [ ] Add admin authentication
- [ ] Restrict CORS configuration
- [ ] Add input validation
- [ ] Write tests for critical fixes
- [ ] Deploy and verify

### Phase 2 (Security)
- [ ] Add rate limiting
- [ ] Remove stack trace exposure
- [ ] Add comprehensive input validation
- [ ] Add Helmet security headers

### Phase 3 (Reliability)
- [ ] Fix metadata race condition
- [ ] Add resource limits
- [ ] Add disk space monitoring
- [ ] Implement service recovery

### Phase 4 (Testing)
- [ ] Add route handler tests
- [ ] Add error condition tests
- [ ] Add integration tests
- [ ] Add load tests

### Phase 5 (Observability)
- [ ] Add Prometheus metrics
- [ ] Create health dashboard
- [ ] Implement alerting

### Phase 6 (DevEx)
- [ ] Generate API documentation
- [ ] Add Docker support
- [ ] Create .env.example
- [ ] Write documentation

---

## Risk Assessment

| Issue | Severity | Likelihood | Impact | Mitigation |
|-------|----------|------------|--------|------------|
| Async/await bug | Critical | Confirmed | App doesn't work | Phase 1 fix |
| Dependency CVEs | High | Confirmed | Security breach | npm audit fix |
| Unprotected admin | High | High | Service disruption | Add auth |
| CORS misconfiguration | High | Medium | Data exfiltration | Restrict origins |
| No rate limiting | Medium | Medium | DoS attack | Add rate limiter |
| Race conditions | Medium | Low | Data corruption | Add locking |

---

## Success Metrics

After completing Phase 1:
- All existing tests pass
- Segment delivery works correctly
- No critical security vulnerabilities
- Admin endpoints protected

After completing all phases:
- 90%+ test coverage
- < 100ms average response time
- Zero critical/high security issues
- 99.9% uptime target

---

*Document Version: 1.0*
*Created: 2024*
*Last Updated: 2024*
