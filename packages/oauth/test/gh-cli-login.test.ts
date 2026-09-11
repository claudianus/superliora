import { describe, expect, it, vi } from 'vitest';

import {
  classifyGhAuthStatus,
  isGhBinaryMissingError,
  parseGhAuthStatusAccount,
  probeGhCliLogin,
} from '../src/profiles/gh-cli-login';

describe('gh CLI login probe', () => {
  it('classifies a logged-in gh auth status', () => {
    const status = classifyGhAuthStatus({
      errText: '',
      stdout: 'github.com\n  ✓ Logged in to github.com as octocat (keyring)\n',
      stderr: '',
      exitCode: 0,
    });
    expect(status.state).toBe('ok');
    expect(status.account).toBe('octocat');
  });

  it('classifies not-logged-in as logged_out with a login hint', () => {
    const status = classifyGhAuthStatus({
      errText: '',
      stdout: '',
      stderr: 'You are not logged into any GitHub hosts. Run gh auth login to log in.',
      exitCode: 1,
    });
    expect(status.state).toBe('logged_out');
    expect(status.detail).toContain('gh auth login');
  });

  it('classifies a missing gh binary from spawn errors', () => {
    expect(isGhBinaryMissingError('spawn gh ENOENT')).toBe(true);
    expect(isGhBinaryMissingError('command not found: gh')).toBe(true);
    const status = classifyGhAuthStatus({
      errText: 'Error: spawn gh ENOENT',
      stdout: '',
      stderr: '',
      exitCode: null,
    });
    expect(status.state).toBe('binary_missing');
    expect(status.detail).toContain('https://cli.github.com');
  });

  it('reports probe failure honestly for other errors', () => {
    const status = classifyGhAuthStatus({
      errText: 'ETIMEDOUT after 5000ms',
      stdout: '',
      stderr: '',
      exitCode: null,
    });
    expect(status.state).toBe('probe_failed');
  });

  it('extracts the account token from gh auth status output', () => {
    expect(
      parseGhAuthStatusAccount('github.com\n  ✓ Logged in to github.com account octocat (keyring)'),
    ).toBe('octocat');
    expect(parseGhAuthStatusAccount('no accounts')).toBeUndefined();
  });

  it('probeGhCliLogin maps execFile results without throwing', async () => {
    const execFile = vi.fn(
      (
        _cmd: string,
        _args: readonly string[],
        _opts: { timeout: number; windowsHide: boolean },
        cb: (err: Error | null, stdout: string, stderr: string) => void,
      ) => {
        cb(new Error('gh auth login required'), '', 'not logged in');
      },
    );
    const status = await probeGhCliLogin({ execFile: execFile as never });
    expect(status.state).toBe('logged_out');
  });
});
