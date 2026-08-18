import { win32 } from 'node:path';

import { describe, expect, it } from 'vitest';

import { findWindowsGitBash } from '#/cli/update/windows-git-bash';

const GIT_ROOT = 'C:\\Program Files\\Git';
const GIT_CMD_DIR = win32.join(GIT_ROOT, 'cmd');
const GIT_BASH = win32.join(GIT_ROOT, 'bin', 'bash.exe');
const SYSTEM32 = 'C:\\Windows\\System32';

function existsIn(paths: readonly string[]): (filePath: string) => boolean {
  const set = new Set(paths);
  return (filePath) => set.has(filePath);
}

describe('findWindowsGitBash', () => {
  it('derives bash.exe from git.exe on PATH', () => {
    const result = findWindowsGitBash({
      env: { PATH: [SYSTEM32, GIT_CMD_DIR].join(win32.delimiter) },
      exists: existsIn([win32.join(GIT_CMD_DIR, 'git.exe'), GIT_BASH]),
    });
    expect(result).toBe(GIT_BASH);
  });

  it('never resolves the System32 WSL bash launcher', () => {
    // System32 has bash.exe (WSL) but no git.exe; it must not count.
    const result = findWindowsGitBash({
      env: { PATH: SYSTEM32 },
      exists: existsIn([win32.join(SYSTEM32, 'bash.exe')]),
    });
    expect(result).toBeNull();
  });

  it('falls back to ProgramFiles when git is not on PATH', () => {
    const result = findWindowsGitBash({
      env: { Path: SYSTEM32, ProgramFiles: 'C:\\Program Files' },
      exists: existsIn([GIT_BASH]),
    });
    expect(result).toBe(GIT_BASH);
  });

  it('checks usr/bin/bash.exe and LOCALAPPDATA installs', () => {
    const localGit = 'C:\\Users\\me\\AppData\\Local\\Programs\\Git';
    const localBash = win32.join(localGit, 'usr', 'bin', 'bash.exe');
    const result = findWindowsGitBash({
      env: { LOCALAPPDATA: 'C:\\Users\\me\\AppData\\Local' },
      exists: existsIn([localBash]),
    });
    expect(result).toBe(localBash);
  });

  it('returns null when nothing is found', () => {
    expect(findWindowsGitBash({ env: {}, exists: () => false })).toBeNull();
  });
});
