import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import {
  installBrowserUseSidecars,
  resolveBrowserUseInstallDir,
} from '#/utils/browser-use/sidecar-install';

const tempDirs: string[] = [];

afterEach(() => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir !== undefined) rmSync(dir, { recursive: true, force: true });
  }
});

function makeTempRoot(): string {
  const dir = mkdtempSync(join(tmpdir(), 'liora-sidecar-'));
  tempDirs.push(dir);
  return dir;
}

describe('browser-use packaged sidecar repair', () => {
  it('resolves the documented <root>/bin/liora.exe + <root>/node_modules layout', () => {
    const root = makeTempRoot();
    mkdirSync(join(root, 'bin'), { recursive: true });
    const resolution = resolveBrowserUseInstallDir(join(root, 'bin', 'liora.exe'));
    expect(resolution?.installDir).toBe(root);
    expect(resolution?.nodeModulesDir).toBe(join(root, 'node_modules'));
  });

  it('falls back to node_modules beside the exe when there is no bin/ parent', () => {
    const root = makeTempRoot();
    mkdirSync(join(root, 'node_modules'), { recursive: true });
    const resolution = resolveBrowserUseInstallDir(join(root, 'liora.exe'));
    expect(resolution?.installDir).toBe(root);
  });

  it('pins the installer sidecar versions and runs pnpm add in the install dir', () => {
    const root = makeTempRoot();
    const calls: { command: string; args: readonly string[]; cwd: string }[] = [];
    const result = installBrowserUseSidecars({
      execPath: join(root, 'bin', 'liora.exe'),
      run: (command, args, cwd) => {
        calls.push({ command, args, cwd });
        return { status: 0 };
      },
    });

    expect(result.ok).toBe(true);
    expect(calls).toHaveLength(1);
    expect(calls[0]?.cwd).toBe(root);
    expect(calls[0]?.command).toBe('corepack');
    expect(calls[0]?.args.slice(0, 3)).toEqual(['pnpm', 'add', '--ignore-workspace']);
    expect(calls[0]?.args.join(' ')).toMatch(/cloakbrowser@/u);
    expect(calls[0]?.args.join(' ')).toMatch(/playwright-core@/u);
    expect(existsSync(join(root, 'node_modules'))).toBe(true);
  });

  it('reports the installer stderr when the sidecar add fails', () => {
    const root = makeTempRoot();
    const result = installBrowserUseSidecars({
      execPath: join(root, 'bin', 'liora.exe'),
      run: () => ({ status: 1, stderr: 'network unreachable' }),
    });
    expect(result.ok).toBe(false);
    expect(result.detail).toContain('network unreachable');
    expect(result.detail).toContain(root);
  });
});
