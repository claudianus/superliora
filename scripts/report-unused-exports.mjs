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
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';

const repoRoot = resolve(import.meta.dirname, '..');
const failOnViolation = process.argv.includes('--fail');
const updateAllowlist = process.argv.includes('--update');
const ALLOWLIST_PATH = join(repoRoot, 'meta', 'unused-exports-allowlist.txt');

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

/** Known unused exports, as `file:symbol` lines. */
function loadAllowlist() {
  if (!existsSync(ALLOWLIST_PATH)) return new Set();
  return new Set(
    readFileSync(ALLOWLIST_PATH, 'utf8')
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line.length > 0 && !line.startsWith('#')),
  );
}

const ALLOWLIST = loadAllowlist();

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
  /** @type {Set<string>} */
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
    if (symbol.startsWith('_')) continue;
    if (!isReferenced(symbol, file)) {
      const key = `${rel}:${symbol}`;
      if (!updateAllowlist && (ALLOWLIST.has(key) || ALLOWLIST.has(symbol))) continue;
      candidates.push(`${String(rel)}: unused export candidate \`${String(symbol)}\``);
    }
  }
}

if (updateAllowlist) {
  const keys = candidates
    .map((line) => {
      const match = line.match(/^(.+): unused export candidate `([^`]+)`$/);
      return match === null ? undefined : `${match[1]}:${match[2]}`;
    })
    .filter((key) => key !== undefined)
    .toSorted((a, b) => a.localeCompare(b));
  writeFileSync(
    ALLOWLIST_PATH,
    [
      '# Unused-export ratchet. Refresh with: node scripts/report-unused-exports.mjs --update',
      ...keys,
      '',
    ].join('\n'),
  );
  console.log(`unused-export allowlist updated: ${keys.length} symbol(s)`);
  process.exit(0);
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
