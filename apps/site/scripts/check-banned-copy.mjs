#!/usr/bin/env node
/**
 * Fail if public site/README copy resurrects retired product language.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../../..', import.meta.url));
const siteSrc = join(root, 'apps/site/src');
const targets = [
  siteSrc,
  join(root, 'README.md'),
  join(root, 'README.ko.md'),
  join(root, 'apps/site/index.html'),
  join(root, 'apps/site/en/index.html'),
];

const banned = [
  { re: /\bultrawork\b/i, label: 'ultrawork' },
  { re: /\bblood\s*moon\b/i, label: 'blood moon' },
  { re: /#E63946|#E8414E/i, label: 'blood moon hex' },
  { re: /\/mission\b/i, label: '/mission' },
  { re: /\/ultrawork\b/i, label: '/ultrawork' },
  { re: /\bultraswarm\b/i, label: 'ultraswarm' },
  { re: /\bllm\s*wiki\b/i, label: 'llm wiki' },
  { re: /\bliora\s*memory\b/i, label: 'liora memory' },
  { re: /\b128\s+(specialist\s+)?(sub)?agents?\b/i, label: '128 agents' },
];

// Allow "Mission" only inside comments pointing at retired naming? Prefer zero.
banned.push({ re: /\bMission\s+mode\b/i, label: 'Mission mode' });
banned.push({ re: /\bMission\s+Control\b/i, label: 'Mission Control' });

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name === 'dist') continue;
    const p = join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) walk(p, out);
    else if (/\.(tsx?|jsx?|html|md|css)$/.test(name)) out.push(p);
  }
  return out;
}

const files = [];
for (const t of targets) {
  try {
    const st = statSync(t);
    if (st.isDirectory()) walk(t, files);
    else files.push(t);
  } catch {
    // missing optional path
  }
}

const failures = [];
for (const file of files) {
  const text = readFileSync(file, 'utf8');
  for (const { re, label } of banned) {
    if (re.test(text)) {
      failures.push(`${relative(root, file)}: ${label}`);
    }
  }
}

if (failures.length > 0) {
  console.error('check-banned-copy: FAIL');
  for (const f of failures) console.error(`  ${f}`);
  process.exit(1);
}

console.log(`check-banned-copy: PASS (${String(files.length)} files)`);
