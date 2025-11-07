/**
 * Check if Electron cache exists for offline builds
 * This script verifies that electron-builder cache is ready
 */

const fs = require('fs');
const path = require('path');
const os = require('os');

const ELECTRON_VERSION = '31.7.7';
const PLATFORM = process.platform;
const ARCH = process.arch === 'x64' ? 'x64' : 'ia32';

// electron-builder cache location
const CACHE_DIR = path.join(os.homedir(), 
  PLATFORM === 'win32' ? 'AppData/Local/electron-builder/Cache' :
  PLATFORM === 'darwin' ? 'Library/Caches/electron-builder' :
  '.cache/electron-builder'
);

const ELECTRON_CACHE_DIR = path.join(CACHE_DIR, 'electron', ELECTRON_VERSION);
const ELECTRON_ZIP_NAME = `electron-v${ELECTRON_VERSION}-${PLATFORM}-${ARCH}.zip`;
const cachedZip = path.join(ELECTRON_CACHE_DIR, ELECTRON_ZIP_NAME);

console.log('[CACHE] Checking Electron cache for offline builds...');
console.log('[CACHE] Electron version:', ELECTRON_VERSION);
console.log('[CACHE] Platform:', PLATFORM, ARCH);
console.log('[CACHE] Cache directory:', CACHE_DIR);

// Check if cache exists
if (fs.existsSync(cachedZip)) {
  const stats = fs.statSync(cachedZip);
  const sizeMB = (stats.size / (1024 * 1024)).toFixed(2);
  console.log('[CACHE] ✓ Electron cache found:', cachedZip);
  console.log('[CACHE] ✓ Cache size:', sizeMB, 'MB');
  console.log('[CACHE] ✓ Ready for offline builds!');
  process.exit(0);
} else {
  console.warn('[CACHE] ⚠ Electron cache not found');
  console.warn('[CACHE] Expected location:', cachedZip);
  console.warn('');
  console.warn('[CACHE] NOTE: First build requires internet to download Electron binaries.');
  console.warn('[CACHE] After first build, subsequent builds will work offline.');
  console.warn('[CACHE] Continuing with build (will download if online)...');
  // Don't exit with error - allow build to proceed (it will download if online)
  process.exit(0);
}

