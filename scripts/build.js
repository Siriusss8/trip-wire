/**
 * Build script — copies extension files to dist/ for loading in Chrome/Firefox.
 * This avoids Chrome counting node_modules (114 MB) as part of the extension.
 *
 * Usage: npm run build
 * Then load dist/ as an unpacked extension.
 */

import { cpSync, rmSync, mkdirSync } from 'fs';

const DIST = 'dist';

// Extension files to include (relative to repo root)
const FILES = [
  'manifest.json',
  'background.js',
  'browser-api.js',
  'browser-polyfill.js',
  'content-script.js',
  'format-utils.js',
  'glb-decompress.js',
  'meshopt_decoder.js',
  'popup.html',
  'popup.css',
  'popup.js',
  'url-utils.js',
];

const DIRS = ['icons'];

// Clean and recreate dist/
rmSync(DIST, { recursive: true, force: true });
mkdirSync(DIST, { recursive: true });

// Copy files
for (const file of FILES) {
  cpSync(file, `${DIST}/${file}`);
}

// Copy directories
for (const dir of DIRS) {
  cpSync(dir, `${DIST}/${dir}`, { recursive: true });
}

console.log(`✓ Built extension in ${DIST}/ (load this folder in Chrome/Firefox)`);
