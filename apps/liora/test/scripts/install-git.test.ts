import { mkdir, mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { ensureRuntimePrereqs, resolveInstallScript } from '#/cli/update/runtime-prereqs';
import { getHostPackageRoot } from '#/cli/version';

import {
  DEFAULT_PORTABLE_GIT,
  ensureGit,
  findExistingGit,
  gitRootFromBash,
  portableGitDownloadUrl,
  portableGitFilename,
} from '../../../../scripts/install/ensure-git.mjs';

const tempDirs: string[] = [];

async function makeDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'liora-git-'));
  tempDirs.push(dir);
  return dir;
}

describe('scripts/install/ensure-git', () => {
  afterEach(async () => {
    await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
  });

  it('names PortableGit assets per arch', () => {
    expect(portableGitFilename('x64')).toBe(`PortableGit-${DEFAULT_PORTABLE_GIT.version}-64-bit.7z.exe`);
    expect(portableGitFilename('arm64')).toBe(`PortableGit-${DEFAULT_PORTABLE_GIT.version}-arm64.7z.exe`);
    expect(portableGitDownloadUrl('x64')).toContain(DEFAULT_PORTABLE_GIT.tag);
    expect(portableGitDownloadUrl('x64')).toContain('64-bit.7z.exe');
  });

  it('derives the Git root from bash.exe layouts', () => {
    expect(gitRootFromBash('C:\\Program Files\\Git\\bin\\bash.exe')).toBe('C:\\Program Files\\Git');
    expect(gitRootFromBash('C:\\Git\\usr\\bin\\bash.exe')).toBe('C:\\Git');
  });

  it('honors LIORA_SHELL_PATH before well-known paths', () => {
    const found = findExistingGit({
      platform: 'win32',
      env: { LIORA_SHELL_PATH: 'E:\\docs\\bash.exe' },
      isFile: (p: string) => p === 'E:\\docs\\bash.exe',
      runtimeDir: 'E:\\runtime-git',
    });
    expect(found?.bashPath).toBe('E:\\docs\\bash.exe');
    expect(found?.source).toBe('LIORA_SHELL_PATH');
  });

  it.skipIf(process.platform !== 'win32')('finds or bootstraps Git Bash on Windows', async () => {
    const result = await ensureGit({ noShellRc: true });
    expect(result.skipped).not.toBe(true);
    expect(result.bashPath?.toLowerCase()).toContain('bash.exe');
  });

  it('downloads PortableGit when no bash exists', async () => {
    const runtimeDir = await makeDir();
    let downloaded: { url: string; dest: string } | undefined;
    const prevShell = process.env['LIORA_SHELL_PATH'];
    delete process.env['LIORA_SHELL_PATH'];
    try {
      const result = await ensureGit({
        platform: 'win32',
        arch: 'x64',
        noShellRc: true,
        runtimeDir,
        env: {},
        isFile: () => false,
        downloadToFile: async (url: string, dest: string) => {
          downloaded = { url, dest };
        },
        extractSfx: async (_sfx: string, dest: string) => {
          await mkdir(join(dest, 'bin'), { recursive: true });
          await mkdir(join(dest, 'cmd'), { recursive: true });
          await writeFile(join(dest, 'bin', 'bash.exe'), 'bash');
          await writeFile(join(dest, 'cmd', 'git.exe'), 'git');
        },
      });
      expect(downloaded?.url).toContain('PortableGit-');
      expect(downloaded?.url).toContain('64-bit.7z.exe');
      expect(result.bootstrapped).toBe(true);
      expect(result.bashPath).toBe(join(runtimeDir, 'bin', 'bash.exe'));
      expect(result.gitPath).toBe(join(runtimeDir, 'cmd', 'git.exe'));
      expect(process.env['LIORA_SHELL_PATH']).toBe(join(runtimeDir, 'bin', 'bash.exe'));
    } finally {
      if (prevShell === undefined) delete process.env['LIORA_SHELL_PATH'];
      else process.env['LIORA_SHELL_PATH'] = prevShell;
    }
  });

  it('upgrade prereq hook finds shipped ensure-git from the CLI package root', async () => {
    expect(resolveInstallScript(getHostPackageRoot(), 'ensure-git.mjs')).toBeTruthy();

    const fakeRoot = await makeDir();
    const installDir = join(fakeRoot, 'scripts', 'install');
    await mkdir(installDir, { recursive: true });
    await writeFile(
      join(installDir, 'ensure-git.mjs'),
      [
        'export async function ensureGit(opts = {}) {',
        "  if (opts.noShellRc !== true) throw new Error('upgrade hook must pass noShellRc');",
        '  return { bootstrapped: false };',
        '}',
        '',
      ].join('\n'),
    );

    const result = await ensureRuntimePrereqs(fakeRoot);
    expect(result.gitOk).toBe(true);
    expect(result.gitBootstrapped).toBe(false);
  });
});

describe('scripts/install source checkout recovery', () => {
  afterEach(async () => {
    await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
  });

  it('replaces a hollow install dir instead of fetching into it', async () => {
    const { execFileSync } = await import('node:child_process');
    const { existsSync, mkdirSync, mkdtempSync, writeFileSync } = await import('node:fs');
    const { tmpdir } = await import('node:os');
    const { join } = await import('node:path');
    const { fetchSource } = await import('../../../../scripts/install/source.mjs');
    const { hasUsableGitObjectStore } = await import('../../../../scripts/install/checkout-health.mjs');

    const upstream = mkdtempSync(join(tmpdir(), 'liora-src-up-'));
    tempDirs.push(upstream);
    const run = (dir: string, args: readonly string[]): string =>
      execFileSync('git', ['-C', dir, ...args], { encoding: 'utf-8' }).trim();
    run(upstream, ['init', '--initial-branch=main']);
    run(upstream, ['config', 'user.email', 'test@example.com']);
    run(upstream, ['config', 'user.name', 'Test']);
    writeFileSync(join(upstream, 'package.json'), '{"name":"superliora-fixture","private":true}\n');
    run(upstream, ['add', 'package.json']);
    run(upstream, ['commit', '-m', 'init']);

    const parent = mkdtempSync(join(tmpdir(), 'liora-src-dest-'));
    tempDirs.push(parent);
    const installDir = join(parent, 'source');
    mkdirSync(join(installDir, '.git', 'refs', 'heads'), { recursive: true });
    writeFileSync(join(installDir, '.git', 'HEAD'), 'ref: refs/heads/main\n');
    writeFileSync(
      join(installDir, '.git', 'refs', 'heads', 'main'),
      'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa\n',
    );
    writeFileSync(
      join(installDir, '.git', 'config'),
      '[remote "origin"]\n\turl = https://github.com/claudianus/superliora.git\n',
    );
    expect(hasUsableGitObjectStore(installDir)).toBe(false);

    const result = await fetchSource({
      repoUrl: upstream,
      ref: 'main',
      installDir,
      force: true,
    });
    expect(result.installDir).toBe(installDir);
    expect(existsSync(join(installDir, 'package.json'))).toBe(true);
    expect(hasUsableGitObjectStore(installDir)).toBe(true);
    expect(existsSync(`${installDir}.partial`)).toBe(false);
  });
});

