#!/usr/bin/env node
/**
 * Repo-wide typecheck driver, mirroring the CI typecheck job:
 * every package tsconfig.json + `apps/liora/tsconfig.json`, with the
 * agent-core aggregate config replaced by `tsconfig.src.json` (the aggregate
 * includes the test tree's known-error baseline; see ci.yml).
 *
 * Compiler: tsgo (@typescript/native-preview, pinned in devDependencies) by
 * default — the same compiler CI uses, cached in the pnpm store instead of
 * re-downloaded per job via `pnpm dlx`. `--compiler=tsc` falls back to the
 * classic compiler.
 *
 * `--direct` scopes to the workspaces owning the diff vs `origin/main`
 * (plus uncommitted changes). Workspace sources are re-exported through
 * package exports, so each owner's tsc run transitively checks its
 * workspace dependencies.
 */
import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';

const repoRoot = resolve(import.meta.dirname, '..');
const direct = process.argv.includes('--direct');
const compilerIdx = process.argv.indexOf('--compiler');
const compiler = compilerIdx >= 0 ? process.argv[compilerIdx + 1] : 'tsgo';
if (compiler !== 'tsgo' && compiler !== 'tsc') {
  console.error(`typecheck: unknown compiler "${compiler}" (use tsgo | tsc)`);
  process.exit(2);
}

function git(...args) {
  const res = spawnSync('git', args, { cwd: repoRoot, encoding: 'utf8' });
  return res.status === 0 ? res.stdout.split('\n').filter(Boolean) : [];
}

/** Workspace owner for a changed path: `packages/<name>/…` or `apps/liora/…`. */
function ownerWorkspace(path) {
  const posix = path.replaceAll('\\', '/');
  const packages = posix.match(/^packages\/([^/]+)\//);
  if (packages !== null) return `packages/${packages[1]}`;
  if (posix.startsWith('apps/liora/')) return 'apps/liora';
  return undefined;
}

function changedWorkspaces() {
  const base = 'origin/main';
  const files = new Set(git('diff', '--name-only', `${base}...HEAD`));
  for (const line of git('status', '--porcelain')) {
    const path = line.slice(3).replaceAll('\\', '/').split(' -> ').at(-1);
    if (path !== undefined && path.length > 0) files.add(path);
  }
  const owners = new Set();
  for (const file of files) {
    const owner = ownerWorkspace(file);
    if (owner !== undefined) owners.add(owner);
  }
  return owners;
}

function configFor(workspace) {
  if (workspace === 'apps/liora') return 'apps/liora/tsconfig.json';
  return `packages/${workspace.replace(/^packages\//, '')}/tsconfig.json`;
}

const selected = [];
if (direct) {
  const owners = changedWorkspaces();
  if (owners.size === 0) {
    console.log('typecheck:direct: no workspace-owning changes vs origin/main — nothing to run.');
    process.exit(0);
  }
  const names = [...owners].toSorted((a, b) => a.localeCompare(b));
  console.log(`typecheck:direct — owners: ${names.join(', ')}`);
  for (const workspace of names) {
    // agent-core's aggregate config is replaced by its src-only config below.
    if (workspace === 'packages/agent-core') continue;
    const config = configFor(workspace);
    if (existsSync(join(repoRoot, config))) selected.push(config);
  }
  if (owners.has('packages/agent-core')) {
    selected.push('packages/agent-core/tsconfig.src.json');
  }
} else {
  for (const dir of readdirSync(join(repoRoot, 'packages')).toSorted()) {
    if (dir === 'agent-core') continue;
    const config = `packages/${dir}/tsconfig.json`;
    if (existsSync(join(repoRoot, config))) selected.push(config);
  }
  selected.push('apps/liora/tsconfig.json');
  // agent-core: src-only config (aggregate config carries the test-tree baseline).
  selected.push('packages/agent-core/tsconfig.src.json');
}

// Node 24 refuses to spawn .cmd shims (EINVAL), so drive tsgo through node
// and its package entry directly instead of the .bin shim.
const TSGO_ENTRY = join(repoRoot, 'node_modules', '@typescript', 'native-preview', 'lib', 'tsgo.js');

function typecheckArgs(config) {
  return compiler === 'tsgo'
    ? [TSGO_ENTRY, '-p', config, '--noEmit']
    : ['-p', config, '--noEmit'];
}

const spawnBinary =
  compiler === 'tsgo' ? process.execPath : 'tsc';
const binAvailable =
  compiler === 'tsgo' ? existsSync(TSGO_ENTRY) : true;
if (!binAvailable) {
  console.error(`typecheck: ${compiler} entry not found at ${TSGO_ENTRY} (install devDependencies)`);
  process.exit(2);
}

let failures = 0;
for (const config of selected) {
  console.log(`Typechecking ${config}`);
  const res = spawnSync(spawnBinary, typecheckArgs(config), {
    cwd: repoRoot,
    stdio: 'inherit',
  });
  if (res.status !== 0) {
    if (res.error !== undefined) {
      console.error(`typecheck: failed to spawn ${compiler}: ${String(res.error)}`);
    }
    failures += 1;
  }
}
if (failures > 0) {
  console.error(`typecheck: FAILED (${failures} of ${selected.length} configs)`);
  process.exit(1);
}
console.log(`typecheck: OK (${selected.length} configs, ${compiler})`);
