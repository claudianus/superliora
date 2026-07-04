import { describe, expect, it, vi } from 'vitest';

import { handleBrowserUseCommand } from '#/cli/sub/browser-use';
import { handleComputerUseCommand } from '#/cli/sub/computer-use';
import type { ComputerUseRuntime, SetupCommandResult } from '@superliora/gui-use';

function captureOutput(): {
  stdout: string[];
  stderr: string[];
  writable: {
    stdout: { write(chunk: string): boolean };
    stderr: { write(chunk: string): boolean };
  };
} {
  const stdout: string[] = [];
  const stderr: string[] = [];
  return {
    stdout,
    stderr,
    writable: {
      stdout: { write: (chunk: string) => { stdout.push(chunk); return true; } },
      stderr: { write: (chunk: string) => { stderr.push(chunk); return true; } },
    },
  };
}

function setupResult(overrides: Partial<SetupCommandResult> = {}): SetupCommandResult {
  return {
    ok: true,
    code: 0,
    stdout: '',
    stderr: '',
    command: ['cmd'],
    ...overrides,
  };
}

describe('browser-use CLI commands', () => {
  it('runs CloakBrowser install from the host package root', async () => {
    const { stdout, stderr, writable } = captureOutput();
    const install = vi.fn().mockResolvedValue(setupResult({ stdout: 'installed\n' }));

    await expect(handleBrowserUseCommand('install', {
      ...writable,
      packageRoot: () => '/repo/apps/liora',
      install,
    })).resolves.toBe(0);

    expect(install).toHaveBeenCalledWith({ cwd: '/repo/apps/liora', quiet: true });
    expect(stdout.join('')).toBe('installed\n');
    expect(stderr.join('')).toBe('');
  });

  it('reports recovery command when CloakBrowser status fails', async () => {
    const { stderr, writable } = captureOutput();
    const info = vi.fn().mockResolvedValue(setupResult({
      ok: false,
      code: 1,
      stderr: 'not ready\n',
    }));

    await expect(handleBrowserUseCommand('status', {
      ...writable,
      packageRoot: () => '/repo',
      info,
    })).resolves.toBe(1);

    expect(stderr.join('')).toContain('not ready');
    expect(stderr.join('')).toContain('liora browser-use install');
  });
});

describe('computer-use CLI commands', () => {
  it('auto-installs cua-driver when status finds it missing', async () => {
    const { stdout, writable } = captureOutput();
    const install = vi.fn().mockResolvedValue(setupResult({ stdout: 'installed\n' }));
    const status = vi
      .fn()
      .mockReturnValueOnce({ installed: false, error: 'ENOENT' })
      .mockReturnValueOnce({ installed: true, version: 'cua-driver 1.0.0' });

    await expect(handleComputerUseCommand('status', {
      ...writable,
      install,
      status,
    })).resolves.toBe(0);

    expect(install).toHaveBeenCalledWith({ quiet: true });
    expect(status).toHaveBeenCalledTimes(2);
    expect(stdout.join('')).toContain('installed\n');
    expect(stdout.join('')).toContain('"installed": true');
  });

  it('returns non-zero status when automatic cua-driver install fails', async () => {
    const { stdout, stderr, writable } = captureOutput();

    await expect(handleComputerUseCommand('status', {
      ...writable,
      install: vi.fn().mockResolvedValue(setupResult({
        ok: false,
        code: 1,
        stderr: 'install failed\n',
      })),
      status: () => ({ installed: false, error: 'ENOENT' }),
    })).resolves.toBe(1);

    expect(stdout.join('')).toContain('"installed": false');
    expect(stdout.join('')).toContain('ENOENT');
    expect(stderr.join('')).toContain('install failed');
    expect(stderr.join('')).toContain('Computer-use auto-install failed');
  });

  it('runs doctor through the runtime status method and closes it', async () => {
    const { stdout, writable } = captureOutput();
    const close = vi.fn().mockResolvedValue(undefined);
    const runtime: ComputerUseRuntime = {
      capture: vi.fn(),
      act: vi.fn(),
      status: vi.fn().mockResolvedValue({
        platform: 'darwin',
        installed: true,
        ready: true,
        health: { overall: 'ok' },
      }),
      close,
    };

    await expect(handleComputerUseCommand('doctor', {
      ...writable,
      createRuntime: () => runtime,
    })).resolves.toBe(0);

    expect(stdout.join('')).toContain('"overall": "ok"');
    expect(close).toHaveBeenCalledTimes(1);
  });

  it('prints platform permission guidance without installing cua-driver', async () => {
    const { stdout, writable } = captureOutput();

    await expect(handleComputerUseCommand('permissions', {
      ...writable,
      platform: 'darwin',
    })).resolves.toBe(0);

    expect(stdout.join('')).toContain('Accessibility');
    expect(stdout.join('')).toContain('Screen Recording');
  });
});
