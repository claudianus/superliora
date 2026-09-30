#!/usr/bin/env node
/**
 * Report how much headroom each wall-clock budget actually has.
 *
 * The ratchet counts call sites to review. It cannot say which ones are risky,
 * because risk is not the size of the number: `scroll-storm-structural` asserts
 * a 4ms mean frame budget against a measured 0.115ms and has 35x headroom,
 * while a 500ms budget in a file nobody has measured might sit one scheduling
 * hiccup from failing. Ranking by literal made that near-miss explicit.
 *
 * For each affected test file this makes a temporary copy with the budget
 * assertions swapped for a log line, runs it through the CI-parity runner, and
 * reports measured value against budget. The original is never touched: the
 * copy is written beside it (so relative imports still resolve), run, and
 * removed.
 *
 * Usage:
 *   node scripts/measure-wall-clock-headroom.mjs
 *   node scripts/measure-wall-clock-headroom.mjs <substring-to-filter>
 */
import { spawnSync } from 'node:child_process';
import { existsSync, globSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { basename, dirname, resolve } from 'node:path';

const repoRoot = resolve(import.meta.dirname, '..');
const filter = process.argv[2];

const MARK = 'HEADROOM|';
// `expect(<expr>).toBeLessThan(<literal or CONST>)` where <expr> reads as a duration.
const BUDGET = /expect\(([A-Za-z_$][\w$!.?[\]]*)\)\.toBeLessThan\((\d[\d_]*|SCROLL_\w+|HARD_\w+|STORM_\w+|_?[A-Z][A-Z0-9_]*_MS)\)/g;

function testFiles() {
  return globSync('**/*.test.ts', {
    cwd: repoRoot,
    ignore: ['**/node_modules/**', '**/dist/**', '**/.tmp-api-extractor/**'],
  });
}

const files = testFiles()
  .filter((f) => (filter ? f.includes(filter) : true))
  .filter((f) => BUDGET.test(readFileSync(resolve(repoRoot, f), 'utf8')))
  .filter((f) => /\b(ms|elapsed|duration|latency|settleMs|totalMs|renderCb|cbMs)\b/i.test(readFileSync(resolve(repoRoot, f), 'utf8')));
BUDGET.lastIndex = 0;

const results = [];
for (const file of files) {
  const abs = resolve(repoRoot, file);
  const original = readFileSync(abs, 'utf8');
  const probeName = `__headroom-${basename(file)}`;
  const probeAbs = resolve(dirname(abs), probeName);
  const probe = original.replace(BUDGET, (_m, expr, budget) => {
    return `console.log(${JSON.stringify(`${MARK}${file}|${expr}|${budget}|`)} + String(${expr})); void ${budget};`;
  });
  if (probe === original) continue;
  writeFileSync(probeAbs, probe);
  try {
    const run = spawnSync(
      process.execPath,
      [resolve(repoRoot, 'scripts', 'test-local.mjs'), probeName],
      { cwd: dirname(abs), encoding: 'utf8', timeout: 300_000 },
    );
    const out = `${run.stdout ?? ''}\n${run.stderr ?? ''}`;
    for (const line of out.split('\n')) {
      const at = line.indexOf(MARK);
      if (at < 0) continue;
      const [, f, expr, budget, actualRaw] = line.slice(at).split('|');
      const actual = Number(actualRaw);
      const b = Number(budget);
      if (!Number.isFinite(actual) || !Number.isFinite(b) || b <= 0) continue;
      results.push({ file: f, expr, actual, budget: b, headroom: b / Math.max(actual, 1e-6) });
    }
  } finally {
    if (existsSync(probeAbs)) unlinkSync(probeAbs);
  }
}

if (results.length === 0) {
  console.log('no wall-clock budgets measured (files with budgets: ' + String(files.length) + ')');
  process.exit(0);
}

// Least headroom first: those are the ones that can actually fail.
results.sort((a, b) => a.headroom - b.headroom);
console.log('headroom = budget / measured. Low means a slow runner can break it.\n');
console.log('  headroom   measured     budget  file');
for (const r of results.slice(0, 25)) {
  console.log(
    `  ${r.headroom.toFixed(1).padStart(8)}x  ${r.actual.toFixed(3).padStart(9)}ms ${String(r.budget).padStart(8)}  ${r.file}: ${r.expr}`,
  );
}
