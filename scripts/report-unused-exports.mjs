#!/usr/bin/env node
/**
 * Lightweight unused-export heuristic for agent-core + liora (Wave 0).
 * Not a full knip replacement — greps for export names referenced elsewhere.
 *
 * Usage:
 *   node scripts/report-unused-exports.mjs
 *   node scripts/report-unused-exports.mjs --fail
 *
 * Exits 0 in warn mode. With --fail, exits 1 when candidates remain after allowlist.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';

const repoRoot = resolve(import.meta.dirname, '..');
const failOnViolation = process.argv.includes('--fail');

const SCAN_ROOTS = ['packages/agent-core/src', 'apps/liora/src/tui/utils'];
const SEARCH_ROOTS = [
  'packages/agent-core/src',
  'packages/agent-core/test',
  'packages/node-sdk/src',
  'packages/server/src',
  'packages/acp-adapter/src',
  'apps/liora/src',
  'apps/liora/test',
];

const IGNORED_DIR_NAMES = new Set([
  'dist',
  'node_modules',
  'catalog',
  'generated',
  'coverage',
]);

/** Known entrypoints / intentionally unused public surface. */
const ALLOWLIST = new Set([
  // Add symbol names here as needed when --fail is enabled.
]);

const EXPORT_RE =
  /^export\s+(?:async\s+)?(?:function|class|const|let|type|interface|enum)\s+([A-Za-z_][\w]*)/gm;
const EXPORT_LIST_RE = /^export\s*\{([^}]+)\}/gm;

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
    if (entry.endsWith('.ts') || entry.endsWith('.tsx')) {
      if (entry.endsWith('.d.ts') || entry.includes('.generated.')) continue;
      if (entry === 'catalog-meta.ts') continue;
      files.push(entryPath);
    }
  }
  return files;
}

function collectFiles(roots) {
  const out = [];
  for (const root of roots) {
    const abs = join(repoRoot, root);
    try {
      if (statSync(abs).isDirectory()) out.push(...walk(abs));
    } catch {
      // skip
    }
  }
  return out;
}

const searchFiles = collectFiles(SEARCH_ROOTS);
const searchCorpus = new Map();
for (const file of searchFiles) {
  searchCorpus.set(file, readFileSync(file, 'utf8'));
}

function isReferenced(symbol, definingFile) {
  const needle = new RegExp(`\\b${symbol}\\b`);
  for (const [file, content] of searchCorpus) {
    if (file === definingFile) continue;
    if (needle.test(content)) return true;
  }
  return false;
}

const candidates = [];

for (const file of collectFiles(SCAN_ROOTS)) {
  const rel = relative(repoRoot, file).replaceAll('\\', '/');
  // Skip barrels and index re-export hubs — too noisy for this heuristic.
  if (rel.endsWith('/index.ts') || rel.endsWith('/index.tsx')) continue;
  const content = readFileSync(file, 'utf8');
  const symbols = new Set();

  EXPORT_RE.lastIndex = 0;
  let match;
  while ((match = EXPORT_RE.exec(content)) !== null) {
    symbols.add(match[1]);
  }
  EXPORT_LIST_RE.lastIndex = 0;
  while ((match = EXPORT_LIST_RE.exec(content)) !== null) {
    for (const part of match[1].split(',')) {
      const cleaned = part.trim().split(/\s+as\s+/).pop()?.trim();
      if (cleaned && /^[A-Za-z_]/.test(cleaned)) symbols.add(cleaned);
    }
  }

  for (const symbol of symbols) {
    if (ALLOWLIST.has(symbol)) continue;
    if (symbol.startsWith('_')) continue;
    if (!isReferenced(symbol, file)) {
      candidates.push(`${rel}: unused export candidate \`${symbol}\``);
    }
  }
}

if (candidates.length === 0) {
  console.log('unused-export report: no candidates.');
  process.exit(0);
}

const header = failOnViolation
  ? 'unused-export check FAILED:'
  : 'unused-export report WARNINGS (heuristic, non-blocking):';
console[failOnViolation ? 'error' : 'warn'](header);
// Cap output — full list can be huge on first run.
const shown = candidates.slice(0, 80);
for (const line of shown) {
  console[failOnViolation ? 'error' : 'warn'](`- ${line}`);
}
if (candidates.length > shown.length) {
  console[failOnViolation ? 'error' : 'warn'](
    `… and ${candidates.length - shown.length} more (total ${candidates.length})`,
  );
} else {
  console[failOnViolation ? 'error' : 'warn'](`Total: ${candidates.length}`);
}
process.exit(failOnViolation ? 1 : 0);
