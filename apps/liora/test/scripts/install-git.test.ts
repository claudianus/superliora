import { mkdir, mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { ensureRuntimePrereqs } from '#/cli/update/runtime-prereqs';
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
  });

  it('upgrade prereq hook finds shipped ensure-git from the CLI package root', async () => {
    const result = await ensureRuntimePrereqs(getHostPackageRoot());
    expect(result.gitOk).toBe(true);
    if (process.platform === 'win32') {
      expect(result.gitBootstrapped).toBe(false);
    }
  });
});
