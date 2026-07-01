import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

import { getHostPackageRoot } from '#/cli/version';

import type { UpdateTarget } from './types';

const SUPER_KIMI_REPO_PATTERN = /github\.com[:/]claudianus\/super-kimi-code(?:\.git)?$/i;

export interface GitCheckoutTarget extends UpdateTarget {
  readonly repoRoot: string;
  readonly upstream: string;
}

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

export function isSuperKimiGithubRemote(remoteUrl: string): boolean {
  return SUPER_KIMI_REPO_PATTERN.test(remoteUrl.trim());
}

export async function detectSuperKimiGithubCheckout(
  startPath: string = getHostPackageRoot(),
): Promise<string | null> {
  const repoRoot = findGitCheckoutRoot(startPath);
  if (repoRoot === null) return null;
  const origin = await execGit(repoRoot, ['config', '--get', 'remote.origin.url']).catch(() => '');
  return isSuperKimiGithubRemote(origin) ? repoRoot : null;
}

export function gitCheckoutUpdateCommand(repoRoot: string = findGitCheckoutRoot() ?? '.'): string {
  const quotedRoot = shellQuote(repoRoot);
  return [
    `git -C ${quotedRoot} pull --ff-only`,
    `corepack pnpm -C ${quotedRoot} install`,
    `corepack pnpm -C ${quotedRoot} --filter @moonshot-ai/kimi-code run build`,
  ].join(' && ');
}

export function gitCheckoutUpdateScript(repoRoot: string = findGitCheckoutRoot() ?? '.'): string {
  const quotedRoot = shellQuote(repoRoot);
  return [
    'set -e',
    `repo=${quotedRoot}`,
    'git -C "$repo" diff --quiet',
    'git -C "$repo" diff --cached --quiet',
    'git -C "$repo" pull --ff-only',
    'corepack pnpm -C "$repo" install',
    'corepack pnpm -C "$repo" --filter @moonshot-ai/kimi-code run build',
  ].join('; ');
}

export async function refreshGitCheckoutUpdateTarget(
  repoRoot: string = findGitCheckoutRoot() ?? '',
): Promise<GitCheckoutTarget | null> {
  if (repoRoot.length === 0) return null;
  await execGit(repoRoot, ['fetch', '--quiet']);
  const upstream = await execGit(repoRoot, ['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{u}']);
  const local = await execGit(repoRoot, ['rev-parse', 'HEAD']);
  const remote = await execGit(repoRoot, ['rev-parse', '@{u}']);
  if (local === remote) return null;

  const behind = Number(await execGit(repoRoot, ['rev-list', '--count', 'HEAD..@{u}']));
  const ahead = Number(await execGit(repoRoot, ['rev-list', '--count', '@{u}..HEAD']));
  if (!Number.isFinite(behind) || behind <= 0) return null;
  if (Number.isFinite(ahead) && ahead > 0) {
    throw new Error(`Git checkout has diverged from ${upstream}; update manually.`);
  }
  return {
    repoRoot,
    upstream,
    version: `${upstream}@${remote.slice(0, 12)}`,
  };
}
