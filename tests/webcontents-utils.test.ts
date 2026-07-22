// ============================================================================
// Tests for WebContents navigation helpers (Electron 33 compatibility)
// ============================================================================
// Verifies the helpers prefer the new navigationHistory API and fall back to
// legacy methods, so no deprecated calls are made when navigationHistory exists.

import { canGoBack, canGoForward, goBack, goForward, computeViewBounds } from '../src/main/services/webcontents-utils';

let passed = 0;
let failed = 0;

function ok(name: string, cond: boolean) {
  if (cond) {
    console.log(`  \u2713 ${name}`);
    passed++;
  } else {
    console.error(`  \u2717 ${name}`);
    failed++;
  }
}

console.log('\n=== navigationHistory API preferred ===');
{
  let legacyCalled = false;
  const wc: any = {
    navigationHistory: {
      canGoBack: () => true,
      canGoForward: () => false,
      goBack: () => { (wc.__wentBack = true); },
      goForward: () => { (wc.__wentForward = true); },
    },
    canGoBack: () => { legacyCalled = true; return false; },
    canGoForward: () => { legacyCalled = true; return true; },
    goBack: () => { legacyCalled = true; },
    goForward: () => { legacyCalled = true; },
  };

  ok('canGoBack uses navigationHistory', canGoBack(wc) === true);
  ok('canGoForward uses navigationHistory', canGoForward(wc) === false);
  goBack(wc);
  goForward(wc);
  ok('goBack routed to navigationHistory', wc.__wentBack === true);
  ok('goForward routed to navigationHistory', wc.__wentForward === true);
  ok('legacy methods NOT called when navigationHistory present', legacyCalled === false);
}

console.log('\n=== legacy fallback when navigationHistory absent ===');
{
  let backCalled = false;
  let fwdCalled = false;
  const wc: any = {
    canGoBack: () => true,
    canGoForward: () => true,
    goBack: () => { backCalled = true; },
    goForward: () => { fwdCalled = true; },
  };

  ok('canGoBack falls back to legacy', canGoBack(wc) === true);
  ok('canGoForward falls back to legacy', canGoForward(wc) === true);
  goBack(wc);
  goForward(wc);
  ok('goBack falls back to legacy', backCalled === true);
  ok('goForward falls back to legacy', fwdCalled === true);
}

console.log('\n=== safe when nothing available ===');
{
  const wc: any = {};
  ok('canGoBack returns false safely', canGoBack(wc) === false);
  ok('canGoForward returns false safely', canGoForward(wc) === false);
  goBack(wc); // should not throw
  goForward(wc); // should not throw
  ok('goBack/goForward no-op without throwing', true);
}

console.log('\n=== computeViewBounds ===');
{
  const b = computeViewBounds(1280, 800, 280, 120);
  ok('x = sidebar width', b.x === 280);
  ok('y = chrome height', b.y === 120);
  ok('width = content - sidebar', b.width === 1000);
  ok('height = content - chrome', b.height === 680);

  const clamped = computeViewBounds(200, 100, 280, 120);
  ok('width clamps to 0 when sidebar wider than window', clamped.width === 0);
  ok('height clamps to 0 when chrome taller than window', clamped.height === 0);

  const zeroChrome = computeViewBounds(1000, 800, 0, 0);
  ok('full content when no sidebar/chrome', zeroChrome.width === 1000 && zeroChrome.height === 800);
}

if (failed > 0) {
  console.error(`\n\u2717 ${failed} webcontents-utils test(s) failed.`);
  process.exit(1);
}
console.log(`\n\u2713 All ${passed} webcontents-utils tests passed.`);
