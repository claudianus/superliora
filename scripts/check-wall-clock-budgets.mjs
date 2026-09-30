#!/usr/bin/env node
/**
 * Ratchet for absolute wall-clock budgets in tests.
 *
 * `AGENTS.md` forbids asserting performance against an absolute millisecond
 * number: such an assertion describes the machine the suite ran on, not the
 * code under test, so it fails on a loaded CI runner and passes on a laptop
 * with nothing else running. The rule was written down and not enforced, and
 * the debt grew to 87 call sites with no way to see it.
 *
 * This does not try to rewrite them — many encode a real hang threshold, and
 * an absolute threshold is legitimate for hang detection. It holds the count,
 * so the debt cannot grow while it is paid down deliberately, and it prints
 * the current sites so the next pass knows where to start.
 *
 * Usage:
 *   node scripts/check-wall-clock-budgets.mjs
 *   node scripts/check-wall-clock-budgets.mjs --list
 *   node scripts/check-wall-clock-budgets.mjs --update
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { relative, resolve } from 'node:path';
import { globSync } from 'node:fs';

const repoRoot = resolve(import.meta.dirname, '..');
const baselinePath = resolve(repoRoot, 'meta', 'wall-clock-budget-baseline.json');
const update = process.argv.includes('--update');
const list = process.argv.includes('--list');

// A subject that reads as a duration, compared against a bare number.
const TIME_SUBJECT = new RegExp(
  String.raw`\b(elapsed|duration|latency|renderCb|cbMs|takenMs|\w*[Mm]s)\b`,
);
const BUDGET_ASSERT = /toBeLessThan\(\s*([0-9][0-9_]*)\s*\)|toBeLessThan\(\s*([A-Z_][A-Z0-9_]*)\s*\)/g;

function timeSubjectBefore(source, index) {
  // Walk back over the argument text to the identifier the assertion is on.
  const start = Math.max(0, index - 120);
  return source.slice(start, index);
}

const files = globSync('**/*.test.ts', {
  cwd: repoRoot,
  ignore: ['**/node_modules/**', '**/dist/**', '**/.tmp-api-extractor/**'],
});

const sites = [];
for (const file of files) {
  const source = readFileSync(resolve(repoRoot, file), 'utf8');
  for (const match of source.matchAll(BUDGET_ASSERT)) {
    const before = timeSubjectBefore(source, match.index);
    const literal = match[1];
    const named = match[2];
    if (!TIME_SUBJECT.test(before)) continue;
    // A named constant is fine when the test states *why* it is that value and
    // derives it from the work under test; a bare literal is the raw form the
    // rule exists to catch. Named sites are reported separately, not counted.
    if (literal === undefined && named !== undefined) {
      sites.push({ file, line: 0, kind: 'named', label: named });
      continue;
    }
    const upto = source.slice(0, match.index);
    const line = upto.split('\n').length;
    sites.push({ file, line, kind: 'literal', label: literal });
  }
}

const literals = sites.filter((s) => s.kind === 'literal');
const named = sites.filter((s) => s.kind === 'named');

if (list) {
  for (const site of sites) {
    console.log(`${site.file}:${String(site.line)}: ${site.kind} ${site.label}`);
  }
}

const summary =
  `wall-clock budgets: ${String(literals.length)} literal, ` +
  `${String(named.length)} named (baseline ${String(countBaseline())} literal)`;

if (update) {
  writeFileSync(
    baselinePath,
    `${JSON.stringify({ literal: literals.length, updatedAt: new Date().toISOString() }, null, 2)}\n`,
  );
  console.log(`${summary}\nwall-clock budget baseline updated`);
  process.exit(0);
}

console.log(summary);
if (process.env.GITHUB_ACTIONS === 'true') {
  console.log(`::notice title=wall-clock-budgets::${summary}`);
}
const expected = countBaseline();
if (literals.length > expected) {
  console.error(
    'NEW absolute wall-clock budget assertions in tests — assert the cheap path ' +
      'against the expensive one it replaces, not against a millisecond number.',
  );
  for (const site of literals.slice(0, 10)) {
    console.error(`  ${site.file}:${String(site.line)}  < ${site.label}`);
  }
  if (literals.length > 10) console.error(`  ... and ${String(literals.length - 10)} more`);
  process.exit(1);
}
if (literals.length < expected) {
  console.error(
    `wall-clock budget debt shrank to ${String(literals.length)} from ${String(expected)} — ` +
      'ratchet down with: node scripts/check-wall-clock-budgets.mjs --update',
  );
  process.exit(1);
}
console.log('wall-clock budget ratchet: held');

function countBaseline() {
  try {
    return Number(JSON.parse(readFileSync(baselinePath, 'utf8')).literal);
  } catch {
    return literals.length;
  }
}
