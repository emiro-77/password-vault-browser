// ============================================================================
// Guard: preload's inlined IPC_CHANNELS must stay in sync with shared/types
// ============================================================================
// The main-window preload runs sandboxed and cannot import ../shared/types, so
// it inlines a copy of IPC_CHANNELS. If the two ever drift, IPC calls silently
// break. This test parses both and asserts they are identical.

import * as fs from 'fs';
import * as path from 'path';
import { IPC_CHANNELS } from '../src/shared/types';

let passed = 0;
let failed = 0;
function ok(name: string, cond: boolean) {
  if (cond) { console.log(`  \u2713 ${name}`); passed++; }
  else { console.error(`  \u2717 ${name}`); failed++; }
}

// Extract the inlined object literal from the preload source.
const preloadSrc = fs.readFileSync(
  path.join(__dirname, '../src/preload/index.ts'),
  'utf8'
);

// Pull every 'KEY: 'value'' pair inside the inlined const IPC_CHANNELS block.
const blockMatch = preloadSrc.match(/const IPC_CHANNELS = \{([\s\S]*?)\} as const;/);
ok('preload contains an inlined IPC_CHANNELS block', !!blockMatch);

const inlined: Record<string, string> = {};
if (blockMatch) {
  const pairRe = /([A-Z0-9_]+)\s*:\s*'([^']+)'/g;
  let m: RegExpExecArray | null;
  while ((m = pairRe.exec(blockMatch[1])) !== null) {
    inlined[m[1]] = m[2];
  }
}

const shared = IPC_CHANNELS as Record<string, string>;

console.log('\n=== every shared channel is present & equal in preload ===');
for (const key of Object.keys(shared)) {
  ok(`${key} matches`, inlined[key] === shared[key]);
}

console.log('\n=== preload has no extra/stale channels ===');
for (const key of Object.keys(inlined)) {
  ok(`${key} exists in shared`, shared[key] !== undefined && inlined[key] === shared[key]);
}

if (failed > 0) {
  console.error(`\n\u2717 ${failed} ipc-channels-sync test(s) failed. Update src/preload/index.ts to match src/shared/types.ts.`);
  process.exit(1);
}
console.log(`\n\u2713 All ${passed} ipc-channels-sync checks passed.`);
