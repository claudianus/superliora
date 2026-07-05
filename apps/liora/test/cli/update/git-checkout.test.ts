import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { refreshGitCheckoutUpdateTarget } from '#/cli/update/git-checkout';

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

describe('refreshGitCheckoutUpdateTarget', () => {
  it('detects updates when HEAD is detached but behind origin/main', () => {
    const { remoteUrl } = initBareRemote();
    const repoRoot = initCheckout(remoteUrl);

    writeFileSync(join(repoRoot, 'README.md'), 'v2\n');
    runGit(repoRoot, ['commit', '-am', 'v2']);
    runGit(repoRoot, ['push']);

    runGit(repoRoot, ['reset', '--hard', 'HEAD~1']);
    runGit(repoRoot, ['checkout', '--detach', 'HEAD']);

    return expect(refreshGitCheckoutUpdateTarget(repoRoot)).resolves.toMatchObject({
      upstream: 'origin/main',
      version: expect.stringContaining('origin/main@'),
    });
  });

  it('returns null when detached HEAD matches origin/main', async () => {
    const { remoteUrl } = initBareRemote();
    const repoRoot = initCheckout(remoteUrl);
    runGit(repoRoot, ['checkout', '--detach', 'HEAD']);
    await expect(refreshGitCheckoutUpdateTarget(repoRoot)).resolves.toBeNull();
  });
});
