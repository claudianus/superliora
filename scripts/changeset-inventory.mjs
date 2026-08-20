#!/usr/bin/env node
/**
 * Report pending .changeset/*.md inventory. These files are unreleased
 * changelog notes; they are consumed only by a version cut (`changeset version`),
 * which this repo does not run on merge.
 *
 * Usage:
 *   node scripts/changeset-inventory.mjs
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const repoRoot = resolve(import.meta.dirname, '..');
const dir = join(repoRoot, '.changeset');
const files = readdirSync(dir)
  .filter((name) => name.endsWith('.md') && name !== 'README.md')
  .toSorted((a, b) => a.localeCompare(b));

const packages = new Map();
let malformed = 0;
for (const name of files) {
  const text = readFileSync(join(dir, name), 'utf8');
  const match = text.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (match === null) {
    malformed += 1;
    continue;
  }
  for (const line of match[1].split('\n')) {
    const pkg = line.match(/^['"]([^'"]+)['"]\s*:/);
    if (pkg === null) continue;
    packages.set(pkg[1], (packages.get(pkg[1]) ?? 0) + 1);
  }
}

console.log(`changeset-inventory: ${files.length} pending file(s), ${malformed} missing frontmatter`);
const ranked = [...packages.entries()].toSorted((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
for (const [name, count] of ranked.slice(0, 20)) {
  console.log(`  ${count}\t${name}`);
}
if (ranked.length > 20) {
  console.log(`  … ${ranked.length - 20} more packages`);
}
console.log(
  'These notes stay until a release operator runs a version cut. Do not delete them to "clean up".',
);
process.exit(malformed > 0 ? 1 : 0);
