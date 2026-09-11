import { describe, expect, it, vi } from 'vitest';

import type { Kaos } from '@superliora/kaos';

import { checkGhCliAuth } from '../../../src/autopilot/git';

function fakeKaos(execResult: { readonly code: number | null; readonly stdout: string; readonly stderr: string }): Kaos {
  const stdout = {
    setEncoding: () => undefined,
    on: (_event: string, cb: (chunk: string) => void) => {
      if (_event === 'data') cb(execResult.stdout);
      if (_event === 'end') setTimeout(() => cb(''), 0);
      return stdout;
    },
  } as unknown as NodeJS.ReadableStream;
  const stderr = {
    setEncoding: () => undefined,
    on: (_event: string, cb: (chunk: string) => void) => {
      if (_event === 'data') cb(execResult.stderr);
      if (_event === 'end') setTimeout(() => cb(''), 0);
      return stderr;
    },
  } as unknown as NodeJS.ReadableStream;
  const stdin = { end: () => undefined } as unknown as NodeJS.Writable;
  return {
    exec: vi.fn(async () => ({
      stdin,
      stdout,
      stderr,
      kill: async () => true,
      wait: async () => execResult.code,
    })),
  } as unknown as Kaos;
}

describe('checkGhCliAuth', () => {
  it('reports ok with the account login on a valid gh api user call', async () => {
    const kaos = fakeKaos({ code: 0, stdout: 'octocat\n', stderr: '' });
    const status = await checkGhCliAuth(kaos);
    expect(status.state).toBe('ok');
    expect(status.account).toBe('octocat');
  });

  it('reports logged_out on 401 with the login hint', async () => {
    const kaos = fakeKaos({
      code: 1,
      stdout: '',
      stderr: 'gh: Unauthorized (HTTP 401)\ngh auth login required',
    });
    const status = await checkGhCliAuth(kaos);
    expect(status.state).toBe('logged_out');
    expect(status.detail).toContain('gh auth login');
  });

  it('reports binary_missing when gh is not installed', async () => {
    const kaos = fakeKaos({
      code: null,
      stdout: '',
      stderr: 'Error: spawn gh ENOENT — executable file not found',
    });
    const status = await checkGhCliAuth(kaos);
    expect(status.state).toBe('binary_missing');
    expect(status.detail).toContain('https://cli.github.com');
  });

  it('reports unknown for other failures with the raw detail', async () => {
    const kaos = fakeKaos({ code: 2, stdout: '', stderr: 'gh: network unreachable' });
    const status = await checkGhCliAuth(kaos);
    expect(status.state).toBe('unknown');
    expect(status.detail).toContain('network unreachable');
  });
});
