import { builtinModules } from 'node:module';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { resolve as resolvePath } from 'node:path';

import { appRoot, nativeJsBundlePath } from './paths.mjs';

const bundlePath = nativeJsBundlePath();
const text = readFileSync(bundlePath, 'utf-8');

const builtins = new Set([
  ...builtinModules,
  ...builtinModules.map((name) => `node:${name}`),
]);

const optionalRuntimeRequires = new Set([
  'ajv-formats/dist/formats',
  'ajv/dist/runtime/validation_error',
  '@playwright/test',
  'bufferutil',
  'canvas',
  'chromium-bidi/lib/cjs/bidiMapper/BidiMapper',
  'chromium-bidi/lib/cjs/cdp/CdpConnection',
  'chokidar',
  'cpu-features',
  'electron',
  'electron/index.js',
  'fast-json-stringify/lib/serializer',
  'fast-json-stringify/lib/validator',
  'fsevents',
  'mmdb-lib',
  'playwright',
  'socks-proxy-agent',
  'utf-8-validate',
]);
const optionalRelativeRuntimeRequires = new Set(['./crypto/build/Release/sshcrypto.node']);
const handledNativeRuntimeRequires = new Set(['koffi']);

function isAllowedSpecifier(specifier) {
  if (builtins.has(specifier) || specifier.startsWith('node:')) return true;
  if (optionalRuntimeRequires.has(specifier)) return true;
  if (handledNativeRuntimeRequires.has(specifier)) return true;
  return false;
}

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

for (const line of executableLines()) {
  for (const match of line.matchAll(/\brequire\(\s*["']([^"']+)["']\s*\)/g)) {
    const specifier = match[1];
    if (specifier.startsWith('.') || specifier.startsWith('/')) {
      if (optionalRelativeRuntimeRequires.has(specifier)) continue;
      errors.push(`relative require remains: ${specifier}`);
      continue;
    }
    if (!isAllowedSpecifier(specifier)) {
      errors.push(`external require remains: ${specifier}`);
    }
  }

  for (const match of line.matchAll(/(?<![.\w])import\(\s*["']([^"']+)["']\s*\)/g)) {
    const specifier = match[1];
    if (specifier.startsWith('.') || specifier.startsWith('/')) {
      errors.push(`relative dynamic import remains: ${specifier}`);
      continue;
    }
    if (!isAllowedSpecifier(specifier)) {
      errors.push(`external dynamic import remains: ${specifier}`);
    }
  }

  if (line.startsWith('import ')) {
    for (const match of line.matchAll(/\bfrom\s+["']([^"']+)["']/g)) {
      const specifier = match[1];
      if (specifier.startsWith('.') || specifier.startsWith('/')) {
        errors.push(`relative import remains: ${specifier}`);
        continue;
      }
      if (!isAllowedSpecifier(specifier)) {
        errors.push(`external import remains: ${specifier}`);
      }
    }
  }
}

// SEA embeds the JS snapshot only; persona JSON must still exist next to the
// CLI dist (copied before SEA packaging) for hydrate at runtime / packaging.
const personasPath = resolvePath(appRoot, 'dist', 'catalog-personas.json');
if (!existsSync(personasPath)) {
  errors.push(
    `missing apps/liora/dist/catalog-personas.json (run scripts/copy-expert-personas.mjs before SEA packaging)`,
  );
} else {
  const size = statSync(personasPath).size;
  if (size < 1_000) {
    errors.push(`apps/liora/dist/catalog-personas.json is too small (${size} bytes)`);
  }
}

if (errors.length > 0) {
  console.error(`Native JS bundle check failed for ${bundlePath}:`);
  for (const error of errors) {
    console.error(`- ${error}`);
  }
  process.exit(1);
}
