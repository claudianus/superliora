#!/usr/bin/env node
import assert from 'node:assert/strict';

import {
  addedLinesFromUnifiedDiff,
  slopHits,
  stripInlineCode,
} from './check-ai-slop.mjs';

const diff = [
  'diff --git a/apps/liora/src/tui/PREMIUM.md b/apps/liora/src/tui/PREMIUM.md',
  '--- a/apps/liora/src/tui/PREMIUM.md',
  '+++ b/apps/liora/src/tui/PREMIUM.md',
  '@@ -80,1 +80,1 @@',
  '- ↑↓ navigate · Enter select · Esc cancel',
  '@@ -219,0 +220,2 @@',
  '+Login / device-code wait panels use the same live rounded frame.',
  '+Reuse `renderPremiumBoxFrame` from `@harness-kit/tui-renderer`.',
  '',
].join('\n');

const added = addedLinesFromUnifiedDiff(diff);
const premium = added.get('apps/liora/src/tui/PREMIUM.md');
assert.ok(premium);
assert.deepEqual(
  premium.map((row) => row.line),
  [
    'Login / device-code wait panels use the same live rounded frame.',
    'Reuse `renderPremiumBoxFrame` from `@harness-kit/tui-renderer`.',
  ],
);
assert.equal(premium[0]?.lineNum, 220);

assert.deepEqual(slopHits(premium[0]?.line ?? ''), []);
assert.equal(stripInlineCode(premium[1]?.line ?? '').includes('harness'), false);
assert.deepEqual(slopHits(premium[1]?.line ?? ''), []);
assert.deepEqual(slopHits('↑↓ navigate · Enter select · Esc cancel'), ['navigate']);
assert.deepEqual(slopHits('Please leverage the API'), ['leverage']);

console.log('check-ai-slop.test.mjs: ok');
