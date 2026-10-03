#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const appRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const bundlePath = resolve(appRoot, 'dist', 'main.mjs');

const text = readFileSync(bundlePath, 'utf-8');
const errors = [];

function executableLines() {
  return text
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => {
      if (line.length === 0) return false;
      if (line.startsWith('*') || line.startsWith('//') || line.startsWith('/*')) return false;
      return true;
    });
}

function inspectImportLine(line) {
  if (!line.startsWith('import ') && !line.includes('require(') && !line.includes('import(')) {
    return;
  }

  for (const match of line.matchAll(/(?:from|import\(|require\()\s*["']([^"']+)["']/g)) {
    const specifier = match[1];
    if (specifier.startsWith('@superliora/')) {
      errors.push(`workspace package must be bundled, not imported at runtime: ${specifier}`);
    }
  }
}

for (const line of executableLines()) {
  inspectImportLine(line);
}

if (errors.length > 0) {
  console.error(`CLI bundle check failed for ${bundlePath}:`);
  for (const error of errors) {
    console.error(`- ${error}`);
  }
  process.exit(1);
}

console.log(`CLI bundle check passed: ${bundlePath}`);
