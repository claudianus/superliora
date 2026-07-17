#!/usr/bin/env node
/**
 * Copy expert persona bodies next to dist/main.mjs.
 *
 * The CLI bundle inlines catalog-persona-loader but keeps persona JSON external
 * (lazy hydrate, ~4MB). createRequire(import.meta.url) inside the bundle
 * resolves relative to dist/main.mjs, so the JSON must sit beside it.
 */
import { copyFileSync, existsSync, mkdirSync, statSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const appRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const repoRoot = resolve(appRoot, '../..');
const source = resolve(
  repoRoot,
  'packages/agent-core/src/expert-agents/catalog-personas.json',
);
const destDir = resolve(appRoot, 'dist');
const dest = resolve(destDir, 'catalog-personas.json');

if (!existsSync(source)) {
  console.error(
    `Expert personas missing at ${source}. Run \`pnpm run build:expert-catalog\` first.`,
  );
  process.exit(1);
}

mkdirSync(destDir, { recursive: true });
copyFileSync(source, dest);

const bytes = statSync(dest).size;
if (bytes < 1_000) {
  console.error(`Expert personas copy looks empty (${bytes} bytes): ${dest}`);
  process.exit(1);
}

console.log(`Copied expert personas → ${dest} (${bytes} bytes)`);
