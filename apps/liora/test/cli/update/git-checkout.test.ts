import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import {
  gitCheckoutUpdateScript,
  isGitCheckoutDirty,
  refreshGitCheckoutUpdateTarget,
} from '#/cli/update/git-checkout';

const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    execFileSync('rm', ['-rf', dir]);
  }
});

function runGit(repoRoot: string, args: readonly string[]): string {
  return execFileSync('git', ['-C', repoRoot, ...args], { encoding: 'utf-8' }).trim();
}

function initBareRemote(): { readonly bareDir: string; readonly remoteUrl: string } {
  const bareDir = mkdtempSync(join(tmpdir(), 'liora-upstream-'));
  tempDirs.push(bareDir);
  runGit(bareDir, ['init', '--bare']);
  return { bareDir, remoteUrl: bareDir };
}

function initCheckout(remoteUrl: string): string {
  const repoRoot = mkdtempSync(join(tmpdir(), 'liora-checkout-'));
  tempDirs.push(repoRoot);
  runGit(repoRoot, ['init']);
  runGit(repoRoot, ['config', 'user.email', 'test@example.com']);
  runGit(repoRoot, ['config', 'user.name', 'Test']);
  writeFileSync(join(repoRoot, 'README.md'), 'v1\n');
  runGit(repoRoot, ['add', 'README.md']);
  runGit(repoRoot, ['commit', '-m', 'v1']);
  runGit(repoRoot, ['branch', '-M', 'main']);
  runGit(repoRoot, ['remote', 'add', 'origin', remoteUrl]);
  runGit(repoRoot, ['push', '-u', 'origin', 'main']);
  return repoRoot;
}

function cloneCheckout(remoteUrl: string): string {
  const parent = mkdtempSync(join(tmpdir(), 'liora-sibling-'));
  tempDirs.push(parent);
  const repoRoot = join(parent, 'repo');
  execFileSync('git', ['clone', remoteUrl, repoRoot], { encoding: 'utf-8' });
  runGit(repoRoot, ['config', 'user.email', 'test@example.com']);
  runGit(repoRoot, ['config', 'user.name', 'Test']);
  return repoRoot;
}

describe('gitCheckoutUpdateScript', () => {
  it('matches install.sh fetch, build, and wrapper refresh steps', () => {
    const script = gitCheckoutUpdateScript('/tmp/superliora');

    expect(script).toContain("repo='/tmp/superliora'");
    expect(script).toContain('COREPACK_ENABLE_DOWNLOAD_PROMPT=0');
    expect(script).toContain("__LIORA_UPGRADE_STAGE__=fetching");
    expect(script).toContain('rev-parse --verify origin/main');
    expect(script).toContain("upstream='origin/master'");
    expect(script).toContain('fetch --depth 1 origin "$ref"');
    expect(script).toContain('checkout --force FETCH_HEAD');
    expect(script).toContain('reset --hard FETCH_HEAD');
    expect(script).toContain("__LIORA_UPGRADE_STAGE__=building");
    expect(script).toContain('install --frozen-lockfile');
    expect(script).toContain('run build:packages');
    expect(script).toContain('apps/liora run build');
    expect(script).toContain("__LIORA_UPGRADE_STAGE__=installing");
    expect(script).toContain('scripts/install-liora.mjs --bin-dir "$bin_dir" --name "$command_name" --no-shell-rc --force');
    expect(script).toContain("__LIORA_UPGRADE_STAGE__=done");
  });
});

describe('refreshGitCheckoutUpdateTarget', () => {
  it('detects updates when HEAD is detached but behind origin/main', async () => {
    const { remoteUrl } = initBareRemote();
    const repoRoot = initCheckout(remoteUrl);

    writeFileSync(join(repoRoot, 'README.md'), 'v2\n');
    runGit(repoRoot, ['commit', '-am', 'v2']);
    runGit(repoRoot, ['push']);

    runGit(repoRoot, ['reset', '--hard', 'HEAD~1']);
    runGit(repoRoot, ['checkout', '--detach', 'HEAD']);

    const result = await refreshGitCheckoutUpdateTarget(repoRoot);
    expect(result.status).toBe('update');
    if (result.status === 'update') {
      expect(result.target).toMatchObject({
        upstream: 'origin/main',
        version: expect.stringContaining('origin/main@'),
      });
      expect(result.dirty).toBe(false);
    }
  });

  it('returns up-to-date when detached HEAD matches origin/main', async () => {
    const { remoteUrl } = initBareRemote();
    const repoRoot = initCheckout(remoteUrl);
    runGit(repoRoot, ['checkout', '--detach', 'HEAD']);
    await expect(refreshGitCheckoutUpdateTarget(repoRoot)).resolves.toMatchObject({
      status: 'up-to-date',
      dirty: false,
    });
  });

  it('detects behind commits after an explicit origin fetch', async () => {
    const { remoteUrl } = initBareRemote();
    const repoRoot = initCheckout(remoteUrl);
    const sibling = cloneCheckout(remoteUrl);
    writeFileSync(join(sibling, 'README.md'), 'v2\n');
    runGit(sibling, ['commit', '-am', 'v2']);
    runGit(sibling, ['push']);
    const result = await refreshGitCheckoutUpdateTarget(repoRoot);
    expect(result.status).toBe('update');
    if (result.status === 'update') {
      expect(result.target.upstream).toMatch(/origin\//);
      expect(result.dirty).toBe(false);
    }
  });

  it('reports dirty without hiding an available update', async () => {
    const { remoteUrl } = initBareRemote();
    const repoRoot = initCheckout(remoteUrl);
    const sibling = cloneCheckout(remoteUrl);
    writeFileSync(join(sibling, 'README.md'), 'v2\n');
    runGit(sibling, ['commit', '-am', 'v2']);
    runGit(sibling, ['push']);
    writeFileSync(join(repoRoot, 'README.md'), 'local dirty\n');
    await expect(isGitCheckoutDirty(repoRoot)).resolves.toBe(true);
    const result = await refreshGitCheckoutUpdateTarget(repoRoot);
    expect(result.status).toBe('update');
    if (result.status === 'update') expect(result.dirty).toBe(true);
  });

  it('returns diverged when ahead of upstream', async () => {
    const { remoteUrl } = initBareRemote();
    const repoRoot = initCheckout(remoteUrl);
    writeFileSync(join(repoRoot, 'README.md'), 'local-only\n');
    runGit(repoRoot, ['commit', '-am', 'local-only']);
    const sibling = cloneCheckout(remoteUrl);
    writeFileSync(join(sibling, 'README.md'), 'remote-only\n');
    runGit(sibling, ['commit', '-am', 'remote-only']);
    runGit(sibling, ['push', '-f']);
    const result = await refreshGitCheckoutUpdateTarget(repoRoot);
    expect(result.status).toBe('diverged');
  });
});
