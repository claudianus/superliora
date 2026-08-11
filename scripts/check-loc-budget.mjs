#!/usr/bin/env node
/**
 * LOC budget for hand-written TypeScript.
 *
 * Thresholds (generated/catalog excluded):
 *   >1500  fail (unless allowlisted)
 *   >1000  warn
 *
 * Usage:
 *   node scripts/check-loc-budget.mjs
 *   node scripts/check-loc-budget.mjs --fail
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';

const repoRoot = resolve(import.meta.dirname, '..');
const failOnViolation = process.argv.includes('--fail');

const WARN_AT = 1000;
const FAIL_AT = 1500;

/** Remaining god-files tracked for incremental shrink. Remove as they drop ≤1500. */
const FAIL_ALLOWLIST = new Set([
  // Pre-existing renderer god-file; shrink incrementally without blocking unrelated PRs.
  'packages/tui-renderer/src/transcript/viewport-component.ts',
  // Pre-existing JobCreate surface; shrink incrementally without blocking unrelated PRs.
  'packages/agent-core/src/tools/builtin/job/job-tools.ts',
]);

const ROOTS = [
  'packages/agent-core/src',
  'packages/node-sdk/src',
  'packages/protocol/src',
  'packages/server/src',
  'packages/acp-adapter/src',
  'packages/kosong/src',
  'packages/oauth/src',
  'packages/tui-renderer/src',
  'apps/liora/src',
];

const IGNORED_DIR_NAMES = new Set([
  'dist',
  'node_modules',
  'catalog',
  'generated',
  'coverage',
  '.tmp-api-extractor',
]);

const IGNORED_FILE_NAMES = new Set([
  'catalog-meta.ts',
  'bundled-external-themes.generated.ts',
]);

function walk(dir) {
  const files = [];
  for (const entry of readdirSync(dir)) {
    const entryPath = join(dir, entry);
    let stats;
    try {
      stats = statSync(entryPath);
    } catch {
      continue;
    }
    if (stats.isDirectory()) {
      if (IGNORED_DIR_NAMES.has(entry)) continue;
      files.push(...walk(entryPath));
      continue;
    }
    if (!entry.endsWith('.ts') && !entry.endsWith('.tsx')) continue;
    if (entry.endsWith('.d.ts')) continue;
    if (IGNORED_FILE_NAMES.has(entry)) continue;
    if (entry.includes('.generated.')) continue;
    files.push(entryPath);
  }
  return files;
}

const warns = [];
const fails = [];
const allowlisted = [];

for (const root of ROOTS) {
  const abs = join(repoRoot, root);
  try {
    if (!statSync(abs).isDirectory()) continue;
  } catch {
    continue;
  }
  for (const file of walk(abs)) {
    const lines = readFileSync(file, 'utf8').split('\n').length;
    const rel = relative(repoRoot, file).replaceAll('\\', '/');
    if (lines > FAIL_AT) {
      if (FAIL_ALLOWLIST.has(rel)) allowlisted.push({ rel, lines });
      else fails.push({ rel, lines });
    } else if (lines > WARN_AT) warns.push({ rel, lines });
  }
}

fails.sort((a, b) => b.lines - a.lines);
warns.sort((a, b) => b.lines - a.lines);
allowlisted.sort((a, b) => b.lines - a.lines);

console.log(`LOC budget (warn>${WARN_AT}, fail>${FAIL_AT}; generated/catalog excluded)`);

if (fails.length === 0 && warns.length === 0 && allowlisted.length === 0) {
  console.log('All scanned files within budget.');
  process.exit(0);
}

if (fails.length > 0) {
  console[failOnViolation ? 'error' : 'warn'](`\nFAIL (>${FAIL_AT} LOC, not allowlisted): ${fails.length}`);
  for (const item of fails) {
    console[failOnViolation ? 'error' : 'warn'](`  ${item.lines}\t${item.rel}`);
  }
}
if (allowlisted.length > 0) {
  console.warn(`\nALLOWLISTED (>${FAIL_AT} LOC): ${allowlisted.length}`);
  for (const item of allowlisted) {
    console.warn(`  ${item.lines}\t${item.rel}`);
  }
}
if (warns.length > 0) {
  console.warn(`\nWARN (>${WARN_AT} LOC): ${warns.length}`);
  for (const item of warns) {
    console.warn(`  ${item.lines}\t${item.rel}`);
  }
}

if (failOnViolation && fails.length > 0) {
  process.exit(1);
}
process.exit(0);
