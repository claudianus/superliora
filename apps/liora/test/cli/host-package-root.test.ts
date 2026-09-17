import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it, vi } from 'vitest';

import { handleBrowserUseCommand } from '#/cli/sub/browser-use';
import {
  hostPackageJsonSearchRoots,
  resolveHostPackageJsonPath,
} from '#/cli/version';
describe('host package root fallbacks', () => {
  it('finds bin/package.json from execPath when module dir has no manifest', () => {
    const tmp = mkdtempSync(join(tmpdir(), 'liora-host-pkg-'));
    const moduleDir = join(tmp, 'empty-module');
    const binDir = join(tmp, 'bin');
    mkdirSync(moduleDir);
    mkdirSync(binDir);
    const pkgPath = join(binDir, 'package.json');
    writeFileSync(pkgPath, '{"name":"superliora-host","private":true}\n');

    const roots = hostPackageJsonSearchRoots({
      moduleDir,
      execPath: join(binDir, 'liora.exe'),
      argv0: join(binDir, 'liora.exe'),
    });
    expect(resolveHostPackageJsonPath(roots)).toBe(pkgPath);
  });

  it('resolveHostPackageJsonPath returns undefined when search roots are empty', () => {
    expect(resolveHostPackageJsonPath([])).toBeUndefined();
  });
});

describe('handleBrowserUseCommand packaged host', () => {
  it('doctor still probes runtimes when packageRoot is missing (no source-restart gate)', async () => {
    const info = vi.fn().mockResolvedValue({
      ok: true,
      code: 0,
      stdout: 'probes-ok',
      stderr: '',
      command: ['info'],
    });
    const stdout: string[] = [];
    const stderr: string[] = [];

    await expect(handleBrowserUseCommand('doctor', {
      stdout: { write: (chunk: string) => { stdout.push(chunk); return true; } },
      stderr: { write: (chunk: string) => { stderr.push(chunk); return true; } },
      packageRoot: () => undefined,
      info,
    })).resolves.toBe(0);

    expect(info).toHaveBeenCalledWith({ packageRoot: undefined, quiet: true });
    expect(stderr.join('')).not.toMatch(/source GUI|소스 GUI/i);
    expect(stdout.join('')).toContain('probes-ok');
  });

  it('install without packageRoot repairs the node_modules sidecars first', async () => {
    const install = vi.fn().mockResolvedValue({
      ok: true,
      code: 0,
      stdout: 'browsers-ok',
      stderr: '',
      command: ['install'],
    });
    const installSidecars = vi.fn().mockReturnValue({ ok: true, detail: 'sidecars installed' });
    const stdout: string[] = [];

    await expect(handleBrowserUseCommand('install', {
      stdout: { write: (chunk: string) => { stdout.push(chunk); return true; } },
      stderr: { write: () => true },
      packageRoot: () => undefined,
      // H1: the gate is the disk-sidecar probe, not packageRoot.
      probeSidecars: () => ({ ready: false }),
      install,
      installSidecars,
    })).resolves.toBe(0);

    expect(installSidecars).toHaveBeenCalledTimes(1);
    expect(install).toHaveBeenCalledWith({ packageRoot: undefined, quiet: true });
    expect(stdout.join('')).toContain('sidecars installed');
  });

  // H1 regression: a stray package.json on the walk-up path (e.g.
  // $HOME/package.json or ~/.local/package.json left by an npx/pnpm run) used to
  // make tryGetHostPackageRoot() return a non-checkout directory, which skipped
  // this repair while doctor kept passing — every launch then failed with
  // "no cloakbrowser package found on disk".
  it('skips sidecar repair when the sidecars already resolve from disk', async () => {
    const install = vi.fn().mockResolvedValue({
      ok: true,
      code: 0,
      stdout: 'browsers-ok',
      stderr: '',
      command: ['install'],
    });
    const installSidecars = vi.fn().mockReturnValue({ ok: true, detail: 'should not run' });

    await expect(handleBrowserUseCommand('install', {
      stdout: { write: () => true },
      stderr: { write: () => true },
      // Non-undefined packageRoot is exactly the case the old gate broke on.
      packageRoot: () => '/Users/someone/.local',
      probeSidecars: () => ({ ready: true }),
      install,
      installSidecars,
    })).resolves.toBe(0);

    expect(installSidecars).not.toHaveBeenCalled();
    expect(install).toHaveBeenCalledTimes(1);
  });

  it('install continues with browser setup when sidecar repair fails', async () => {
    const install = vi.fn().mockResolvedValue({
      ok: true,
      code: 0,
      stdout: 'browsers-ok',
      stderr: '',
      command: ['install'],
    });
    const installSidecars = vi.fn().mockReturnValue({ ok: false, detail: 'sidecar install failed: boom' });
    const stderr: string[] = [];

    await expect(handleBrowserUseCommand('install', {
      stdout: { write: () => true },
      stderr: { write: (chunk: string) => { stderr.push(chunk); return true; } },
      packageRoot: () => undefined,
      probeSidecars: () => ({ ready: false }),
      install,
      installSidecars,
    })).resolves.toBe(0);

    expect(install).toHaveBeenCalledTimes(1);
    expect(stderr.join('')).toContain('sidecar install failed');
  });
});
