#!/usr/bin/env node
/**
 * Ratchet for `packages/agent-core` test-tree typecheck errors.
 * `pnpm -C packages/agent-core run typecheck` covers src only; this job
 * typechecks `tsconfig.json` (src + test) and fails if the error count rises.
 *
 * Usage:
 *   node scripts/check-agent-core-test-types.mjs
 *   node scripts/check-agent-core-test-types.mjs --update
 */
import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const repoRoot = resolve(import.meta.dirname, '..');
const baselinePath = resolve(repoRoot, 'meta', 'agent-core-test-types-baseline.json');
const update = process.argv.includes('--update');

const result = spawnSync(
  'pnpm',
  ['exec', 'tsc', '-p', 'tsconfig.json', '--noEmit', '--pretty', 'false'],
  {
    cwd: resolve(repoRoot, 'packages/agent-core'),
    encoding: 'utf8',
    env: process.env,
  },
);

const output = `${result.stdout ?? ''}\n${result.stderr ?? ''}`;
const errorLines = output
  .split('\n')
  .map((line) => line.trim())
  .filter((line) => /error TS\d+/.test(line));
const errorCount = errorLines.length;

if (update) {
  writeFileSync(
    baselinePath,
    `${JSON.stringify({ errorCount, updatedAt: new Date().toISOString() }, null, 2)}\n`,
  );
  console.log(`agent-core test typecheck baseline updated: ${errorCount} errors`);
  process.exit(0);
}

let baseline;
try {
  baseline = JSON.parse(readFileSync(baselinePath, 'utf8'));
} catch {
  console.error(
    'agent-core test typecheck: missing meta/agent-core-test-types-baseline.json (run --update)',
  );
  process.exit(2);
}

const expected = Number(baseline.errorCount);
if (!Number.isInteger(expected) || expected < 0) {
  console.error('agent-core test typecheck: invalid baseline errorCount');
  process.exit(2);
}

console.log(
  `agent-core test typecheck: ${errorCount} errors (baseline ${expected})`,
);
if (errorCount > expected) {
  console.error('NEW type errors in packages/agent-core/test — fix them or do not add more.');
  for (const line of errorLines.slice(0, 20)) console.error(`  ${line}`);
  if (errorLines.length > 20) console.error(`  ... and ${errorLines.length - 20} more`);
  process.exit(1);
}
if (errorCount < expected) {
  console.error(
    `FIXED type errors (${errorCount} < ${expected}) — ratchet down with: node scripts/check-agent-core-test-types.mjs --update`,
  );
  process.exit(1);
}
console.log('agent-core test typecheck ratchet: held');
