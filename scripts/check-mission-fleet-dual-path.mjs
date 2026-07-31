#!/usr/bin/env node
/**
 * Soft-path import guard for mission/fleet rename cutover (W5).
 *
 * apps/liora and packages/node-sdk must not import legacy agent-core/SDK
 * path aliases directly:
 *   #/ultrawork, #/collaboration
 *   @superliora/agent-core/{ultrawork,collaboration}
 *   @superliora/sdk/{ultrawork,collaboration}
 *
 * Use #/mission / #/fleet (or @superliora/sdk/mission|fleet from apps).
 *
 * Usage:
 *   node scripts/check-mission-fleet-dual-path.mjs
 *   node scripts/check-mission-fleet-dual-path.mjs --fail
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';

const repoRoot = resolve(import.meta.dirname, '..');
const failOnViolation = process.argv.includes('--fail');

const SCAN_ROOTS = [
  join(repoRoot, 'apps/liora/src'),
  join(repoRoot, 'apps/liora/test'),
  join(repoRoot, 'packages/node-sdk/src'),
  join(repoRoot, 'packages/node-sdk/test'),
];

const IGNORED_DIR_NAMES = new Set(['node_modules', 'dist', '.tmp-api-extractor', 'coverage']);

const IMPORT_SPECIFIER =
  /(?:import|export)\s+(?:type\s+)?(?:[\w*{}\s,$]+\s+from\s+)?['"]([^'"]+)['"]/g;
const DYNAMIC_IMPORT_SPECIFIER = /\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/g;

/** @param {string} specifier */
function legacyDualPathViolation(specifier) {
  if (specifier === '#/ultrawork' || specifier.startsWith('#/ultrawork/')) {
    return 'use #/mission (or @superliora/sdk/mission from apps/liora)';
  }
  if (specifier === '#/collaboration' || specifier.startsWith('#/collaboration/')) {
    return 'use #/fleet (or @superliora/sdk/fleet from apps/liora)';
  }
  if (
    specifier === '@superliora/agent-core/ultrawork' ||
    specifier.startsWith('@superliora/agent-core/ultrawork/')
  ) {
    return 'use @superliora/agent-core/mission';
  }
  if (
    specifier === '@superliora/agent-core/collaboration' ||
    specifier.startsWith('@superliora/agent-core/collaboration/')
  ) {
    return 'use @superliora/agent-core/fleet';
  }
  if (specifier === '@superliora/sdk/ultrawork' || specifier.startsWith('@superliora/sdk/ultrawork/')) {
    return 'use @superliora/sdk/mission';
  }
  if (
    specifier === '@superliora/sdk/collaboration' ||
    specifier.startsWith('@superliora/sdk/collaboration/')
  ) {
    return 'use @superliora/sdk/fleet';
  }
  return undefined;
}

/** @param {string} dir @returns {string[]} */
function walk(dir) {
  const files = [];
  for (const entry of readdirSync(dir)) {
    const entryPath = join(dir, entry);
    const stats = statSync(entryPath);
    if (stats.isDirectory()) {
      if (IGNORED_DIR_NAMES.has(entry)) continue;
      files.push(...walk(entryPath));
      continue;
    }
    if (/\.(ts|tsx|mts|cts|mjs)$/.test(entry)) {
      files.push(entryPath);
    }
  }
  return files;
}

/** @type {string[]} */
const violations = [];

for (const root of SCAN_ROOTS) {
  for (const absPath of walk(root)) {
    const rel = relative(repoRoot, absPath).replaceAll('\\', '/');
    const lines = readFileSync(absPath, 'utf8').split('\n');
    for (let i = 0; i < lines.length; i += 1) {
      const line = lines[i] ?? '';
      if (line.trimStart().startsWith('//')) continue;
      for (const pattern of [IMPORT_SPECIFIER, DYNAMIC_IMPORT_SPECIFIER]) {
        pattern.lastIndex = 0;
        let match;
        while ((match = pattern.exec(line)) !== null) {
          const hint = legacyDualPathViolation(match[1]);
          if (hint !== undefined) {
            violations.push(`${rel}:${i + 1}: legacy import "${match[1]}" — ${hint}`);
          }
        }
      }
    }
  }
}

if (violations.length === 0) {
  console.log('mission/fleet dual-path check: no violations in apps/liora or packages/node-sdk.');
  process.exit(0);
}

const header = failOnViolation
  ? 'mission/fleet dual-path check FAILED:'
  : 'mission/fleet dual-path check WARNINGS (non-blocking):';
console[failOnViolation ? 'error' : 'warn'](header);
for (const violation of violations) {
  console[failOnViolation ? 'error' : 'warn'](`- ${violation}`);
}
console[failOnViolation ? 'error' : 'warn'](`Total: ${violations.length}`);
process.exit(failOnViolation ? 1 : 0);
