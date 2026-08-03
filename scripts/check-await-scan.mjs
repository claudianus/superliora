#!/usr/bin/env node
/**
 * V2-4 await scan — ratchet gate for hot-path await violations in the job tool family.
 *
 * Scans every .ts file under packages/agent-core/src/tools/builtin/job (recursive)
 * for `await launchJobWorker | scheduleQueuedJobs | landJobToMain`, prints each
 * match as `file:line: match`, then prints a summary line.
 *
 * Exit code: 1 when the total exceeds BASELINE, else 0. Lower BASELINE as
 * violations are removed; never raise it without a gate decision.
 *
 * BASELINE history:
 *   9 — measured on the current tree (4x launchJobWorker, 4x scheduleQueuedJobs,
 *       1x landJobToMain). The earlier "6" estimate (reports/2026-08-03-v2-gate-evidence.md)
 *       predated counting scheduleQueuedJobs awaits.
 *
 * Usage (from the repository root):
 *   node scripts/check-await-scan.mjs
 */
import { readdir, readFile } from 'node:fs/promises';
import { join, relative } from 'node:path';

const BASELINE = 9;

const PATTERN = /(await\s+(launchJobWorker|scheduleQueuedJobs|landJobToMain))\b/g;

const repoRoot = process.cwd();
const scanRoot = join(repoRoot, 'packages', 'agent-core', 'src', 'tools', 'builtin', 'job');

async function collectTypeScriptFiles(dir) {
  const found = [];
  const entries = await readdir(dir, { withFileTypes: true });
  entries.sort((a, b) => a.name.localeCompare(b.name));
  for (const entry of entries) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      found.push(...(await collectTypeScriptFiles(full)));
    } else if (entry.isFile() && entry.name.endsWith('.ts')) {
      found.push(full);
    }
  }
  return found;
}

const files = await collectTypeScriptFiles(scanRoot);
let total = 0;

for (const file of files) {
  const content = await readFile(file, 'utf8');
  PATTERN.lastIndex = 0;
  let match;
  while ((match = PATTERN.exec(content)) !== null) {
    const line = content.slice(0, match.index).split('\n').length;
    const text = match[1].replaceAll(/\s+/g, ' ');
    console.log(`${relative(repoRoot, file)}:${line}: ${text}`);
    total += 1;
  }
}

const status = total > BASELINE ? 'FAIL' : 'OK';
console.log(`await-scan: violations=${total} baseline=${BASELINE} status=${status}`);
if (total > BASELINE) {
  process.exit(1);
}
