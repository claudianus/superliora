#!/usr/bin/env node
// Local test gate with CI-parity env. Run this before you push — GitHub CI is a
// backstop, not the feedback loop. Interactive TUI/harness (motion + analysis):
// scripts/debug-local.mjs — this runner kills motion on purpose.
//
// Usage:
//   node scripts/test-local.mjs                 # tests related to the changed files (import-graph + export-name matching)
//   node scripts/test-local.mjs --closure       # affected workspaces + dependents (workspace granularity, no name matching)
//   node scripts/test-local.mjs --direct        # changed workspaces only (no dependents)
//   node scripts/test-local.mjs --all           # whole monorepo
//   node scripts/test-local.mjs <path|pattern>  # vitest filters, e.g. apps/liora/test/tui
//   node scripts/test-local.mjs --base HEAD~3   # different comparison base
//   node scripts/test-local.mjs --scope         # print what would run, then exit
//   node scripts/test-local.mjs --env           # print the parity env and exit
//   node scripts/test-local.mjs --self-check    # assert the scope decisions
//
// Any other flag is forwarded to vitest (`--bail=1`, `--reporter=dot`, `-t name`, …).
import { spawnSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { existsSync, mkdtempSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { buildGraph, selectRelatedTests } from './test-scope.mjs';

const repoRoot = resolve(import.meta.dirname, '..');

// Fake package name for the self-check fixture graph. Split so the
// workspace-import checker does not parse it as a real `@superliora/*` import.
const FAKE_PKG_A = '@superliora' + '/a';

// --- CI parity -------------------------------------------------------------
// Every one of these has produced a "green locally, red in CI" failure in this
// repo. A dev shell carries state a GitHub runner does not: `NO_COLOR` and
// `TERM=dumb` silently disable TUI motion, a local timezone hides UTC clock
// assertions, `init.defaultBranch=main` hides bare-repo HEAD assumptions, and
// provider keys let network paths pass that CI cannot reach.
const DELETE_ENV = [
  'NO_COLOR',
  'FORCE_COLOR',
  'TERM',
  'COLORTERM',
  'TERM_PROGRAM',
  'TERM_PROGRAM_VERSION',
  'KITTY_WINDOW_ID',
  'WEZTERM_PANE',
  'GHOSTTY_RESOURCES_DIR',
  'ALACRITTY_WINDOW_ID',
  'WT_SESSION',
  'WT_PROFILE_ID',
  'TMUX',
  'ZELLIJ',
  'SSH_TTY',
  'SSH_CONNECTION',
  'SSH_CLIENT',
];
/** Credentials and host agent state a runner never has. */
const DELETE_ENV_PREFIX = ['KIMI_', 'SUPERLIORA_', 'MOONSHOT_', 'ANTHROPIC_', 'OPENAI_', 'XAI_', 'GEMINI_', 'CURSOR_'];
const DELETE_ENV_MATCH = /API_KEY|_TOKEN|SECRET/;
const nullDevice = process.platform === 'win32' ? 'NUL' : '/dev/null';
const pnpmBin = process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm';
const SET_ENV = {
  CI: 'true',
  GITHUB_ACTIONS: 'true',
  TZ: 'UTC',
  LANG: 'C.UTF-8',
  LC_ALL: 'C.UTF-8',
  // Ubuntu git defaults; keeps `git init` HEAD and identity assumptions honest.
  GIT_CONFIG_GLOBAL: nullDevice,
  GIT_CONFIG_SYSTEM: nullDevice,
  GIT_CONFIG_COUNT: '1',
  GIT_CONFIG_KEY_0: 'init.defaultBranch',
  GIT_CONFIG_VALUE_0: 'master',
};

function parityEnv() {
  const env = { ...process.env };
  for (const key of Object.keys(env)) {
    if (DELETE_ENV.includes(key)) delete env[key];
    else if (DELETE_ENV_PREFIX.some((p) => key.startsWith(p))) delete env[key];
    else if (DELETE_ENV_MATCH.test(key)) delete env[key];
  }
  // Tests must never read or write the operator's real liora home (harness
  // state, oauth cache): point SUPERLIORA_HOME at a per-run temp dir.
  const lioraHome = mkdtempSync(join(tmpdir(), 'superliora-test-home-'));
  return { ...env, ...SET_ENV, SUPERLIORA_HOME: lioraHome };
}

// --- affected workspace detection -----------------------------------------
function git(...args) {
  const res = spawnSync('git', args, { cwd: repoRoot, encoding: 'utf8' });
  return res.status === 0 ? res.stdout.split('\n').filter(Boolean) : undefined;
}

/** `undefined` when git cannot answer — an unknown scope must not read as "nothing changed". */
function changedFiles(base) {
  const mergeBase = git('merge-base', base, 'HEAD')?.[0];
  if (mergeBase === undefined) return undefined;
  const committed = git('diff', '--name-only', `${mergeBase}...HEAD`);
  const worktree = git('status', '--porcelain');
  if (committed === undefined || worktree === undefined) return undefined;
  const untracked = worktree.map((line) => line.slice(3).split(' -> ').at(-1) ?? '');
  return [...new Set([...committed, ...untracked])].filter(Boolean);
}

/** Workspace dir that owns a path, or undefined for root-level files. */
function ownerWorkspace(file) {
  const match = /^(apps|packages)\/([^/]+)\//.exec(file);
  return match === null ? undefined : `${match[1]}/${match[2]}`;
}

/** Paths no vitest run can observe, so they never widen the scope. */
function isInertForTests(file) {
  return /^(\.changeset|docs|\.github|\.vscode|meta|\.agents)\//.test(file) || /^[^/]+\.md$/.test(file);
}

const hasTests = (dir) => existsSync(join(repoRoot, dir, 'test')) || existsSync(join(repoRoot, dir, 'src/__tests__'));

/** Vitest path filter for a workspace that actually has tests. */
function testDirFilter(dir) {
  if (existsSync(join(repoRoot, dir, 'src/__tests__'))) return `${dir}/src/__tests__`;
  return `${dir}/test`;
}

/**
 * Changed workspaces *plus their dependents*, straight from pnpm's own graph —
 * a change in `telemetry` has to re-run `agent-core`, `sdk`, and `liora` too.
 * `undefined` when pnpm cannot answer, which falls back to the full suite.
 */
function changedWorkspaceClosure(base) {
  const res = spawnSync(pnpmBin, ['--filter', `...[${base}]`, 'list', '--depth', '-1', '--json'], {
    cwd: repoRoot,
    encoding: 'utf8',
    shell: process.platform === 'win32',
  });
  if (res.status !== 0) return undefined;
  try {
    return JSON.parse(res.stdout)
      .map((pkg) => pkg.path?.slice(repoRoot.length + 1) ?? '')
      .filter(Boolean);
  } catch {
    return undefined;
  }
}

/**
 * `filters: undefined` means "run everything" — a shared script or root config
 * change can break any package. `filters: []` means nothing observable changed.
 *
 * Default mode includes pnpm dependents. `direct` limits to the workspaces
 * that own the changed files (faster local iteration).
 */
function decideScope(changed, closureOf, dirHasTests, options = {}) {
  const files = changed.filter((file) => !isInertForTests(file));
  const toFilter = options.toFilter ?? ((dir) => `${dir}/test`);
  const direct = options.direct === true;
  if (files.length === 0) return { filters: [], reason: 'no code changes' };
  const shared = files.find((file) => ownerWorkspace(file) === undefined);
  if (shared !== undefined) return { filters: undefined, reason: `shared file changed (${shared})` };
  if (direct) {
    const owners = [...new Set(files.map(ownerWorkspace).filter((dir) => dir !== undefined))];
    const testable = owners.filter(dirHasTests);
    if (testable.length === 0) return { filters: [], reason: 'no test dir in the changed workspaces' };
    return { filters: testable.map(toFilter), reason: `direct: ${testable.join(', ')}` };
  }
  const closure = closureOf();
  if (closure === undefined) return { filters: undefined, reason: 'pnpm could not resolve the changed graph' };
  const testable = closure.filter(dirHasTests);
  if (testable.length === 0) return { filters: [], reason: 'no test dir in the affected graph' };
  return { filters: testable.map(toFilter), reason: `affected: ${testable.join(', ')}` };
}

function affectedFilters(base, options = {}) {
  const changed = changedFiles(base);
  if (changed === undefined) return { filters: undefined, reason: `git could not diff against ${base}` };
  return decideScope(changed, () => changedWorkspaceClosure(base), hasTests, {
    ...options,
    toFilter: testDirFilter,
  });
}

// --- related-test selection (file-level graph + export-name matching) ------
const WORKSPACE_DIRS = (() => {
  const dirs = [];
  for (const root of ['packages', 'apps']) {
    const rootDir = join(repoRoot, root);
    if (existsSync(rootDir) === false) continue;
    for (const entry of readdirSync(rootDir)) {
      const dir = `${root}/${entry}`;
      if (statSync(join(rootDir, entry)).isDirectory() === true && existsSync(join(repoRoot, dir, 'package.json')) === true) {
        dirs.push(dir);
      }
    }
  }
  return dirs;
})();

function workspaceMetas() {
  return WORKSPACE_DIRS.map((dir) => {
    const pkg = JSON.parse(readFileSync(join(repoRoot, dir, 'package.json'), 'utf8'));
    const exportsField = pkg.exports?.['.'];
    const entry =
      typeof exportsField === 'string'
        ? join(repoRoot, dir, exportsField).slice(repoRoot.length + 1)
        : typeof exportsField?.default === 'string'
          ? join(repoRoot, dir, exportsField.default).slice(repoRoot.length + 1)
          : `${dir}/src/index.ts`;
    return { dir, name: pkg.name ?? dir, imports: pkg.imports ?? {}, entry };
  });
}

/** Map<repoPath, content> over each workspace's src/ + test/ trees. */
function readTree() {
  const tree = new Map();
  const walk = (dir) => {
    for (const entry of readdirSync(dir)) {
      const path = join(dir, entry);
      if (statSync(path).isDirectory() === true) walk(path);
      else if (/\.(ts|tsx|mts)$/.test(entry) === true) {
        tree.set(path.slice(repoRoot.length + 1), readFileSync(path, 'utf8'));
      }
    }
  };
  for (const dir of WORKSPACE_DIRS) {
    for (const sub of ['src', 'test']) {
      const path = join(repoRoot, dir, sub);
      if (existsSync(path) === true) walk(path);
    }
  }
  return tree;
}

const isPackageMeta = (file) =>
  /(^|\/)(package\.json|vitest\.config\.ts|tsconfig[^/]*\.json)$/.test(file);
function relatedScope(base, options = {}) {
  const changed = changedFiles(base);
  if (changed === undefined) return { kind: 'full', reason: `git could not diff against ${base}` };
  const files = changed.filter((file) => isInertForTests(file) === false);
  if (files.length === 0) return { kind: 'none', reason: 'no code changes' };
  if (files.some((file) => ownerWorkspace(file) === undefined)) {
    return { kind: 'full', reason: `shared file changed (${files.find((file) => ownerWorkspace(file) === undefined)})` };
  }
  const fallbackToClosure = (reason) => {
    const closure = changedWorkspaceClosure(base);
    if (closure === undefined) return { kind: 'full', reason: `${reason}; pnpm could not resolve the graph` };
    const testable = closure.filter(hasTests);
    if (testable.length === 0) return { kind: 'none', reason: `${reason}; no test dir in the affected graph` };
    return { kind: 'filters', filters: testable.map(testDirFilter), reason: `${reason} -> ${testable.join(', ')}` };
  };
  const meta = files.find(isPackageMeta);
  if (meta !== undefined) return fallbackToClosure(`package meta changed (${meta})`);
  const deleted = files.filter((file) => existsSync(join(repoRoot, file)) === false);
  if (deleted.length > 0) return fallbackToClosure(`files deleted (${deleted[0]})`);

  const graph = buildGraph(readTree(), workspaceMetas());
  const selection = selectRelatedTests(graph, files, undefined);
  if (selection.kind === 'closure') return fallbackToClosure(selection.reason);
  if (selection.kind === 'full') return { kind: 'full', reason: selection.reason };
  if (selection.kind === 'none') return { kind: 'none', reason: selection.reason };
  const testFiles = selection.testFiles;
  if (testFiles.length === 0) return { kind: 'none', reason: 'no related test files' };
  // Very wide selections lose to the coarser but cheaper path filter form.
  if (testFiles.length > 400) return fallbackToClosure(`related set too wide (${String(testFiles.length)} files)`);
  return { kind: 'filters', filters: testFiles, reason: `related: ${String(testFiles.length)} test files` };
}

function selfCheck() {
  const closure = () => ['packages/telemetry', 'packages/agent-core', 'apps/liora'];
  const withTests = (dir) => dir !== 'packages/telemetry';
  const cases = [
    { files: [], want: '[]' },
    { files: ['.changeset/x.md', 'docs/en/a.md', 'AGENTS.md'], want: '[]' },
    { files: ['scripts/test-local.mjs'], want: 'all' },
    { files: ['packages/telemetry/src/index.ts', 'meta/test-baseline.yaml'], want: 'packages/agent-core/test,apps/liora/test' },
    { files: ['packages/telemetry/src/index.ts'], closure: () => undefined, want: 'all' },
    { files: ['packages/agent-core/src/foo.ts'], direct: true, want: 'packages/agent-core/test' },
    { files: ['packages/telemetry/src/index.ts'], direct: true, want: '[]' },
    { files: ['scripts/test-local.mjs'], direct: true, want: 'all' },
  ];
  let failed = 0;
  for (const { files, closure: override, want, direct } of cases) {
    const { filters } = decideScope(files, override ?? closure, withTests, { direct });
    const actual = filters === undefined ? 'all' : filters.length === 0 ? '[]' : filters.join(',');
    if (actual !== want) {
      failed++;
      console.error(`self-check FAIL ${JSON.stringify(files)} direct=${Boolean(direct)}: expected ${want}, got ${actual}`);
    }
  }
  // Fail open, not silent: an unresolvable base must widen to the full suite.
  if (affectedFilters('no/such/ref').filters !== undefined) {
    failed++;
    console.error('self-check FAIL: an unresolvable base did not fall back to the full suite');
  }

  // Related-mode fixtures: a synthetic two-package graph exercising the name
  // level (barrel re-exports, deep imports, star re-exports, dependent src).
  const fx = fixtureGraph();
  const select = (changed) => {
    const result = selectRelatedTests(fx.graph, changed, undefined);
    return result.kind === 'related' ? result.testFiles : result.kind;
  };
  const fixtureCases = [
    { want: ['packages/a/test/a.test.ts', 'packages/a/test/deep.test.ts', 'packages/b/test/b.test.ts', 'packages/b/test/uses.test.ts'], changed: ['packages/a/src/greet.ts'] },
    // b/src/uses.ts star-imports the whole package, so b's suite runs too.
    { want: ['packages/a/test/u.test.ts', 'packages/b/test/uses.test.ts'], changed: ['packages/a/src/util.ts'] },
    { want: ['packages/a/test/a.test.ts', 'packages/a/test/deep.test.ts', 'packages/b/test/b.test.ts', 'packages/b/test/uses.test.ts'], changed: ['packages/a/src/greet.ts', 'packages/a/test/deep.test.ts'] },
    // util's public name is unused by b, so b stays out; greet is used there.
    { want: ['packages/a/test/a.test.ts', 'packages/a/test/deep.test.ts', 'packages/a/test/u.test.ts', 'packages/b/test/b.test.ts', 'packages/b/test/uses.test.ts'], changed: ['packages/a/src/greet.ts', 'packages/a/src/util.ts'] },
    { want: 'closure', changed: ['packages/a/package.json'] },
    { want: 'full', changed: ['scripts/other.mjs'] },
  ];
  for (const { want, changed } of fixtureCases) {
    const actual = select(changed);
    const same = Array.isArray(want)
      ? Array.isArray(actual) && actual.length === want.length && want.every((entry) => actual.includes(entry))
      : actual === want;
    if (same === false) {
      failed++;
      console.error(`self-check FAIL fixture ${JSON.stringify(changed)}: expected ${JSON.stringify(want)}, got ${JSON.stringify(actual)}`);
    }
  }
  const total = cases.length + 1 + fixtureCases.length;
  console.log(failed === 0 ? `self-check OK (${total} cases)` : `self-check FAILED (${failed})`);
  process.exit(failed === 0 ? 0 : 1);
}

// --- main ------------------------------------------------------------------
const argv = process.argv.slice(2);
if (argv.includes('--self-check')) selfCheck();
if (argv.includes('--env')) {
  const env = parityEnv();
  for (const [key, value] of Object.entries(SET_ENV)) console.log(`${key}=${value}`);
  for (const key of DELETE_ENV) if (env[key] === undefined) console.log(`${key} (unset)`);
  process.exit(0);
}

const baseIdx = argv.indexOf('--base');
const base = baseIdx >= 0 ? argv[baseIdx + 1] : 'origin/main';
if (baseIdx >= 0 && base === undefined) {
  console.error('test-local: --base requires a ref');
  process.exit(2);
}
const baseArgIndices = baseIdx >= 0 ? [baseIdx, baseIdx + 1] : [];
const LOCAL_FLAGS = new Set(['--all', '--scope', '--self-check', '--direct', '--closure']);
const failuresJsonIdx = argv.indexOf('--failures-json');
if (failuresJsonIdx >= 0 && argv[failuresJsonIdx + 1] === undefined) {
  console.error('test-local: --failures-json requires a file path');
  process.exit(2);
}
const failuresJsonPath = failuresJsonIdx >= 0 ? argv[failuresJsonIdx + 1] : undefined;
const skipIndices = new Set(baseArgIndices);
if (failuresJsonIdx >= 0) skipIndices.add(failuresJsonIdx).add(failuresJsonIdx + 1);
const forwarded = argv.filter((arg, i) => !LOCAL_FLAGS.has(arg) && !skipIndices.has(i));
const hasExplicitFilter = forwarded.some((arg) => !arg.startsWith('-'));
const direct = argv.includes('--direct');
const closure = argv.includes('--closure');

const scopeOnly = argv.includes('--scope');
let filters = [];
let nothingToRun = false;
if (!argv.includes('--all') && !hasExplicitFilter) {
  const affected =
    closure === true
      ? affectedFilters(base, { direct })
      : direct === true
        ? affectedFilters(base, { direct: true })
        : relatedScope(base);
  const label =
    affected.kind === 'full'
      ? undefined
      : affected.kind === 'none'
        ? []
        : affected.kind === 'filters'
          ? affected.filters
          : undefined;
  if (affected.kind === 'full') {
    console.log(`test-local: full suite — ${affected.reason}`);
  } else if (label !== undefined && label.length === 0) {
    nothingToRun = true;
    console.log(`test-local: nothing to run — ${affected.reason} (use --all for the full suite)`);
  } else {
    filters = label;
    console.log(`test-local: scoped — ${affected.reason}`);
  }
}
if (scopeOnly || nothingToRun) {
  if (failuresJsonPath !== undefined) {
    // Downstream baseline checks expect a results file even when nothing ran.
    writeFileSync(failuresJsonPath, JSON.stringify({ numTotalTests: 0, numPassedTests: 0, numFailedTests: 0, testResults: [] }));
  }
  process.exit(0);
}

const started = Date.now();
const vitestArgs = [...filters, ...forwarded];
if (failuresJsonPath !== undefined) {
  // Extra reporter alongside the default one; jest-format JSON consumed by
  // scripts/check-test-baseline.mjs --from-json (avoids re-running vitest).
  vitestArgs.push('--reporter=default', '--reporter=json', `--outputFile.json=${failuresJsonPath}`);
}
const res = spawnSync(pnpmBin, ['exec', 'vitest', 'run', ...vitestArgs], {
  cwd: repoRoot,
  env: parityEnv(),
  stdio: 'inherit',
  shell: process.platform === 'win32',
});
const seconds = ((Date.now() - started) / 1000).toFixed(1);

if (res.status === 0) {
  console.log(`\ntest-local: PASS in ${seconds}s (CI-parity env)`);
  process.exit(0);
}
console.error(
  `\ntest-local: FAIL in ${seconds}s. Re-run one file with the same env:\n` +
    '  node scripts/test-local.mjs <path/to/file.test.ts> -t "case name"\n' +
    '  node scripts/test-local.mjs --env   # what CI parity changes about your shell',
);
process.exit(res.status ?? 1);


// --- self-check fixture graph ----------------------------------------------
function fixtureGraph() {
  const tree = new Map([
    ['packages/a/src/index.ts', "export { greet } from './greet';\nexport * from './util';\n"],
    ['packages/a/src/greet.ts', 'export function greet() { return 1; }\n'],
    ['packages/a/src/util.ts', 'export function util() { return 2; }\n'],
    ['packages/a/test/a.test.ts', "import { greet } from '../src/index';\n"],
    ['packages/a/test/u.test.ts', "import { util } from '../src/index';\n"],
    ['packages/a/test/deep.test.ts', "import { greet } from '../src/greet';\n"],
    ['packages/b/src/index.ts', 'export const b = 1;\n'],
    ['packages/b/src/uses.ts', `import * as alpha from '${FAKE_PKG_A}';\nexport const x = alpha.greet();\n`],
    ['packages/b/test/b.test.ts', `import { greet } from '${FAKE_PKG_A}';\n`],
    ['packages/b/test/uses.test.ts', "import { x } from '../src/uses';\nimport { describe } from 'vitest';\n"],
    ['packages/b/package.json', '{}'],
  ]);
  const workspaces = [
    { dir: 'packages/a', name: FAKE_PKG_A, imports: {}, entry: 'packages/a/src/index.ts' },
    { dir: 'packages/b', name: '@superliora/b', imports: {}, entry: 'packages/b/src/index.ts' },
  ];
  const graph = buildGraph(tree, workspaces);
  return { graph, tree, workspaces };
}
