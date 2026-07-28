#!/usr/bin/env node
// Test baseline ratchet: known-failing tests are pinned in meta/test-baseline.yaml.
// - A failure NOT in the baseline        -> exit 1 (new regression).
// - A baseline failure that now passes   -> exit 1 (ratchet: run --update, commit the smaller list).
// - Tests in `unstable` may pass or fail -> warning only (determinism debt, visible).
// Usage:
//   node scripts/check-test-baseline.mjs            # check all packages
//   node scripts/check-test-baseline.mjs --update   # rewrite baseline from current runs
//   node scripts/check-test-baseline.mjs --list     # print baseline and exit
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const baselinePath = join(repoRoot, 'meta', 'test-baseline.yaml');
const args = new Set(process.argv.slice(2));
const UPDATE = args.has('--update');
const LIST = args.has('--list');

// ---- minimal YAML for the fixed schema (no external dep) ----
function parseBaseline(text) {
  const out = { version: 1, packages: [] };
  let pkg = null;
  let listKey = null;
  for (const raw of text.split('\n')) {
    const line = raw.replace(/#.*$/, '').trimEnd();
    if (!line.trim()) continue;
    let m;
    if ((m = line.match(/^version:\s*(\d+)$/))) {
      out.version = Number(m[1]);
    } else if (/^packages:\s*$/.test(line)) {
      continue;
    } else if ((m = line.match(/^\s*-\s*dir:\s*(\S+)$/))) {
      pkg = { dir: m[1], runner: 'vitest', failures: [], unstable: [] };
      out.packages.push(pkg);
      listKey = null;
    } else if ((m = line.match(/^\s*runner:\s*(\S+)$/)) && pkg) {
      pkg.runner = m[1];
      listKey = null;
    } else if ((m = line.match(/^\s*(failures|unstable):\s*(.*)$/)) && pkg) {
      listKey = m[1];
      const inline = m[2].trim();
      if (inline && inline !== '[]') throw new Error(`inline lists not supported: ${line}`);
    } else if ((m = line.match(/^\s*-\s*"((?:[^"\\]|\\.)*)"\s*$/)) && pkg && listKey) {
      pkg[listKey].push(m[1].replace(/\\"/g, '"').replace(/\\\\/g, '\\'));
    } else if ((m = line.match(/^\s*-\s*'([^']*)'\s*$/)) && pkg && listKey) {
      pkg[listKey].push(m[1]);
    } else {
      throw new Error(`unparseable baseline line: ${JSON.stringify(raw)}`);
    }
  }
  return out;
}

function emitBaseline(baseline) {
  const esc = (s) => `"${s.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
  const lines = ['# Test baseline ratchet — expected failures. Update only via:', '#   node scripts/check-test-baseline.mjs --update', 'version: 1', 'packages:'];
  for (const pkg of baseline.packages) {
    lines.push(`  - dir: ${pkg.dir}`, `    runner: ${pkg.runner}`, '    failures:');
    if (pkg.failures.length === 0) lines[lines.length - 1] = '    failures: []';
    for (const f of [...pkg.failures].sort()) lines.push(`      - ${esc(f)}`);
    lines.push('    unstable:');
    if ((pkg.unstable ?? []).length === 0) lines[lines.length - 1] = '    unstable: []';
    for (const u of [...(pkg.unstable ?? [])].sort()) lines.push(`      - ${esc(u)}`);
  }
  return lines.join('\n') + '\n';
}

// ---- test running ----
function runVitest(dir) {
  const tmp = mkdtempSync(join(tmpdir(), 'test-baseline-'));
  const outFile = join(tmp, 'results.json');
  const res = spawnSync('pnpm', ['exec', 'vitest', 'run', '--reporter=json', `--outputFile=${outFile}`], {
    cwd: join(repoRoot, dir),
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, NO_COLOR: '1' },
  });
  let failed = [];
  let totals = null;
  try {
    const j = JSON.parse(readFileSync(outFile, 'utf8'));
    totals = { total: j.numTotalTests, passed: j.numPassedTests, failed: j.numFailedTests };
    for (const tr of j.testResults ?? []) {
      for (const ar of tr.assertionResults ?? []) {
        if (ar.status === 'failed') failed.push(ar.fullName ?? ar.title ?? '<unknown>');
      }
    }
  } catch (err) {
    rmSync(tmp, { recursive: true, force: true });
    console.error(`[${dir}] could not parse vitest JSON (exit ${res.status}): ${err.message}`);
    console.error(res.stderr?.slice(-2000) ?? '');
    process.exit(2);
  }
  rmSync(tmp, { recursive: true, force: true });
  failed.sort();
  return { failed, totals };
}

// ---- main ----
const baseline = parseBaseline(readFileSync(baselinePath, 'utf8'));
if (LIST) {
  process.stdout.write(emitBaseline(baseline));
  process.exit(0);
}

let problems = 0;
for (const pkg of baseline.packages) {
  const { failed, totals } = runVitest(pkg.dir);
  const expected = new Set(pkg.failures);
  const unstable = new Set(pkg.unstable ?? []);
  const known = new Set([...expected, ...unstable]);
  const regressions = failed.filter((f) => !known.has(f));
  const fixed = pkg.failures.filter((f) => !failed.includes(f));
  const unstablePassed = (pkg.unstable ?? []).filter((f) => !failed.includes(f));
  console.log(`[${pkg.dir}] ${totals.passed}/${totals.total} passed, ${failed.length} failed (baseline ${expected.size}, unstable ${unstable.size})`);
  if (regressions.length > 0) {
    problems++;
    console.error(`  NEW FAILURES (${regressions.length}) — fix the code, then re-run:`);
    for (const f of regressions) console.error(`    + ${f}`);
  }
  if (fixed.length > 0) {
    problems++;
    console.error(`  FIXED BUT PINNED (${fixed.length}) — ratchet down: node scripts/check-test-baseline.mjs --update, then commit meta/test-baseline.yaml:`);
    for (const f of fixed) console.error(`    - ${f}`);
  }
  if (unstablePassed.length > 0) {
    console.warn(`  UNSTABLE NOW PASSING (${unstablePassed.length}) — determinism debt, consider removing from unstable after a fix:`);
    for (const f of unstablePassed) console.warn(`    ~ ${f}`);
  }
  if (UPDATE) {
    pkg.failures = failed.filter((f) => !unstable.has(f));
  }
}

if (UPDATE) {
  writeFileSync(baselinePath, emitBaseline(baseline));
  console.log(`baseline updated: ${baselinePath}`);
  process.exit(0);
}
if (problems > 0) {
  console.error(`test-baseline: FAIL (${problems} package(s) with drift)`);
  process.exit(1);
}
console.log('test-baseline: OK (no regressions, no unrecorded fixes)');
