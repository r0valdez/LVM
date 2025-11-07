/**
 * Prepare files for offline build transfer
 * This script helps identify what needs to be copied to build offline
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

console.log('='.repeat(70));
console.log('OFFLINE BUILD PREPARATION CHECKLIST');
console.log('='.repeat(70));
console.log('');

// Check project structure
console.log('1. PROJECT FILES (Copy entire project folder):');
console.log('   ✓ Source code (electron/, renderer/, scripts/, etc.)');
console.log('   ✓ package.json');
console.log('   ✓ package-lock.json (if exists)');
console.log('');

// Check node_modules
const nodeModulesPath = path.join(process.cwd(), 'node_modules');
if (fs.existsSync(nodeModulesPath)) {
  const stats = fs.statSync(nodeModulesPath);
  const sizeMB = (getDirSize(nodeModulesPath) / (1024 * 1024)).toFixed(2);
  console.log('2. NODE_MODULES (Required):');
  console.log('   ✓ node_modules/ directory exists');
  console.log('   ✓ Size:', sizeMB, 'MB');
  console.log('   Location:', nodeModulesPath);
  console.log('');
} else {
  console.log('2. NODE_MODULES (Required):');
  console.log('   ⚠ node_modules/ NOT FOUND');
  console.log('   Run "npm install" first!');
  console.log('');
}

// Check Electron cache
console.log('3. ELECTRON CACHE (Required for offline build):');
if (fs.existsSync(cachedZip)) {
  const stats = fs.statSync(cachedZip);
  const sizeMB = (stats.size / (1024 * 1024)).toFixed(2);
  console.log('   ✓ Electron cache found');
  console.log('   ✓ Cache size:', sizeMB, 'MB');
  console.log('   Location:', cachedZip);
  console.log('   Full cache directory:', CACHE_DIR);
  console.log('');
} else {
  console.log('   ⚠ Electron cache NOT FOUND');
  console.log('   Expected:', cachedZip);
  console.log('   Run "npm run build:dir" first to download and cache Electron!');
  console.log('');
}

// Check electron-builder cache (additional tools)
const builderCacheDir = path.join(CACHE_DIR, 'winCodeSign');
const builderCacheExists = fs.existsSync(builderCacheDir);
console.log('4. ELECTRON-BUILDER TOOLS CACHE (Optional but recommended):');
if (builderCacheExists) {
  console.log('   ✓ Builder tools cache found');
  console.log('   Location:', CACHE_DIR);
  console.log('   (Copy entire Cache directory)');
} else {
  console.log('   ⚠ Builder tools cache not found (will be downloaded if needed)');
  console.log('   Location:', CACHE_DIR);
}
console.log('');

console.log('='.repeat(70));
console.log('COPY INSTRUCTIONS');
console.log('='.repeat(70));
console.log('');
console.log('TO TRANSFER TO OFFLINE PC:');
console.log('');
console.log('1. Copy entire project folder (including node_modules/):');
console.log('   - All source files');
console.log('   - node_modules/ directory');
console.log('   - package.json and package-lock.json');
console.log('');
console.log('2. Copy Electron cache directory:');
console.log('   FROM:', CACHE_DIR);
console.log('   TO: Same location on offline PC');
console.log('   (Create the directory structure if it doesn\'t exist)');
console.log('');
console.log('3. On offline PC, verify cache location:');
console.log('   Windows:', '%LOCALAPPDATA%\\electron-builder\\Cache');
console.log('   macOS:', '~/Library/Caches/electron-builder');
console.log('   Linux:', '~/.cache/electron-builder');
console.log('');
console.log('4. On offline PC, run:');
console.log('   npm run build:dir');
console.log('');

// Helper function to calculate directory size
function getDirSize(dirPath) {
  let size = 0;
  try {
    const files = fs.readdirSync(dirPath);
    for (const file of files) {
      const filePath = path.join(dirPath, file);
      const stats = fs.statSync(filePath);
      if (stats.isDirectory()) {
        size += getDirSize(filePath);
      } else {
        size += stats.size;
      }
    }
  } catch (err) {
    // Ignore errors
  }
  return size;
}

