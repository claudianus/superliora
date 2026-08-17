import { mkdir, mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { ensureRuntimePrereqs } from '#/cli/update/runtime-prereqs';
import { getHostPackageRoot } from '#/cli/version';

import {
  DEFAULT_PNPM_VERSION,
  pnpmRuntimeBin,
  pnpmStandaloneUrl,
} from '../../../../scripts/install/platform.mjs';
import { ensurePnpm, resolvePnpm, runPnpm } from '../../../../scripts/install/ensure-pnpm.mjs';

const tempDirs: string[] = [];

async function makeDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'liora-pnpm-'));
  tempDirs.push(dir);
  return dir;
}

function failingSpawn() {
  return { status: 1, stdout: '', stderr: 'missing' };
}

describe('scripts/install/ensure-pnpm', () => {
  afterEach(async () => {
    await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
  });

  it('prefers corepack pnpm when the probe succeeds', () => {
    const found = resolvePnpm({
      spawnInstall: (cmd: string, args: readonly string[]) => {
        if (cmd === 'corepack' && args[0] === 'pnpm' && args[1] === '--version') {
          return { status: 0, stdout: '10.33.0\n' };
        }
        return failingSpawn();
      },
    });
    expect(found).toMatchObject({ cmd: 'corepack', prefix: ['pnpm'], source: 'corepack' });
  });

  it('falls back to pnpm on PATH', () => {
    const found = resolvePnpm({
      spawnInstall: (cmd: string) => {
        if (cmd === 'pnpm') return { status: 0, stdout: '10.33.0\n' };
        return failingSpawn();
      },
    });
    expect(found).toMatchObject({ cmd: 'pnpm', prefix: [], source: 'path' });
  });

  it('uses a previously bootstrapped runtime binary', () => {
    const dest = pnpmRuntimeBin('/rt-pnpm', 'linux');
    const prevPath = process.env['PATH'];
    try {
      const found = resolvePnpm({
        platform: 'linux',
        runtimeDir: '/rt-pnpm',
        noShellRc: true,
        isFile: (p: string) => p === dest,
        spawnInstall: (cmd: string) => {
          if (cmd === dest) return { status: 0, stdout: '10.33.0\n' };
          return failingSpawn();
        },
      });
      expect(found).toMatchObject({ cmd: dest, prefix: [], source: 'runtime' });
    } finally {
      process.env['PATH'] = prevPath;
    }
  });

  it('runPnpm prefixes corepack when that is the resolved command', () => {
    const calls: Array<{ cmd: string; args: readonly string[] }> = [];
    const result = runPnpm(['install', '--frozen-lockfile'], {
      cwd: '/repo',
      spawnInstall: (cmd: string, args: readonly string[]) => {
        calls.push({ cmd, args });
        if (cmd === 'corepack' && args[0] === 'pnpm' && args[1] === '--version') {
          return { status: 0, stdout: '10.33.0\n' };
        }
        return { status: 0, stdout: '' };
      },
    });
    expect(result.status).toBe(0);
    expect(calls.at(-1)).toEqual({
      cmd: 'corepack',
      args: ['pnpm', 'install', '--frozen-lockfile'],
    });
  });

  it('downloads the standalone binary when Corepack and PATH pnpm are missing', async () => {
    const runtimeDir = await makeDir();
    let downloaded: { url: string; dest: string } | undefined;
    const dest = pnpmRuntimeBin(runtimeDir, 'win32');
    const prevPath = process.env['PATH'];
    const result = await ensurePnpm({
      platform: 'win32',
      arch: 'x64',
      noShellRc: true,
      runtimeDir,
      isFile: () => false,
      spawnInstall: (cmd: string) => {
        if (cmd === dest) return { status: 0, stdout: `${DEFAULT_PNPM_VERSION}\n` };
        return failingSpawn();
      },
      downloadToFile: async (url: string, file: string) => {
        downloaded = { url, dest: file };
        await mkdir(runtimeDir, { recursive: true });
        await writeFile(file, 'pnpm');
      },
    });
    try {
      expect(downloaded?.url).toBe(pnpmStandaloneUrl(DEFAULT_PNPM_VERSION, 'win32', 'x64'));
      expect(result.bootstrapped).toBe(true);
      expect(result.source).toBe('runtime');
      expect(result.cmd).toBe(dest);
      expect(result.version).toBe(DEFAULT_PNPM_VERSION);
    } finally {
      process.env['PATH'] = prevPath;
    }
  });

  it('upgrade prereq hook finds shipped ensure-pnpm from the CLI package root', async () => {
    const result = await ensureRuntimePrereqs(getHostPackageRoot());
    expect(result.pnpmOk).toBe(true);
  });
});
