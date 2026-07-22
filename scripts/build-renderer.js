// ============================================================================
// Renderer bundler
// ============================================================================
// The renderer is written in React/TSX. `tsc` alone only transpiles each file
// into a separate ES module with unresolved bare imports (`react`,
// `react-dom/client`), so the browser cannot load them and the window stays
// blank. This script bundles the whole renderer entry (App + components +
// React) into a SINGLE self-contained IIFE at dist/renderer/renderer.js,
// which is exactly what src/renderer/index.html references.
//
// Usage: node scripts/build-renderer.js

const path = require('path');
const esbuild = require('esbuild');

const root = path.join(__dirname, '..');

async function main() {
  await esbuild.build({
    entryPoints: [path.join(root, 'src/renderer/index.tsx')],
    bundle: true,
    outfile: path.join(root, 'dist/renderer/renderer.js'),
    platform: 'browser',
    format: 'iife',
    target: 'es2022',
    jsx: 'automatic',
    sourcemap: true,
    // React reads process.env.NODE_ENV; define it so the bundle has no
    // unresolved `process` reference in the renderer.
    define: {
      'process.env.NODE_ENV': JSON.stringify(process.env.NODE_ENV || 'production'),
    },
    logLevel: 'info',
  });
  console.log('[build-renderer] dist/renderer/renderer.js written');
}

main().catch((err) => {
  console.error('[build-renderer] failed:', err);
  process.exit(1);
});
