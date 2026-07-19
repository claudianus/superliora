import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

import { getHostPackageRoot } from '#/cli/version';

import type { UpdateTarget } from './types';

const SUPERLIORA_REPO_PATTERN = /github\.com[:/]claudianus\/superliora(?:\.git)?$/i;

export interface GitCheckoutTarget extends UpdateTarget {
  readonly repoRoot: string;
  readonly upstream: string;
}

export type GitCheckoutRefreshResult =
  | { readonly status: 'up-to-date'; readonly dirty: boolean }
  | { readonly status: 'update'; readonly target: GitCheckoutTarget; readonly dirty: boolean }
  | { readonly status: 'diverged'; readonly upstream: string; readonly dirty: boolean };

function shellQuote(value: string): string {
  return `'${value.replaceAll("'", "'\\''")}'`;
}

function execGit(repoRoot: string, args: readonly string[]): Promise<string> {
  return new Promise((resolveOutput, reject) => {
    execFile('git', ['-C', repoRoot, ...args], { encoding: 'utf-8' }, (error, stdout, stderr) => {
      if (error) {
        reject(new Error((stderr.trim() || error.message)));
        return;
      }
      resolveOutput(stdout.trim());
    });
  });
}

export function findGitCheckoutRoot(startPath: string = getHostPackageRoot()): string | null {
  let dir = resolve(startPath);
  for (let i = 0; i < 12; i++) {
    if (existsSync(resolve(dir, '.git'))) return dir;
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return null;
}

export function isSuperLioraGithubRemote(remoteUrl: string): boolean {
  return SUPERLIORA_REPO_PATTERN.test(remoteUrl.trim());
}

export async function detectSuperLioraGithubCheckout(
  startPath: string = getHostPackageRoot(),
): Promise<string | null> {
  const repoRoot = findGitCheckoutRoot(startPath);
  if (repoRoot === null) return null;
  const origin = await execGit(repoRoot, ['config', '--get', 'remote.origin.url']).catch(() => '');
  return isSuperLioraGithubRemote(origin) ? repoRoot : null;
}

export async function isGitCheckoutDirty(repoRoot: string): Promise<boolean> {
  const unstaged = await execGit(repoRoot, ['diff', '--quiet']).then(() => false).catch(() => true);
  if (unstaged) return true;
  return execGit(repoRoot, ['diff', '--cached', '--quiet']).then(() => false).catch(() => true);
}

function buildGitCheckoutUpdateShellLines(repoExpr: string): readonly string[] {
  return [
    `echo '__LIORA_UPGRADE_STAGE__=fetching'`,
    `upstream="$(git -C ${repoExpr} rev-parse --abbrev-ref --symbolic-full-name '@{u}' 2>/dev/null || true)"`,
    `if [ -z "$upstream" ]; then upstream="$(git -C ${repoExpr} symbolic-ref --short refs/remotes/origin/HEAD 2>/dev/null || true)"; fi`,
    `if [ -z "$upstream" ]; then if git -C ${repoExpr} rev-parse --verify origin/main >/dev/null 2>&1; then upstream='origin/main'; else upstream='origin/master'; fi; fi`,
    'ref="${upstream#origin/}"',
    `git -C ${repoExpr} diff --quiet`,
    `git -C ${repoExpr} diff --cached --quiet`,
    `git -C ${repoExpr} fetch --depth 1 origin "$ref"`,
    `git -C ${repoExpr} checkout --force FETCH_HEAD`,
    `git -C ${repoExpr} reset --hard FETCH_HEAD`,
    `echo '__LIORA_UPGRADE_STAGE__=building'`,
    `corepack pnpm -C ${repoExpr} install --frozen-lockfile`,
    `corepack pnpm -C ${repoExpr} run build:packages`,
    `corepack pnpm -C ${repoExpr}/apps/liora run build`,
    `echo '__LIORA_UPGRADE_STAGE__=installing'`,
    'liora_path="$(command -v liora 2>/dev/null || true)"',
    'if [ -n "$liora_path" ]; then bin_dir="$(dirname "$liora_path")"; command_name="$(basename "$liora_path")"; else bin_dir="${HOME}/.local/bin"; command_name="liora"; fi',
    `node ${repoExpr}/scripts/install-liora.mjs --bin-dir "$bin_dir" --name "$command_name" --no-shell-rc --force`,
    `echo '__LIORA_UPGRADE_STAGE__=done'`,
  ];
}

export function gitCheckoutUpdateCommand(repoRoot: string = findGitCheckoutRoot() ?? '.'): string {
  return `bash -lc ${shellQuote(gitCheckoutUpdateScript(repoRoot))}`;
}

export function gitCheckoutUpdateScript(repoRoot: string = findGitCheckoutRoot() ?? '.'): string {
  const quotedRoot = shellQuote(repoRoot);
  return [
    'set -e',
    'export COREPACK_ENABLE_DOWNLOAD_PROMPT=0',
    `repo=${quotedRoot}`,
    ...buildGitCheckoutUpdateShellLines('"$repo"'),
  ].join('\n');
}

export async function refreshGitCheckoutUpdateTarget(
  repoRoot: string = findGitCheckoutRoot() ?? '',
): Promise<GitCheckoutRefreshResult> {
  if (repoRoot.length === 0) {
    throw new Error('Git checkout root not found');
  }
  const dirty = await isGitCheckoutDirty(repoRoot);
  const upstream = await resolveGitCheckoutUpstream(repoRoot);
  const ref = upstream.startsWith('origin/') ? upstream.slice('origin/'.length) : upstream;
  // Prefer an explicit fetch of the tracking ref so shallow clones deepen correctly.
  await execGit(repoRoot, ['fetch', '--quiet', '--prune', 'origin', ref]).catch(async () => {
    await execGit(repoRoot, ['fetch', '--quiet', '--prune', 'origin']);
  });
  const local = await execGit(repoRoot, ['rev-parse', 'HEAD']);
  const remote = await execGit(repoRoot, ['rev-parse', upstream]);
  if (local === remote) return { status: 'up-to-date', dirty };
  const behind = Number(await execGit(repoRoot, ['rev-list', '--count', `HEAD..${upstream}`]));
  const ahead = Number(await execGit(repoRoot, ['rev-list', '--count', `${upstream}..HEAD`]));
  if (Number.isFinite(ahead) && ahead > 0 && Number.isFinite(behind) && behind > 0) {
    return { status: 'diverged', upstream, dirty };
  }
  if (!Number.isFinite(behind) || behind <= 0) return { status: 'up-to-date', dirty };
  return {
    status: 'update',
    dirty,
    target: { repoRoot, upstream, version: `${upstream}@${remote.slice(0, 12)}` },
  };
}

async function resolveGitCheckoutUpstream(repoRoot: string): Promise<string> {
  const tracking = await execGit(repoRoot, [
    'rev-parse',
    '--abbrev-ref',
    '--symbolic-full-name',
    '@{u}',
  ]).catch(() => '');
  if (tracking.length > 0) return tracking;

  const originHead = await execGit(repoRoot, [
    'symbolic-ref',
    '--short',
    'refs/remotes/origin/HEAD',
  ]).catch(() => '');
  if (originHead.length > 0) return originHead;

  const hasMain = await execGit(repoRoot, ['rev-parse', '--verify', 'origin/main'])
    .then(() => true)
    .catch(() => false);
  if (hasMain) return 'origin/main';

  await execGit(repoRoot, ['rev-parse', '--verify', 'origin/master']);
  return 'origin/master';
}
