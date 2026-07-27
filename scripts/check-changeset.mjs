#!/usr/bin/env node
// Changeset presence gate: product code changes on a branch require a .changeset entry.
// Usage: node scripts/check-changeset.mjs [--base <ref>]   (default base: origin/main)
// Exempt: docs/scripts/meta-only changes, test-only changes.
import { spawnSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const argv = process.argv.slice(2);
const baseIdx = argv.indexOf('--base');
const base = baseIdx >= 0 ? argv[baseIdx + 1] : 'origin/main';
if (baseIdx >= 0 && !base) {
  console.error('check-changeset: --base requires a ref');
  process.exit(2);
}

function git(...args) {
  const res = spawnSync('git', args, { cwd: repoRoot, encoding: 'utf8' });
  if (res.status !== 0) {
    console.error(`check-changeset: git ${args.join(' ')} failed:\n${res.stderr}`);
    process.exit(2);
  }
  return res.stdout.split('\n').filter(Boolean);
}

const changed = git('diff', '--name-only', `${base}...HEAD`);
if (changed.length === 0) {
  console.log('check-changeset: OK (no changes vs ' + base + ')');
  process.exit(0);
}

const isTestOnly = (p) => /(^|\/)(test|tests|__tests__|__fixtures__)\//.test(p) || /\.(test|spec)\.[cm]?[jt]sx?$/.test(p);
const isProduct = (p) => /^(apps|packages)\//.test(p) && !isTestOnly(p) && !p.endsWith('.md');
const productChanges = changed.filter(isProduct);
const changesetAdded = changed.some((p) => p.startsWith('.changeset/') && p.endsWith('.md') && p !== '.changeset/README.md');

if (productChanges.length === 0) {
  console.log('check-changeset: OK (no product code changes)');
  process.exit(0);
}
if (changesetAdded) {
  console.log(`check-changeset: OK (${productChanges.length} product file(s), changeset present)`);
  process.exit(0);
}
console.error(`check-changeset: FAIL — ${productChanges.length} product file(s) changed vs ${base} but no .changeset/*.md entry:`);
for (const p of productChanges.slice(0, 20)) console.error(`  ${p}`);
if (productChanges.length > 20) console.error(`  ... and ${productChanges.length - 20} more`);
console.error('Add one via .agents/skills/gen-changesets/SKILL.md (default minor; major needs explicit approval).');
process.exit(1);
