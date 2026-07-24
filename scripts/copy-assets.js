// ============================================================================
// Copy static renderer assets into dist/
// ============================================================================
// `tsc` / esbuild only emit JS. The renderer window also needs its HTML shell,
// the global stylesheet, and the app logo images that AddressBar references by
// relative path (./vault-browser-main.png / ./vault-browser-light.png).
// This script copies all of those into dist/renderer/ after the bundling step.
//
// Usage: node scripts/copy-assets.js

const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const rendererSrc = path.join(root, 'src', 'renderer');
const rendererDist = path.join(root, 'dist', 'renderer');
const assetsSrc = path.join(root, 'assets', 'renderer');

fs.mkdirSync(path.join(rendererDist, 'styles'), { recursive: true });

// HTML shell + global stylesheet
fs.copyFileSync(
  path.join(rendererSrc, 'index.html'),
  path.join(rendererDist, 'index.html'),
);
fs.copyFileSync(
  path.join(rendererSrc, 'styles', 'global.css'),
  path.join(rendererDist, 'styles', 'global.css'),
);

// App logo images (referenced by AddressBar via relative ./ paths)
const logos = ['vault-browser-main.png', 'vault-browser-light.png'];
for (const logo of logos) {
  const from = path.join(assetsSrc, logo);
  if (fs.existsSync(from)) {
    fs.copyFileSync(from, path.join(rendererDist, logo));
  } else {
    console.warn(`[copy-assets] WARNING: missing logo asset ${from}`);
  }
}

console.log('[copy-assets] renderer assets copied to dist/renderer/');
