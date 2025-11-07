/**
 * Build script that forces electron-builder to use local cache and offline mode
 * This prevents any attempts to download from GitHub
 */

const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');

// Check if Electron exists in node_modules
const electronDist = path.join(process.cwd(), 'node_modules', 'electron', 'dist');
if (!fs.existsSync(electronDist)) {
  console.error('[ERROR] Electron not found in node_modules/electron/dist');
  console.error('[ERROR] Run "npm install" first!');
  process.exit(1);
}

// Check if electron-builder cache exists
const ELECTRON_VERSION = '31.7.7';
const PLATFORM = process.platform;
const ARCH = process.arch === 'x64' ? 'x64' : 'ia32';
const CACHE_DIR = path.join(os.homedir(), 
  PLATFORM === 'win32' ? 'AppData/Local/electron-builder/Cache' :
  PLATFORM === 'darwin' ? 'Library/Caches/electron-builder' :
  '.cache/electron-builder'
);
const ELECTRON_CACHE_DIR = path.join(CACHE_DIR, 'electron', ELECTRON_VERSION);
const ELECTRON_ZIP_NAME = `electron-v${ELECTRON_VERSION}-${PLATFORM}-${ARCH}.zip`;
const cachedZip = path.join(ELECTRON_CACHE_DIR, ELECTRON_ZIP_NAME);

if (!fs.existsSync(cachedZip)) {
  console.warn('[WARNING] Electron cache not found at:', cachedZip);
  console.warn('[WARNING] Build may fail if offline. Make sure cache is copied to offline PC.');
  console.warn('');
}

// Set environment variables to force offline mode
const env = {
  ...process.env,
  // Force electron-builder to use local Electron from node_modules
  ELECTRON_GET_USE_PROXY: 'false',
  // Disable any proxy settings
  HTTP_PROXY: '',
  HTTPS_PROXY: '',
  http_proxy: '',
  https_proxy: '',
  // Set cache directory explicitly
  ELECTRON_BUILDER_CACHE: CACHE_DIR,
  // Force use of local cache (electron-builder uses this)
  ELECTRON_CACHE: CACHE_DIR,
  // Point to local Electron installation
  ELECTRON_PATH: electronDist,
  // Disable mirror/registry checks
  ELECTRON_MIRROR: '',
  ELECTRON_CUSTOM_DIR: '',
  // Prevent any network requests
  NO_PROXY: '*',
  no_proxy: '*',
};

console.log('[BUILD] Starting offline build...');
console.log('[BUILD] Using Electron from:', electronDist);
console.log('[BUILD] Using cache directory:', CACHE_DIR);
console.log('');

// Get build arguments (everything after the script name)
const buildArgs = process.argv.slice(2);
if (buildArgs.length === 0) {
  buildArgs.push('--dir'); // Default to directory build
}

// Run electron-builder with offline environment
const builder = spawn('npx', ['electron-builder', ...buildArgs], {
  env,
  stdio: 'inherit',
  shell: true,
  cwd: process.cwd()
});

builder.on('close', (code) => {
  if (code !== 0) {
    console.error('');
    console.error('[BUILD] Build failed with exit code:', code);
    if (!fs.existsSync(cachedZip)) {
      console.error('[BUILD] Make sure Electron cache is copied to:', cachedZip);
    }
    process.exit(code);
  }
});

builder.on('error', (err) => {
  console.error('[BUILD] Failed to start electron-builder:', err);
  process.exit(1);
});

