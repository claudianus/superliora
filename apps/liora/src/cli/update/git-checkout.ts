import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join, resolve, win32 } from 'node:path';

import { tryGetHostPackageRoot } from '#/cli/version';
import { getDataDir } from '#/utils/paths';

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

function gitArgv(repoRoot: string, args: readonly string[]): string[] {
  if (process.platform === 'win32') {
    return ['-C', repoRoot, '-c', 'core.longpaths=true', ...args];
  }
  return ['-C', repoRoot, ...args];
}

function execGit(repoRoot: string, args: readonly string[]): Promise<string> {
  return new Promise((resolveOutput, reject) => {
    execFile('git', gitArgv(repoRoot, args), { encoding: 'utf-8' }, (error, stdout, stderr) => {
      if (error) {
        reject(new Error((stderr.trim() || error.message)));
        return;
      }
      resolveOutput(stdout.trim());
    });
  });
}

export function findGitCheckoutRoot(
  startPath?: string,
  options: { readonly walkParents?: boolean } = {},
): string | null {
  const resolved = startPath ?? tryGetHostPackageRoot();
  if (resolved === undefined) return null;
  let dir = resolve(resolved);
  const walkParents = options.walkParents ?? true;
  for (let i = 0; i < 12; i++) {
    if (existsSync(resolve(dir, '.git'))) return dir;
    if (!walkParents) return null;
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return null;
}

/** True when HEAD exists in the object store (rejects hollow failed clones). */
export async function hasUsableGitObjectStore(repoRoot: string): Promise<boolean> {
  if (!existsSync(resolve(repoRoot, '.git'))) return false;
  try {
    const head = await execGit(repoRoot, ['rev-parse', '--verify', 'HEAD']);
    if (head.length === 0) return false;
    await execGit(repoRoot, ['cat-file', '-e', `${head}^{commit}`]);
    return true;
  } catch {
    return false;
  }
}

export function sameCheckoutPath(left: string, right: string): boolean {
  const a = resolve(left);
  const b = resolve(right);
  return process.platform === 'win32' ? a.toLowerCase() === b.toLowerCase() : a === b;
}

/**
 * Remove a managed `~/.superliora/source` tree that cannot be fetched.
 * Never deletes an operator worktree outside `managedRoot`.
 */
export async function discardUnhealthyManagedCheckout(managedRoot: string): Promise<boolean> {
  const root = resolve(managedRoot);
  if (!existsSync(root) || !existsSync(resolve(root, '.git'))) return false;
  if (await hasUsableGitObjectStore(root)) return false;
  await rm(root, { recursive: true, force: true });
  return true;
}

export function isSuperLioraGithubRemote(remoteUrl: string): boolean {
  return SUPERLIORA_REPO_PATTERN.test(remoteUrl.trim());
}

export async function detectSuperLioraGithubCheckout(
  startPath?: string,
  options: { readonly walkParents?: boolean } = {},
): Promise<string | null> {
  const repoRoot = findGitCheckoutRoot(startPath, options);
  if (repoRoot === null) return null;
  const origin = await execGit(repoRoot, ['config', '--get', 'remote.origin.url']).catch(() => '');
  if (!isSuperLioraGithubRemote(origin)) return null;
  if (!(await hasUsableGitObjectStore(repoRoot))) return null;
  return repoRoot;
}

export async function isGitCheckoutDirty(repoRoot: string): Promise<boolean> {
  const unstaged = await execGit(repoRoot, ['diff', '--quiet']).then(() => false).catch(() => true);
  if (unstaged) return true;
  return execGit(repoRoot, ['diff', '--cached', '--quiet']).then(() => false).catch(() => true);
}

export interface GitCheckoutUpdateOptions {
  /** Pin remote tip (e.g. `origin/main`) instead of the local tracking branch. */
  readonly preferredUpstream?: string;
  /** Data home for runtime/pnpm. Defaults to SUPERLIORA_HOME / home.redirect. */
  readonly dataHome?: string;
  /** Fallback command bin dir when Git Bash cannot see `liora`. */
  readonly commandBinDir?: string;
}

/** Windows command install dir — `%LOCALAPPDATA%\SuperLiora\bin`, not `~/.local/bin`. */
export function defaultCheckoutCommandBinDir(
  platform: NodeJS.Platform = process.platform,
  env: NodeJS.ProcessEnv = process.env,
): string {
  if (platform === 'win32') {
    const base =
      env['LOCALAPPDATA']?.trim() ||
      win32.join(env['USERPROFILE'] ?? env['HOME'] ?? homedir(), 'AppData', 'Local');
    return win32.join(base, 'SuperLiora', 'bin');
  }
  return join(env['HOME'] ?? homedir(), '.local', 'bin');
}

function toBashPath(value: string): string {
  return value.replaceAll('\\', '/');
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
    `git -C ${repoExpr} -c core.longpaths=true fetch --depth 1 origin "$ref"`,
    // Stay on the tracking branch — bare FETCH_HEAD checkout leaves detached HEAD
    // and surfaces git's "git branch <new-branch-name>" advice as a false failure.
    `git -C ${repoExpr} -c core.longpaths=true -c advice.detachedHead=false checkout --force -B "$ref" FETCH_HEAD`,
    `git -C ${repoExpr} -c core.longpaths=true reset --hard FETCH_HEAD`,
    `echo '__LIORA_UPGRADE_STAGE__=building'`,
    'export PATH="$SUPERLIORA_HOME/runtime/pnpm:${PATH}"',
    `node ${repoExpr}/scripts/install/ensure-pnpm.mjs`,
    'if command -v pnpm >/dev/null 2>&1; then pnpm_invoke() { pnpm "$@"; }',
    'elif [ -x "$SUPERLIORA_HOME/runtime/pnpm/pnpm" ]; then pnpm_invoke() { "$SUPERLIORA_HOME/runtime/pnpm/pnpm" "$@"; }',
    'elif [ -x "$SUPERLIORA_HOME/runtime/pnpm/pnpm.exe" ]; then pnpm_invoke() { "$SUPERLIORA_HOME/runtime/pnpm/pnpm.exe" "$@"; }',
    'elif command -v corepack >/dev/null 2>&1; then pnpm_invoke() { corepack pnpm "$@"; }',
    'else echo "error: pnpm bootstrap failed" >&2; exit 1; fi',
    `pnpm_invoke -C ${repoExpr} install --frozen-lockfile`,
    `pnpm_invoke -C ${repoExpr} run build:packages`,
    `pnpm_invoke -C ${repoExpr}/apps/liora run build`,
    // Match install.sh: warm Granite-97M + passage indexes (soft-fail).
    `if [ "\${SUPERLIORA_SKIP_RETRIEVAL:-0}" != "1" ] && [ "\${SUPERLIORA_OBSERVED_UPGRADE:-0}" != "1" ]; then SUPERLIORA_RETRIEVAL_EMBEDDER=transformers pnpm_invoke -C ${repoExpr}/packages/agent-core run retrieval:bootstrap || echo "warning: retrieval bootstrap failed (hash fallback until online)"; fi`,
    `echo '__LIORA_UPGRADE_STAGE__=installing'`,
    'liora_path="$(command -v liora 2>/dev/null || true)"',
    'if [ -z "$liora_path" ]; then liora_path="$(command -v liora.cmd 2>/dev/null || true)"; fi',
    'if [ -z "$liora_path" ]; then liora_path="$(command -v liora.exe 2>/dev/null || true)"; fi',
    `if [ -n "$liora_path" ]; then bin_dir="$(dirname "$liora_path")"; command_name="$(basename "$liora_path")"; command_name="\${command_name%.exe}"; command_name="\${command_name%.cmd}"; command_name="\${command_name%.ps1}"; else bin_dir=${shellQuote(toBashPath(options.commandBinDir ?? defaultCheckoutCommandBinDir()))}; command_name="liora"; fi`,
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
  const dataHome = shellQuote(toBashPath(options.dataHome ?? getDataDir()));
  return [
    'set -e',
    'export COREPACK_ENABLE_DOWNLOAD_PROMPT=0',
    `if [ -z "\${SUPERLIORA_HOME:-}" ]; then export SUPERLIORA_HOME=${dataHome}; fi`,
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
  if (!(await hasUsableGitObjectStore(repoRoot))) {
    throw new Error('source checkout is missing git objects; it will be replaced');
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
