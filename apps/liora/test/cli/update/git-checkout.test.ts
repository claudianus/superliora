import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import {
  defaultCheckoutCommandBinDir,
  detectSuperLioraGithubCheckout,
  discardUnhealthyManagedCheckout,
  findGitCheckoutRoot,
  gitCheckoutUpdateScript,
  hasUsableGitObjectStore,
  isGitCheckoutDirty,
  refreshGitCheckoutUpdateTarget,
} from '#/cli/update/git-checkout';

const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

function runGit(repoRoot: string, args: readonly string[]): string {
  return execFileSync('git', ['-C', repoRoot, ...args], { encoding: 'utf-8' }).trim();
}

function initBareRemote(): { readonly bareDir: string; readonly remoteUrl: string } {
  const bareDir = mkdtempSync(join(tmpdir(), 'liora-upstream-'));
  tempDirs.push(bareDir);
  // Pin the branch name: on a host whose `init.defaultBranch` is `master` the
  // bare HEAD would point at a ref this test never pushes, and clones would
  // land with no working tree at all.
  runGit(bareDir, ['init', '--bare', '--initial-branch=main']);
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
    expect(script).toContain('-c core.longpaths=true fetch --depth 1 origin "$ref"');
    // Align with install.sh: force-checkout, no dirty pre-check that traps upgrades.
    expect(script).not.toContain('diff --quiet');
    expect(script).toContain('checkout --force -B "$ref" FETCH_HEAD');
    expect(script).toContain('reset --hard FETCH_HEAD');
    expect(script).not.toContain('checkout --force FETCH_HEAD\n');
    expect(script).toContain("__LIORA_UPGRADE_STAGE__=building");
    expect(script).toContain('scripts/install/ensure-pnpm.mjs');
    expect(script).toContain('$SUPERLIORA_HOME/runtime/pnpm');
    expect(script).toContain('runtime/pnpm/pnpm');
    expect(script).toContain('runtime/pnpm/pnpm.exe');
    expect(script).not.toContain('${HOME}/.superliora/runtime/pnpm');
    expect(script).not.toContain('${USERPROFILE}/.superliora/runtime/pnpm');
    expect(script).toContain('pnpm_invoke');
    expect(script).toContain('install --frozen-lockfile');
    expect(script).toContain('build:skill-catalog');
    expect(script).toContain('SUPERLIORA_SKIP_SKILL_CATALOG');
    expect(script).toContain('run build:packages');
    expect(script).toContain('apps/liora run build');
    expect(script).toContain('retrieval:bootstrap');
    expect(script).toContain('SUPERLIORA_OBSERVED_UPGRADE');
    expect(script).toContain("__LIORA_UPGRADE_STAGE__=installing");
    expect(script).toContain('command -v liora.cmd');
    expect(script).toContain('${command_name%.cmd}');
    expect(script).not.toContain('bin_dir="${HOME}/.local/bin"');
    expect(script).toContain('scripts/install-liora.mjs --bin-dir "$bin_dir" --name "$command_name" --no-shell-rc --force');
    expect(script).toContain("__LIORA_UPGRADE_STAGE__=done");
  });

  it('bakes relocated SUPERLIORA_HOME and Windows SuperLiora bin fallback', () => {
    const script = gitCheckoutUpdateScript('/tmp/superliora', {
      dataHome: 'D:\\SuperLiora',
      commandBinDir: 'C:\\Users\\me\\AppData\\Local\\SuperLiora\\bin',
    });

    expect(script).toContain("export SUPERLIORA_HOME='D:/SuperLiora'");
    expect(script).toContain('$SUPERLIORA_HOME/runtime/pnpm/pnpm.exe');
    expect(script).toContain("bin_dir='C:/Users/me/AppData/Local/SuperLiora/bin'");
    expect(script).not.toContain('${HOME}/.local/bin');
    expect(script).not.toContain('${HOME}/.superliora/runtime/pnpm');
  });
});

describe('defaultCheckoutCommandBinDir', () => {
  it('uses LOCALAPPDATA SuperLiora bin on Windows, ~/.local/bin elsewhere', () => {
    expect(
      defaultCheckoutCommandBinDir('win32', {
        LOCALAPPDATA: 'C:\\Users\\me\\AppData\\Local',
      }),
    ).toBe('C:\\Users\\me\\AppData\\Local\\SuperLiora\\bin');
    expect(
      defaultCheckoutCommandBinDir('linux', {
        HOME: '/home/me',
      }),
    ).toBe('/home/me/.local/bin');
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
    const head = runGit(repoRoot, ['rev-parse', 'HEAD']);
    await expect(refreshGitCheckoutUpdateTarget(repoRoot)).resolves.toMatchObject({
      status: 'up-to-date',
      dirty: false,
      head,
      upstream: 'origin/main',
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

  it('rejects a checkout whose HEAD object is missing', async () => {
    const { remoteUrl } = initBareRemote();
    const repoRoot = initCheckout(remoteUrl);
    await expect(refreshGitCheckoutUpdateTarget(repoRoot)).resolves.toMatchObject({
      status: 'up-to-date',
    });
    rmSync(join(repoRoot, '.git', 'objects'), { recursive: true, force: true });
    mkdirSync(join(repoRoot, '.git', 'objects'));
    await expect(refreshGitCheckoutUpdateTarget(repoRoot)).rejects.toThrow(
      'source checkout is missing git objects',
    );
  });
});

function writeHollowCheckout(repoRoot: string): void {
  mkdirSync(join(repoRoot, '.git', 'refs', 'heads'), { recursive: true });
  writeFileSync(join(repoRoot, '.git', 'HEAD'), 'ref: refs/heads/main\n');
  writeFileSync(
    join(repoRoot, '.git', 'refs', 'heads', 'main'),
    'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa\n',
  );
  writeFileSync(
    join(repoRoot, '.git', 'config'),
    '[remote "origin"]\n\turl = https://github.com/claudianus/superliora.git\n',
  );
}

describe('detectSuperLioraGithubCheckout', () => {
  it('returns null for a hollow clone that still has origin set', async () => {
    const repoRoot = mkdtempSync(join(tmpdir(), 'liora-hollow-'));
    tempDirs.push(repoRoot);
    writeHollowCheckout(repoRoot);
    await expect(hasUsableGitObjectStore(repoRoot)).resolves.toBe(false);
    await expect(detectSuperLioraGithubCheckout(repoRoot, { walkParents: false })).resolves.toBeNull();
  });

  it('does not walk above an explicit managed path', async () => {
    const parent = mkdtempSync(join(tmpdir(), 'liora-managed-parent-'));
    tempDirs.push(parent);
    const nested = join(parent, 'source');
    mkdirSync(nested, { recursive: true });
    runGit(parent, ['init']);
    runGit(parent, ['config', 'user.email', 'test@example.com']);
    runGit(parent, ['config', 'user.name', 'Test']);
    writeFileSync(join(parent, 'README.md'), 'parent\n');
    runGit(parent, ['add', 'README.md']);
    runGit(parent, ['commit', '-m', 'parent']);
    runGit(parent, ['remote', 'add', 'origin', 'https://github.com/claudianus/superliora.git']);
    expect(findGitCheckoutRoot(nested, { walkParents: false })).toBeNull();
    await expect(detectSuperLioraGithubCheckout(nested, { walkParents: false })).resolves.toBeNull();
  });
});

describe('discardUnhealthyManagedCheckout', () => {
  it('removes a hollow managed tree and leaves a healthy one', async () => {
    const hollow = mkdtempSync(join(tmpdir(), 'liora-discard-hollow-'));
    tempDirs.push(hollow);
    writeHollowCheckout(hollow);
    await expect(discardUnhealthyManagedCheckout(hollow)).resolves.toBe(true);
    expect(findGitCheckoutRoot(hollow, { walkParents: false })).toBeNull();

    const { remoteUrl } = initBareRemote();
    const healthy = initCheckout(remoteUrl);
    await expect(discardUnhealthyManagedCheckout(healthy)).resolves.toBe(false);
    await expect(hasUsableGitObjectStore(healthy)).resolves.toBe(true);
  });
});
