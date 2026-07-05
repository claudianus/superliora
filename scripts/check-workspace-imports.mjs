#!/usr/bin/env node
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');

const VALID_SUPERLIORA_PACKAGES = new Set([
  '@superliora/acp-adapter',
  '@superliora/agent-core',
  '@superliora/gui-use',
  '@superliora/kaos',
  '@superliora/kosong',
  '@superliora/liora',
  '@superliora/monorepo',
  '@superliora/oauth',
  '@superliora/protocol',
  '@superliora/sdk',
  '@superliora/server',
  '@superliora/server-e2e',
  '@superliora/telemetry',
  '@superliora/vis',
  '@superliora/vis-server',
  '@superliora/vis-web',
]);

const FORBIDDEN_SPECIFIER_PATTERNS = [
  /^@superliora\/superliora-/,
  /^@kimi-code\//,
];

const SOURCE_ROOTS = [
  'packages',
  'apps/liora/src',
  'apps/liora/test',
  'apps/vis/src',
  'apps/vis/server/src',
  'apps/vis/web/src',
  'scripts',
];

const IGNORED_DIR_NAMES = new Set([
  'dist',
  'node_modules',
  '.tmp-api-extractor',
  'coverage',
]);

const SOURCE_EXTENSIONS = new Set(['.ts', '.tsx', '.mts', '.cts', '.mjs', '.js']);

const IMPORT_SPECIFIER = /(?:import|export)\s+(?:type\s+)?(?:[\w*{}\s,$]+\s+from\s+)?['"]([^'"]+)['"]/g;
const REQUIRE_SPECIFIER = /\brequire\s*\(\s*['"]([^'"]+)['"]\s*\)/g;
const DYNAMIC_IMPORT_SPECIFIER = /\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/g;

const errors = [];

function packageNameFromSpecifier(specifier) {
  const match = /^(@[^/]+\/[^/]+)/.exec(specifier);
  return match?.[1];
}

function inspectSpecifier(file, lineNumber, specifier) {
  if (!specifier.startsWith('@superliora/')) {
    return;
  }

  for (const pattern of FORBIDDEN_SPECIFIER_PATTERNS) {
    if (pattern.test(specifier)) {
      errors.push(`${file}:${lineNumber}: forbidden workspace import "${specifier}"`);
      return;
    }
  }

  const packageName = packageNameFromSpecifier(specifier);
  if (packageName !== undefined && !VALID_SUPERLIORA_PACKAGES.has(packageName)) {
    errors.push(
      `${file}:${lineNumber}: unknown @superliora package "${packageName}" in "${specifier}"`,
    );
  }
}

function scanLine(file, lineNumber, line) {
  for (const pattern of [IMPORT_SPECIFIER, REQUIRE_SPECIFIER, DYNAMIC_IMPORT_SPECIFIER]) {
    pattern.lastIndex = 0;
    let match;
    while ((match = pattern.exec(line)) !== null) {
      inspectSpecifier(file, lineNumber, match[1]);
    }
  }
}

function walkDirectory(dir) {
  const files = [];
  for (const entry of readdirSync(dir)) {
    const entryPath = join(dir, entry);
    const stats = statSync(entryPath);
    if (stats.isDirectory()) {
      if (IGNORED_DIR_NAMES.has(entry)) continue;
      files.push(...walkDirectory(entryPath));
      continue;
    }
    const extension = entry.slice(entry.lastIndexOf('.'));
    if (SOURCE_EXTENSIONS.has(extension)) {
      files.push(entryPath);
    }
  }
  return files;
}

function collectSourceFiles() {
  const files = [];
  for (const root of SOURCE_ROOTS) {
    const absoluteRoot = join(repoRoot, root);
    try {
      const stats = statSync(absoluteRoot);
      if (stats.isDirectory()) {
        files.push(...walkDirectory(absoluteRoot));
      }
    } catch {
      // Optional roots may be absent in sparse checkouts.
    }
  }
  return files;
}

for (const file of collectSourceFiles()) {
  const relativePath = relative(repoRoot, file);
  const lines = readFileSync(file, 'utf8').split('\n');
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index] ?? '';
    if (line.trimStart().startsWith('//')) continue;
    scanLine(relativePath, index + 1, line);
  }
}

if (errors.length > 0) {
  console.error('Workspace import check failed:');
  for (const error of errors) {
    console.error(`- ${error}`);
  }
  process.exit(1);
}

console.log('Workspace import check passed.');
