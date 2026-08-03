#!/usr/bin/env node
/**
 * Retirement guardrail check for the V6 retirement wave.
 *
 * Registry: docs/specs/2026-08-03-retirement-registry.yaml
 *
 * For every item with `status: done`:
 *   - replacement_proof_tests files must exist on disk
 *   - grep_zero regexes must have zero matches under packages/<pkg>/src and
 *     apps/<app>/src (test files excluded)
 *   - retro_guard_needed: true emits a warning only
 * Items with `status: partial` run the same checks report-only (deferred to
 * the R7 sweep). in_progress/pending items are not enforced.
 *
 * Usage: node scripts/check-retire-guardrails.mjs
 */
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';

const repoRoot = resolve(import.meta.dirname, '..');
const registryRel = 'docs/specs/2026-08-03-retirement-registry.yaml';
const registryPath = join(repoRoot, registryRel);

const KNOWN_STATUSES = new Set(['done', 'partial', 'in_progress', 'pending']);
const IGNORED_DIR_NAMES = new Set([
  'node_modules',
  'dist',
  'coverage',
  '.git',
  '.tmp-api-extractor',
  'test',
  'tests',
  '__tests__',
  '__mocks__',
  'fixtures',
]);
const TEST_FILE_NAME = /\.(test|spec)\./;
const SOURCE_FILE_NAME = /\.(ts|tsx|mts|cts|js|jsx|mjs|cjs)$/;

// ---------------------------------------------------------------------------
// Minimal YAML subset parser (the registry format is owned by this script).
// Supports: top-level scalars, an `items:` list of flat maps, inline `[]`
// lists, single/double-quoted scalars, and trailing `# comments`.
// ---------------------------------------------------------------------------

/** @param {string} text @param {number} start @returns {[string, number]} */
function readQuoted(text, start) {
  const quote = text[start];
  let out = '';
  let i = start + 1;
  while (i < text.length) {
    const ch = text[i];
    if (quote === "'") {
      if (ch === "'") {
        if (text[i + 1] === "'") {
          out += "'";
          i += 2;
          continue;
        }
        return [out, i + 1];
      }
      out += ch;
      i += 1;
      continue;
    }
    if (ch === '\\') {
      out += text[i + 1] ?? '';
      i += 2;
      continue;
    }
    if (ch === '"') return [out, i + 1];
    out += ch;
    i += 1;
  }
  throw new Error('unterminated quoted string');
}

/** @param {string} text @param {number} start @returns {[unknown[], number]} */
function readInlineList(text, start) {
  const values = [];
  let i = start + 1;
  while (i < text.length) {
    while (i < text.length && /[\s,]/.test(text[i] ?? '')) i += 1;
    const ch = text[i];
    if (ch === ']') return [values, i + 1];
    if (ch === "'" || ch === '"') {
      const [value, next] = readQuoted(text, i);
      values.push(value);
      i = next;
      continue;
    }
    let j = i;
    while (j < text.length && text[j] !== ',' && text[j] !== ']') j += 1;
    const token = text.slice(i, j).trim();
    if (token.length > 0) values.push(token);
    i = j;
  }
  throw new Error('unterminated inline list');
}

/** @param {string} raw @returns {unknown} */
function parseValue(raw) {
  const text = raw.trim();
  if (text.startsWith('[')) return readInlineList(text, 0)[0];
  if (text.startsWith("'") || text.startsWith('"')) return readQuoted(text, 0)[0];
  const commentAt = text.search(/\s#/);
  const plain = (commentAt === -1 ? text : text.slice(0, commentAt)).trim();
  if (plain === '' || plain === 'null' || plain === '~') return null;
  if (plain === 'true') return true;
  if (plain === 'false') return false;
  if (/^\d+$/.test(plain)) return Number(plain);
  return plain;
}

/** @param {string} text @returns {{ meta: Record<string, unknown>, items: Record<string, unknown>[] }} */
function parseRegistry(text) {
  const meta = {};
  const items = [];
  let current = null;
  for (const rawLine of text.split('\n')) {
    const line = rawLine.replace(/\r$/, '');
    const trimmed = line.trim();
    if (trimmed === '' || trimmed.startsWith('#')) continue;
    const itemStart = line.match(/^\s*-\s+([A-Za-z_][\w-]*):\s*(.*)$/);
    if (itemStart) {
      current = {};
      items.push(current);
      current[itemStart[1] ?? ''] = parseValue(itemStart[2] ?? '');
      continue;
    }
    const field = line.match(/^\s+([A-Za-z_][\w-]*):\s*(.*)$/);
    if (field && current) {
      current[field[1] ?? ''] = parseValue(field[2] ?? '');
      continue;
    }
    const top = line.match(/^([A-Za-z_][\w-]*):\s*(.*)$/);
    if (top) {
      if (top[1] === 'items' && (top[2] ?? '').trim() === '') continue;
      if (!current) meta[top[1] ?? ''] = parseValue(top[2] ?? '');
    }
  }
  return { meta, items };
}

// ---------------------------------------------------------------------------
// Source scan: packages/<pkg>/src and apps/<app>/src, test files excluded.
// ---------------------------------------------------------------------------

function collectScanRoots() {
  const roots = [];
  for (const group of ['packages', 'apps']) {
    const groupDir = join(repoRoot, group);
    if (!existsSync(groupDir)) continue;
    for (const entry of readdirSync(groupDir)) {
      const srcDir = join(groupDir, entry, 'src');
      if (existsSync(srcDir) && statSync(srcDir).isDirectory()) roots.push(srcDir);
    }
  }
  return roots;
}

/** @param {string} dir @param {string[]} out */
function walkSources(dir, out) {
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    if (IGNORED_DIR_NAMES.has(entry.name)) continue;
    const entryPath = join(dir, entry.name);
    let isDir = entry.isDirectory();
    let isFile = entry.isFile();
    if (entry.isSymbolicLink()) {
      try {
        const stats = statSync(entryPath);
        isDir = stats.isDirectory();
        isFile = stats.isFile();
      } catch {
        continue; // broken symlink
      }
    }
    if (isDir) {
      walkSources(entryPath, out);
      continue;
    }
    if (!isFile) continue;
    if (TEST_FILE_NAME.test(entry.name)) continue;
    if (SOURCE_FILE_NAME.test(entry.name)) out.push(entryPath);
  }
}

/** @param {{ rel: string, lines: string[] }[]} sources @param {string} pattern */
function grepZero(sources, pattern) {
  let regex;
  try {
    regex = new RegExp(pattern);
  } catch (err) {
    return { error: `invalid regex: ${err instanceof Error ? err.message : String(err)}` };
  }
  const hits = [];
  for (const source of sources) {
    for (let i = 0; i < source.lines.length; i += 1) {
      if (regex.test(source.lines[i] ?? '')) hits.push(`${source.rel}:${i + 1}`);
    }
  }
  return { hits };
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

if (!existsSync(registryPath)) {
  console.error(`retire-guardrails: registry not found: ${registryRel}`);
  process.exit(2);
}

let registry;
try {
  registry = parseRegistry(readFileSync(registryPath, 'utf8'));
} catch (err) {
  console.error(`retire-guardrails: failed to parse ${registryRel}: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(2);
}

const { meta, items } = registry;
if (meta.version !== 1) {
  console.error(`retire-guardrails: unsupported registry version: ${String(meta.version)}`);
  process.exit(2);
}

const registryErrors = [];
const seenIds = new Set();
for (const item of items) {
  const id = item.id;
  if (typeof id !== 'string' || id.length === 0) {
    registryErrors.push('item without an id');
    continue;
  }
  if (seenIds.has(id)) registryErrors.push(`duplicate item id: ${id}`);
  seenIds.add(id);
  if (!KNOWN_STATUSES.has(String(item.status))) {
    registryErrors.push(`${id}: unknown status "${String(item.status)}"`);
  }
}

const scanRoots = collectScanRoots();
const sourceFiles = [];
for (const root of scanRoots) walkSources(root, sourceFiles);
const sources = sourceFiles.map((file) => ({
  rel: relative(repoRoot, file).replaceAll('\\', '/'),
  lines: readFileSync(file, 'utf8').split('\n'),
}));

console.log(`retirement registry: ${registryRel} (${items.length} items)`);
console.log(`scan scope: ${scanRoots.length} src roots, ${sources.length} source files (test files excluded)`);

/** @param {Record<string, unknown>} item */
function checkDoneItem(item) {
  const notes = [];
  const problems = [];

  const rawProof = item.replacement_proof_tests;
  const proofTests = Array.isArray(rawProof) ? rawProof : rawProof ? [rawProof] : [];
  let present = 0;
  for (const testPath of proofTests) {
    if (typeof testPath === 'string' && existsSync(join(repoRoot, testPath))) {
      present += 1;
    } else {
      problems.push(`replacement proof test missing: ${String(testPath)}`);
    }
  }
  notes.push(`proof tests: ${present}/${proofTests.length} present`);

  if (item.retro_guard_needed === true) {
    notes.push('WARNING: retro_guard_needed — deleted without characterization tests; hardening tests must land in the R7 sweep');
  }

  const rawPatterns = item.grep_zero;
  const patterns = Array.isArray(rawPatterns) ? rawPatterns : rawPatterns ? [rawPatterns] : [];
  let totalHits = 0;
  for (const pattern of patterns) {
    const text = String(pattern);
    const { hits, error } = grepZero(sources, text);
    if (error) {
      problems.push(`grep_zero "${text}": ${error}`);
      continue;
    }
    totalHits += hits.length;
    if (hits.length > 0) {
      problems.push(`grep_zero "${text}" has ${hits.length} hit(s) in src:`);
      for (const hit of hits.slice(0, 10)) problems.push(`    ${hit}`);
      if (hits.length > 10) problems.push(`    … ${hits.length - 10} more`);
    }
  }
  if (patterns.length > 0) notes.push(`grep_zero: ${patterns.length} pattern(s), ${totalHits} hit(s) in src`);

  return { notes, problems };
}

let failedItems = 0;
for (const item of items) {
  const id = String(item.id ?? '<unnamed>');
  const status = String(item.status);
  const commit = item.commit == null ? '' : ` commit=${String(item.commit)}`;
  if (status !== 'done' && status !== 'partial') {
    console.log(`[${id}] status=${status} — not enforced yet`);
    continue;
  }
  const enforce = status === 'done';
  const { notes, problems } = checkDoneItem(item);
  console.log(`[${id}] status=${status}${commit}`);
  for (const note of notes) console.log(`  ${note}`);
  if (problems.length === 0) {
    console.log(enforce ? '  OK' : '  PARTIAL — deferred, no enforcement until status moves to done');
    continue;
  }
  for (const problem of problems) console.log(`  ${problem}`);
  if (enforce) {
    console.log('  FAIL');
    failedItems += 1;
  } else {
    console.log('  PARTIAL — deferred, problems recorded for the R7 sweep');
  }
}

if (registryErrors.length > 0 || failedItems > 0) {
  for (const error of registryErrors) console.error(`registry error: ${error}`);
  console.error(`retire-guardrails: FAIL (${registryErrors.length} registry error(s), ${failedItems} failed item(s))`);
  process.exit(1);
}
console.log('retire-guardrails: PASS');
