// ============================================================================
// Tests for the estimated page-load progress logic
// ============================================================================
//
// Mirrors the `emitProgress` / `resetProgress` behavior in
// src/main/ipc/tabs.ipc.ts (setupViewEvents). The real code broadcasts the
// value over IPC; here we just verify the numeric rules:
//   1. progress is clamped to [0, 1]
//   2. progress never decreases within a single load (monotonic)
//   3. resetProgress() starts a fresh load back at 0

import assert from 'node:assert';

/** Standalone re-implementation of the progress accumulator. */
function makeProgress() {
  let progress = 0;
  return {
    emit(value: number): number {
      progress = Math.max(progress, Math.min(1, value));
      return progress;
    },
    reset(): void {
      progress = 0;
    },
    get value(): number {
      return progress;
    },
  };
}

let passed = 0;
function test(name: string, fn: () => void) {
  fn();
  console.log(`  \u2713 ${name}`);
  passed++;
}

console.log('Running load-progress tests...');

test('clamps values above 1 down to 1', () => {
  const p = makeProgress();
  assert.strictEqual(p.emit(1.5), 1);
});

test('clamps negative values up to the current floor (0)', () => {
  const p = makeProgress();
  assert.strictEqual(p.emit(-0.3), 0);
});

test('is monotonic — never goes backwards within a load', () => {
  const p = makeProgress();
  p.emit(0.25);
  p.emit(0.65);
  // A late, smaller milestone must not pull the bar backwards.
  assert.strictEqual(p.emit(0.1), 0.65);
});

test('follows the typical lifecycle up to completion', () => {
  const p = makeProgress();
  assert.strictEqual(p.emit(0.08), 0.08); // did-start-loading
  assert.strictEqual(p.emit(0.25), 0.25); // did-start-navigation
  assert.strictEqual(p.emit(0.65), 0.65); // dom-ready
  assert.strictEqual(p.emit(0.9), 0.9);   // did-frame-finish-load (main)
  assert.strictEqual(p.emit(1), 1);       // did-stop-loading
});

test('reset() starts the next load at 0', () => {
  const p = makeProgress();
  p.emit(0.9);
  p.reset();
  assert.strictEqual(p.value, 0);
  assert.strictEqual(p.emit(0.08), 0.08);
});

console.log(`\u2713 All ${passed} load-progress tests passed.`);
