#!/usr/bin/env node
/**
 * Directory flatness budget for hand-written TypeScript trees.
 *
 * Counts .ts/.tsx siblings at one directory depth (not recursive).
 *
 * Thresholds (generated/catalog excluded):
 *   >40  fail (unless allowlisted) when --fail
 *   >25  warn
 *
 * Also warns when both `foo.ts` and `foo/` exist (dual public entry).
 *
 * Usage:
 *   node scripts/check-dir-budget.mjs
 *   node scripts/check-dir-budget.mjs --fail
 */
import { readdirSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';

const repoRoot = resolve(import.meta.dirname, '..');
const failOnViolation = process.argv.includes('--fail');

const WARN_AT = 25;
const FAIL_AT = 40;

/**
 * Directories still over FAIL_AT flat .ts files. Shrink and remove entries.
 * Paths are repo-relative with trailing slash omitted.
 */
const FAIL_ALLOWLIST = new Set([
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
  '__tests__',
]);

function isTs(name) {
  return (name.endsWith('.ts') || name.endsWith('.tsx')) && !name.endsWith('.d.ts') && !name.includes('.generated.');
}

function walkDirs(dir, out) {
  out.push(dir);
  let entries;
  try {
    entries = readdirSync(dir);
  } catch {
    return;
  }
  for (const entry of entries) {
    if (IGNORED_DIR_NAMES.has(entry)) continue;
    const entryPath = join(dir, entry);
    let stats;
    try {
      stats = statSync(entryPath);
    } catch {
      continue;
    }
    if (stats.isDirectory()) walkDirs(entryPath, out);
  }
}

const warns = [];
const fails = [];
const allowlisted = [];
const dualEntries = [];

for (const root of ROOTS) {
  const absRoot = join(repoRoot, root);
  try {
    if (!statSync(absRoot).isDirectory()) continue;
  } catch {
    continue;
  }
  const dirs = [];
  walkDirs(absRoot, dirs);
  for (const dir of dirs) {
    let entries;
    try {
      entries = readdirSync(dir);
    } catch {
      continue;
    }
    const tsFiles = [];
    const subdirs = new Set();
    for (const entry of entries) {
      const entryPath = join(dir, entry);
      let stats;
      try {
        stats = statSync(entryPath);
      } catch {
        continue;
      }
      if (stats.isDirectory()) {
        if (!IGNORED_DIR_NAMES.has(entry)) subdirs.add(entry);
        continue;
      }
      if (isTs(entry)) tsFiles.push(entry);
    }
    const relDir = relative(repoRoot, dir).replaceAll('\\', '/');
    const count = tsFiles.length;
    if (count > FAIL_AT) {
      if (FAIL_ALLOWLIST.has(relDir)) allowlisted.push({ rel: relDir, count });
      else fails.push({ rel: relDir, count });
    } else if (count > WARN_AT) {
      warns.push({ rel: relDir, count });
    }
    for (const file of tsFiles) {
      const base = file.replace(/\.tsx?$/, '');
      if (subdirs.has(base)) {
        dualEntries.push(`${relDir}/${base}.ts|+|${relDir}/${base}/`);
      }
    }
  }
}

fails.sort((a, b) => b.count - a.count);
warns.sort((a, b) => b.count - a.count);
allowlisted.sort((a, b) => b.count - a.count);
dualEntries.sort();

console.log(`Dir budget (warn>${WARN_AT} flat .ts, fail>${FAIL_AT}; catalog/generated excluded)`);

if (
  fails.length === 0 &&
  warns.length === 0 &&
  allowlisted.length === 0 &&
  dualEntries.length === 0
) {
  console.log('All scanned directories within budget; no dual entries.');
  process.exit(0);
}

if (fails.length > 0) {
  console[failOnViolation ? 'error' : 'warn'](
    `\nFAIL (>${FAIL_AT} flat .ts, not allowlisted): ${fails.length}`,
  );
  for (const item of fails) {
    console[failOnViolation ? 'error' : 'warn'](`  ${item.count}\t${item.rel}`);
  }
}
if (allowlisted.length > 0) {
  console.warn(`\nALLOWLISTED (>${FAIL_AT} flat .ts): ${allowlisted.length}`);
  for (const item of allowlisted) {
    console.warn(`  ${item.count}\t${item.rel}`);
  }
}
if (warns.length > 0) {
  console.warn(`\nWARN (>${WARN_AT} flat .ts): ${warns.length}`);
  for (const item of warns) {
    console.warn(`  ${item.count}\t${item.rel}`);
  }
}
if (dualEntries.length > 0) {
  console.warn(`\nDUAL ENTRY (foo.ts + foo/): ${dualEntries.length}`);
  for (const item of dualEntries) {
    console.warn(`  ${item}`);
  }
}

if (failOnViolation && fails.length > 0) {
  process.exit(1);
}
process.exit(0);
