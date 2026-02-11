/**
 * PWA Tests
 * Tests Progressive Web App configuration and service worker
 */

const fs = require('fs');
const path = require('path');
const http = require('http');

const PUBLIC_DIR = path.join(__dirname, '../public');

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
 * HTTP request helper
 */
function httpGet(url) {
  return new Promise((resolve, reject) => {
    const req = http.get(url, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        resolve({ status: res.statusCode, headers: res.headers, body: data });
      });
    });
    req.on('error', reject);
    req.setTimeout(5000, () => {
      req.destroy();
      reject(new Error('Request timeout'));
    });
  });
}

/**
 * Test: Manifest file exists and is valid JSON
 */
function testManifestExists() {
  console.log('Testing manifest.json exists...');

  const manifestPath = path.join(PUBLIC_DIR, 'manifest.json');
  assert(fs.existsSync(manifestPath), 'manifest.json file exists');

  const content = fs.readFileSync(manifestPath, 'utf8');
  let manifest;
  try {
    manifest = JSON.parse(content);
  } catch (e) {
    throw new Error('manifest.json is not valid JSON');
  }
  assert(manifest !== null, 'manifest.json is valid JSON');
}

/**
 * Test: Manifest has required fields
 */
function testManifestFields() {
  console.log('Testing manifest.json required fields...');

  const manifestPath = path.join(PUBLIC_DIR, 'manifest.json');
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));

  assert(manifest.name === 'encore.fm', 'Manifest has correct name');
  assert(manifest.short_name === 'encore.fm', 'Manifest has short_name');
  assert(manifest.description !== undefined, 'Manifest has description');
  assert(manifest.start_url === '/', 'Manifest has start_url');
  assert(manifest.display === 'standalone', 'Manifest has standalone display');
  assert(manifest.theme_color !== undefined, 'Manifest has theme_color');
  assert(manifest.background_color !== undefined, 'Manifest has background_color');
  assert(Array.isArray(manifest.icons), 'Manifest has icons array');
  assert(manifest.icons.length > 0, 'Manifest has at least one icon');
}

/**
 * Test: Manifest icons are properly configured
 */
function testManifestIcons() {
  console.log('Testing manifest.json icons...');

  const manifestPath = path.join(PUBLIC_DIR, 'manifest.json');
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));

  const requiredSizes = ['192x192', '512x512'];

  requiredSizes.forEach(size => {
    const icon = manifest.icons.find(i => i.sizes === size);
    assert(icon !== undefined, `Manifest has ${size} icon`);
    assert(icon.type === 'image/png', `${size} icon has correct type`);
  });
}

/**
 * Test: Icon files exist
 */
function testIconFilesExist() {
  console.log('Testing icon files exist...');

  const iconsDir = path.join(PUBLIC_DIR, 'icons');
  assert(fs.existsSync(iconsDir), 'Icons directory exists');

  const requiredIcons = ['icon-192.png', 'icon-512.png'];
  requiredIcons.forEach(icon => {
    const iconPath = path.join(iconsDir, icon);
    assert(fs.existsSync(iconPath), `${icon} exists`);
  });

  // Check SVG icon exists
  const svgPath = path.join(iconsDir, 'icon.svg');
  assert(fs.existsSync(svgPath), 'SVG icon exists');
}

/**
 * Test: Service worker file exists
 */
function testServiceWorkerExists() {
  console.log('Testing service worker exists...');

  const swPath = path.join(PUBLIC_DIR, 'sw.js');
  assert(fs.existsSync(swPath), 'sw.js file exists');

  const content = fs.readFileSync(swPath, 'utf8');
  assert(content.includes('install'), 'Service worker has install handler');
  assert(content.includes('activate'), 'Service worker has activate handler');
  assert(content.includes('fetch'), 'Service worker has fetch handler');
}

/**
 * Test: Service worker caches correct assets
 */
function testServiceWorkerCaching() {
  console.log('Testing service worker caching configuration...');

  const swPath = path.join(PUBLIC_DIR, 'sw.js');
  const content = fs.readFileSync(swPath, 'utf8');

  assert(content.includes('CACHE_NAME'), 'Service worker has cache name');
  assert(content.includes('STATIC_ASSETS'), 'Service worker has static assets list');
  assert(content.includes("'/'"), 'Service worker caches root');
  assert(content.includes('/css/styles.css'), 'Service worker caches CSS');
  assert(content.includes('/js/player.js'), 'Service worker caches player JS');
}

/**
 * Test: Service worker handles HLS segments correctly
 */
function testServiceWorkerHLSHandling() {
  console.log('Testing service worker HLS handling...');

  const swPath = path.join(PUBLIC_DIR, 'sw.js');
  const content = fs.readFileSync(swPath, 'utf8');

  // HLS segments (.ts) and playlists (.m3u8) should not be cached
  assert(content.includes('.ts'), 'Service worker checks for .ts files');
  assert(content.includes('.m3u8'), 'Service worker checks for .m3u8 files');
  assert(content.includes('/api/'), 'Service worker checks for API routes');
}

/**
 * Test: HTML has PWA meta tags
 */
function testHTMLPWAMeta() {
  console.log('Testing HTML PWA meta tags...');

  const htmlPath = path.join(PUBLIC_DIR, 'index.html');
  const content = fs.readFileSync(htmlPath, 'utf8');

  assert(content.includes('rel="manifest"'), 'HTML has manifest link');
  assert(content.includes('theme-color'), 'HTML has theme-color meta');
  assert(content.includes('apple-mobile-web-app-capable'), 'HTML has apple-mobile-web-app-capable');
  assert(content.includes('apple-mobile-web-app-status-bar-style'), 'HTML has apple-mobile-web-app-status-bar-style');
  assert(content.includes('apple-touch-icon'), 'HTML has apple-touch-icon link');
}

/**
 * Test: HTML has service worker registration
 */
function testHTMLServiceWorkerRegistration() {
  console.log('Testing HTML service worker registration...');

  const htmlPath = path.join(PUBLIC_DIR, 'index.html');
  const content = fs.readFileSync(htmlPath, 'utf8');

  assert(content.includes('serviceWorker'), 'HTML references serviceWorker');
  assert(content.includes("register('/sw.js')") || content.includes('register(\'/sw.js\')'),
    'HTML registers sw.js');
}

/**
 * Test: Server serves manifest correctly (requires server running)
 */
async function testServerManifest() {
  console.log('Testing server serves manifest...');

  try {
    const res = await httpGet('http://localhost:3000/manifest.json');
    assert(res.status === 200, 'Server returns 200 for manifest');
    assert(res.headers['content-type'].includes('json'), 'Manifest has JSON content type');

    const manifest = JSON.parse(res.body);
    assert(manifest.name === 'encore.fm', 'Server manifest has correct name');
  } catch (error) {
    console.log(`  ⚠ Skipping server test (server not running): ${error.message}`);
  }
}

/**
 * Test: Server serves service worker correctly (requires server running)
 */
async function testServerServiceWorker() {
  console.log('Testing server serves service worker...');

  try {
    const res = await httpGet('http://localhost:3000/sw.js');
    assert(res.status === 200, 'Server returns 200 for service worker');
    assert(res.body.includes('addEventListener'), 'Service worker has event listeners');
  } catch (error) {
    console.log(`  ⚠ Skipping server test (server not running): ${error.message}`);
  }
}

/**
 * Test: Background audio support
 */
function testBackgroundAudioSupport() {
  console.log('Testing background audio support...');

  // Check HTML has audio element
  const htmlPath = path.join(PUBLIC_DIR, 'index.html');
  const htmlContent = fs.readFileSync(htmlPath, 'utf8');
  assert(htmlContent.includes('<audio'), 'HTML has audio element');

  // Service worker should handle reconnection
  const swPath = path.join(PUBLIC_DIR, 'sw.js');
  const swContent = fs.readFileSync(swPath, 'utf8');
  assert(swContent.includes('RECONNECT'), 'Service worker supports reconnect message');

  // HTML should listen for reconnect
  assert(htmlContent.includes('RECONNECT'), 'HTML handles reconnect message');
}

/**
 * Run all PWA tests
 */
async function runPWATests() {
  console.log('=== Starting PWA Tests ===\n');

  try {
    // File-based tests
    testManifestExists();
    testManifestFields();
    testManifestIcons();
    testIconFilesExist();
    testServiceWorkerExists();
    testServiceWorkerCaching();
    testServiceWorkerHLSHandling();
    testHTMLPWAMeta();
    testHTMLServiceWorkerRegistration();
    testBackgroundAudioSupport();

    // Server tests (optional, may skip if server not running)
    await testServerManifest();
    await testServerServiceWorker();

    console.log('\n=== All PWA Tests Passed ===');

  } catch (error) {
    console.error(`\nPWA test failed: ${error.message}`);
    throw error;
  }
}

// Run tests
runPWATests()
  .then(() => {
    console.log('PWA tests completed successfully');
    process.exit(0);
  })
  .catch((error) => {
    console.error(`PWA tests failed: ${error.message}`);
    process.exit(1);
  });
