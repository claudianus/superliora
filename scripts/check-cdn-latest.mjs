#!/usr/bin/env node
/**
 * Gate: repo CDN tip files must match the published CLI package version.
 *
 * Asserts:
 *   latest (plain text) === latest.json.version === apps/liora/package.json#version
 *
 * Usage: node scripts/check-cdn-latest.mjs
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const repoRoot = resolve(import.meta.dirname, '..');

function readText(rel) {
  return readFileSync(resolve(repoRoot, rel), 'utf8');
}

const packageVersion = JSON.parse(readText('apps/liora/package.json')).version;
if (typeof packageVersion !== 'string' || packageVersion.length === 0) {
  console.error('check-cdn-latest: apps/liora/package.json missing version');
  process.exit(1);
}

const latestPlain = readText('latest').trim();
let latestJson;
try {
  latestJson = JSON.parse(readText('latest.json'));
} catch (error) {
  console.error(
    `check-cdn-latest: latest.json is not valid JSON: ${
      error instanceof Error ? error.message : String(error)
    }`,
  );
  process.exit(1);
}

const latestJsonVersion =
  typeof latestJson?.version === 'string' ? latestJson.version.trim() : '';

const mismatches = [];
if (latestPlain !== packageVersion) {
  mismatches.push(`latest=${JSON.stringify(latestPlain)} (want ${packageVersion})`);
}
if (latestJsonVersion !== packageVersion) {
  mismatches.push(
    `latest.json.version=${JSON.stringify(latestJsonVersion)} (want ${packageVersion})`,
  );
}

if (mismatches.length > 0) {
  console.error('check-cdn-latest: FAIL — CDN tip files drift from @superliora/liora version:');
  for (const line of mismatches) console.error(`  ${line}`);
  console.error(
    'Keep `latest`, `latest.json`, and apps/liora/package.json#version identical on every release bump.',
  );
  process.exit(1);
}

console.log(`check-cdn-latest: OK (${packageVersion})`);
