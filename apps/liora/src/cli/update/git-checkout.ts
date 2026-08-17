import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

import { tryGetHostPackageRoot } from '#/cli/version';

import type { UpdateTarget } from './types';

const SUPERLIORA_REPO_PATTERN = /github\.com[:/]claudianus\/superliora(?:\.git)?$/i;

export interface GitCheckoutTarget extends UpdateTarget {
  readonly repoRoot: string;
  readonly upstream: string;
}

export type GitCheckoutRefreshResult =
  | {
      readonly status: 'up-to-date';
      readonly dirty: boolean;
      /** Full HEAD sha — used to detect “git caught up, install/build failed”. */
      readonly head: string;
      readonly upstream: string;
    }
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

export function findGitCheckoutRoot(startPath?: string): string | null {
  const resolved = startPath ?? tryGetHostPackageRoot();
  if (resolved === undefined) return null;
  let dir = resolve(resolved);
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
  startPath?: string,
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

export interface GitCheckoutUpdateOptions {
  /** Pin remote tip (e.g. `origin/main`) instead of the local tracking branch. */
  readonly preferredUpstream?: string;
}

function buildGitCheckoutUpdateShellLines(
  repoExpr: string,
  options: GitCheckoutUpdateOptions = {},
): readonly string[] {
  // Match install.sh: force-checkout discards local dirt intentionally.
  // Do not pre-fail on a dirty tree — that trapped source installs that had
  // incidental lockfile noise and made both auto and manual upgrade impossible.
  const preferred = options.preferredUpstream?.trim();
  const resolveUpstream =
    preferred !== undefined && preferred.length > 0
      ? [`upstream=${shellQuote(preferred)}`]
      : [
          `upstream="$(git -C ${repoExpr} rev-parse --abbrev-ref --symbolic-full-name '@{u}' 2>/dev/null || true)"`,
          `if [ -z "$upstream" ]; then upstream="$(git -C ${repoExpr} symbolic-ref --short refs/remotes/origin/HEAD 2>/dev/null || true)"; fi`,
          `if [ -z "$upstream" ]; then if git -C ${repoExpr} rev-parse --verify origin/main >/dev/null 2>&1; then upstream='origin/main'; else upstream='origin/master'; fi; fi`,
        ];
  return [
    `echo '__LIORA_UPGRADE_STAGE__=fetching'`,
    ...resolveUpstream,
    'ref="${upstream#origin/}"',
    `git -C ${repoExpr} fetch --depth 1 origin "$ref"`,
    // Stay on the tracking branch — bare FETCH_HEAD checkout leaves detached HEAD
    // and surfaces git's "git branch <new-branch-name>" advice as a false failure.
    `git -C ${repoExpr} -c advice.detachedHead=false checkout --force -B "$ref" FETCH_HEAD`,
    `git -C ${repoExpr} reset --hard FETCH_HEAD`,
    `echo '__LIORA_UPGRADE_STAGE__=building'`,
    'export PATH="${HOME}/.superliora/runtime/pnpm:${PATH}"',
    'if [ -n "${USERPROFILE:-}" ]; then export PATH="${USERPROFILE}/.superliora/runtime/pnpm:${PATH}"; fi',
    `node ${repoExpr}/scripts/install/ensure-pnpm.mjs`,
    'if command -v pnpm >/dev/null 2>&1; then pnpm_invoke() { pnpm "$@"; }',
    'elif [ -x "${HOME}/.superliora/runtime/pnpm/pnpm" ]; then pnpm_invoke() { "${HOME}/.superliora/runtime/pnpm/pnpm" "$@"; }',
    'elif [ -n "${USERPROFILE:-}" ] && [ -x "${USERPROFILE}/.superliora/runtime/pnpm/pnpm.exe" ]; then pnpm_invoke() { "${USERPROFILE}/.superliora/runtime/pnpm/pnpm.exe" "$@"; }',
    'elif command -v corepack >/dev/null 2>&1; then pnpm_invoke() { corepack pnpm "$@"; }',
    'else echo "error: pnpm bootstrap failed" >&2; exit 1; fi',
    `pnpm_invoke -C ${repoExpr} install --frozen-lockfile`,
    `pnpm_invoke -C ${repoExpr} run build:packages`,
    `pnpm_invoke -C ${repoExpr}/apps/liora run build`,
    // Match install.sh: warm Granite-97M + passage indexes (soft-fail).
    `if [ "\${SUPERLIORA_SKIP_RETRIEVAL:-0}" != "1" ]; then SUPERLIORA_RETRIEVAL_EMBEDDER=transformers pnpm_invoke -C ${repoExpr}/packages/agent-core run retrieval:bootstrap || echo "warning: retrieval bootstrap failed (hash fallback until online)"; fi`,
    `echo '__LIORA_UPGRADE_STAGE__=installing'`,
    'liora_path="$(command -v liora 2>/dev/null || true)"',
    'if [ -n "$liora_path" ]; then bin_dir="$(dirname "$liora_path")"; command_name="$(basename "$liora_path")"; else bin_dir="${HOME}/.local/bin"; command_name="liora"; fi',
    `node ${repoExpr}/scripts/install-liora.mjs --bin-dir "$bin_dir" --name "$command_name" --no-shell-rc --force`,
    `echo '__LIORA_UPGRADE_STAGE__=done'`,
  ];
}

export function gitCheckoutUpdateCommand(
  repoRoot: string | undefined = undefined,
  options: GitCheckoutUpdateOptions = {},
): string {
  return `bash -lc ${shellQuote(gitCheckoutUpdateScript(repoRoot, options))}`;
}

export function gitCheckoutUpdateScript(
  repoRoot: string | undefined = undefined,
  options: GitCheckoutUpdateOptions = {},
): string {
  const quotedRoot = shellQuote(repoRoot ?? findGitCheckoutRoot() ?? '.');
  return [
    'set -e',
    'export COREPACK_ENABLE_DOWNLOAD_PROMPT=0',
    `repo=${quotedRoot}`,
    ...buildGitCheckoutUpdateShellLines('"$repo"', options),
  ].join('\n');
}

export async function refreshGitCheckoutUpdateTarget(
  repoRoot: string = findGitCheckoutRoot() ?? '',
  options: GitCheckoutUpdateOptions = {},
): Promise<GitCheckoutRefreshResult> {
  if (repoRoot.length === 0) {
    throw new Error('Git checkout root not found');
  }
  const dirty = await isGitCheckoutDirty(repoRoot);
  const preferred = options.preferredUpstream?.trim();
  const upstream =
    preferred !== undefined && preferred.length > 0
      ? preferred
      : await resolveGitCheckoutUpstream(repoRoot);
  const ref = upstream.startsWith('origin/') ? upstream.slice('origin/'.length) : upstream;
  // Prefer an explicit fetch of the tracking ref so shallow clones deepen correctly.
  await execGit(repoRoot, ['fetch', '--quiet', '--prune', 'origin', ref]).catch(async () => {
    await execGit(repoRoot, ['fetch', '--quiet', '--prune', 'origin']);
  });
  const local = await execGit(repoRoot, ['rev-parse', 'HEAD']);
  const remote = await execGit(repoRoot, ['rev-parse', upstream]);
  if (local === remote) {
    return { status: 'up-to-date', dirty, head: local, upstream };
  }
  const behind = Number(await execGit(repoRoot, ['rev-list', '--count', `HEAD..${upstream}`]));
  const ahead = Number(await execGit(repoRoot, ['rev-list', '--count', `${upstream}..HEAD`]));
  if (Number.isFinite(ahead) && ahead > 0 && Number.isFinite(behind) && behind > 0) {
    return { status: 'diverged', upstream, dirty };
  }
  if (!Number.isFinite(behind) || behind <= 0) {
    return { status: 'up-to-date', dirty, head: local, upstream };
  }
  return {
    status: 'update',
    dirty,
    target: { repoRoot, upstream, version: `${upstream}@${remote.slice(0, 12)}` },
  };
}

/** Version label used by install-state / upgrade plan for a checkout HEAD. */
export function gitCheckoutVersionLabel(upstream: string, headSha: string): string {
  return `${upstream}@${headSha.slice(0, 12)}`;
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
