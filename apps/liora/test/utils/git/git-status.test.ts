/* eslint-disable import/first -- vi.mock setup must run before the imports it stubs out. */
import { afterEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  spawnSync: vi.fn(),
  execFile: vi.fn(),
}));

vi.mock('node:child_process', () => ({
  execFile: mocks.execFile,
  spawnSync: mocks.spawnSync,
}));

import {
  createGitStatusCache,
  formatGitBadge,
  formatPorcelainChangedFile,
} from '#/utils/git/git-status';

afterEach(() => {
  vi.useRealTimers();
  vi.clearAllMocks();
});

/**
 * Drain the async refresh chain: execFile callbacks resolve synchronously in
 * these mocks, but branch → status → diff each add microtask hops.
 */
async function flushRefreshes(): Promise<void> {
  for (let i = 0; i < 8; i++) {
    await Promise.resolve();
  }
}

describe('git status cache', () => {
  it('caches branch and status reads until their TTL expires', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-04-24T00:00:00Z'));
    mocks.execFile.mockImplementation(
      (
        _cmd: string,
        args: string[],
        _options: unknown,
        callback: (error: Error | null, stdout: string, stderr: string) => void,
      ) => {
        if (args.includes('branch')) {
          callback(null, 'main\n', '');
          return;
        }
        if (args.includes('status')) {
          callback(null, '## main...origin/main [ahead 2, behind 1]\n M src/app.ts\n', '');
          return;
        }
        if (args.includes('diff')) {
          callback(null, '4\t1\tsrc/app.ts\n', '');
          return;
        }
        callback(new Error('no pull request'), '', '');
      },
    );
    mocks.spawnSync.mockImplementation((_cmd: string, args: string[]) => {
      if (args.includes('rev-parse')) {
        return { status: 0, stdout: 'true\n' };
      }
      return { status: 0, stdout: 'origin\n' };
    });

    const cache = createGitStatusCache('/tmp/repo');
    // First read kicks the async refresh and returns nothing yet.
    expect(cache.getStatus()).toBeNull();

    await flushRefreshes();
    // The branch landing lets this read kick the status refresh; drain it.
    cache.getStatus();
    await flushRefreshes();

    expect(cache.getStatus()).toEqual({
      branch: 'main',
      dirty: true,
      ahead: 2,
      behind: 1,
      diffAdded: 4,
      diffDeleted: 1,
      changedFileCount: 1,
      changedFiles: ['M src/app.ts'],
      pullRequest: null,
    });
    const execFileCallsAfterRefresh = mocks.execFile.mock.calls.length;

    // Within the TTLs no new spawns happen.
    vi.setSystemTime(new Date('2026-04-24T00:00:04Z'));
    cache.getStatus();
    await flushRefreshes();
    expect(mocks.execFile.mock.calls.length).toBe(execFileCallsAfterRefresh);

    // Past the branch TTL only the branch read re-runs (status still cached).
    vi.setSystemTime(new Date('2026-04-24T00:00:06Z'));
    cache.getStatus();
    await flushRefreshes();
    expect(mocks.execFile.mock.calls.length).toBe(execFileCallsAfterRefresh + 1);

    // Past the status TTL the status + diff reads re-run.
    vi.setSystemTime(new Date('2026-04-24T00:00:16Z'));
    cache.getStatus();
    await flushRefreshes();
    expect(mocks.execFile.mock.calls.length).toBeGreaterThanOrEqual(execFileCallsAfterRefresh + 3);
  });

  it('reads uncommitted diff line counts and current pull request metadata', async () => {
    const onChange = vi.fn();
    mocks.execFile.mockImplementation(
      (
        _cmd: string,
        args: string[],
        _options: unknown,
        callback: (error: Error | null, stdout: string, stderr: string) => void,
      ) => {
        if (args.includes('branch')) {
          callback(null, 'feature/footer\n', '');
          return;
        }
        if (args.includes('status')) {
          callback(null, '## feature/footer...origin/feature/footer\n M src/app.ts\n', '');
          return;
        }
        if (args.includes('diff')) {
          callback(null, '10\t3\tsrc/app.ts\n-\t-\timage.png\n0\t5\tdeleted.ts\n', '');
          return;
        }
        callback(null, '{"number":12,"url":"https://github.com/acme/repo/pull/12"}\n', '');
      },
    );
    mocks.spawnSync.mockImplementation((_cmd: string, args: string[]) => {
      if (args.includes('rev-parse')) {
        return { status: 0, stdout: 'true\n' };
      }
      return { status: 0, stdout: 'origin\n' };
    });

    const cache = createGitStatusCache('/tmp/repo', { onChange });
    expect(cache.getStatus()).toBeNull();
    await flushRefreshes();
    // Second read kicks the status + PR refreshes now that a branch exists.
    cache.getStatus();
    await flushRefreshes();

    // branch, status, and PR each landed with a change → three callbacks.
    expect(onChange).toHaveBeenCalledTimes(3);
    expect(cache.getStatus()).toEqual({
      branch: 'feature/footer',
      dirty: true,
      ahead: 0,
      behind: 0,
      diffAdded: 10,
      diffDeleted: 8,
      changedFileCount: 1,
      changedFiles: ['M src/app.ts'],
      pullRequest: {
        number: 12,
        url: 'https://github.com/acme/repo/pull/12',
      },
    });
  });

  it('keeps footer git status working when gh pull-request lookup throws synchronously', async () => {
    const onChange = vi.fn();
    mocks.execFile.mockImplementation(
      (
        _cmd: string,
        args: string[],
        _options: unknown,
        callback: (error: Error | null, stdout: string, stderr: string) => void,
      ) => {
        if (args.includes('branch')) {
          callback(null, 'main\n', '');
          return;
        }
        if (args.includes('status')) {
          callback(null, '## main...origin/main\n M src/app.ts\n', '');
          return;
        }
        if (args.includes('diff')) {
          callback(null, '2\t1\tsrc/app.ts\n', '');
          return;
        }
        const error = Object.assign(new Error('spawn ENOTDIR'), { code: 'ENOTDIR' });
        throw error;
      },
    );
    mocks.spawnSync.mockImplementation((_cmd: string, args: string[]) => {
      if (args.includes('rev-parse')) {
        return { status: 0, stdout: 'true\n' };
      }
      return { status: 0, stdout: 'origin\n' };
    });

    const cache = createGitStatusCache('/tmp/repo', { onChange });
    expect(cache.getStatus()).toBeNull();
    await flushRefreshes();
    // Second read kicks the status + PR refreshes now that a branch exists.
    cache.getStatus();
    await flushRefreshes();

    // branch and status landed with a change; the PR lookup threw and never
    // resolved a value → no third callback.
    expect(onChange).toHaveBeenCalledTimes(2);
    expect(cache.getStatus()).toEqual({
      branch: 'main',
      dirty: true,
      ahead: 0,
      behind: 0,
      diffAdded: 2,
      diffDeleted: 1,
      changedFileCount: 1,
      changedFiles: ['M src/app.ts'],
      pullRequest: null,
    });
  });

  it('skips pull-request lookup when the repo has no remotes', async () => {
    mocks.execFile.mockImplementation(
      (
        _cmd: string,
        args: string[],
        _options: unknown,
        callback: (error: Error | null, stdout: string, stderr: string) => void,
      ) => {
        if (args.includes('branch')) {
          callback(null, 'main\n', '');
          return;
        }
        if (args.includes('status')) {
          callback(null, '## main\n M a.ts\n', '');
          return;
        }
        if (args.includes('diff')) {
          callback(null, '1\t0\ta.ts\n', '');
          return;
        }
        callback(null, '{"number":1,"url":"https://github.com/acme/repo/pull/1"}\n', '');
      },
    );
    mocks.spawnSync.mockImplementation((_cmd: string, args: string[]) => {
      if (args.includes('rev-parse')) {
        return { status: 0, stdout: 'true\n' };
      }
      return { status: 0, stdout: '\n' };
    });

    const cache = createGitStatusCache('/tmp/repo');
    cache.getStatus();
    await flushRefreshes();
    cache.getStatus();
    await flushRefreshes();
    const execFileCallsAfterRefresh = mocks.execFile.mock.calls.length;
    expect(cache.getStatus()?.dirty).toBe(true);
    await flushRefreshes();
    expect(mocks.execFile.mock.calls.length).toBe(execFileCallsAfterRefresh);
    expect(cache.getStatus()?.pullRequest).toBeNull();
  });

  it('returns null when the working directory is not a git repo and formats badges', () => {
    mocks.spawnSync.mockReturnValue({ status: 1, stdout: '' });
    expect(createGitStatusCache('/tmp/not-a-repo').getStatus()).toBeNull();
    expect(
      formatGitBadge({
        branch: 'main',
        dirty: true,
        ahead: 2,
        behind: 1,
        diffAdded: 12,
        diffDeleted: 3,
        changedFileCount: 0,
        changedFiles: [],
        pullRequest: null,
      }),
    ).toBe('main [+12 -3 ↑2↓1]');
    expect(
      formatGitBadge({
        branch: 'main',
        dirty: true,
        ahead: 0,
        behind: 0,
        diffAdded: 0,
        diffDeleted: 0,
        changedFileCount: 0,
        changedFiles: [],
        pullRequest: null,
      }),
    ).toBe('main [±]');
  });

  it('caps changed-file previews at three porcelain entries', async () => {
    mocks.execFile.mockImplementation(
      (
        _cmd: string,
        args: string[],
        _options: unknown,
        callback: (error: Error | null, stdout: string, stderr: string) => void,
      ) => {
        if (args.includes('branch')) {
          callback(null, 'main\n', '');
          return;
        }
        if (args.includes('status')) {
          callback(
            null,
            '## main\n' +
              ' M a.ts\n' +
              '?? b.ts\n' +
              ' D c.ts\n' +
              'A  d.ts\n' +
              ' M e.ts\n',
            '',
          );
          return;
        }
        if (args.includes('diff')) {
          callback(null, '1\t1\ta.ts\n', '');
          return;
        }
        callback(new Error('no pull request'), '', '');
      },
    );
    mocks.spawnSync.mockImplementation((_cmd: string, args: string[]) => {
      if (args.includes('rev-parse')) {
        return { status: 0, stdout: 'true\n' };
      }
      return { status: 0, stdout: 'origin\n' };
    });

    const cache = createGitStatusCache('/tmp/repo');
    expect(cache.getStatus()).toBeNull();
    await flushRefreshes();
    cache.getStatus();
    await flushRefreshes();

    const status = cache.getStatus();
    expect(status?.changedFiles).toEqual(['M a.ts', '~ b.ts', 'D c.ts']);
    expect(status?.changedFileCount).toBe(5);
  });

  it('formats compact porcelain previews for modified and untracked paths', () => {
    expect(formatPorcelainChangedFile(' M apps/liora/src/foo.ts')).toBe('M apps/liora/src/foo.ts');
    expect(formatPorcelainChangedFile('?? notes.tmp')).toBe('~ notes.tmp');
    expect(formatPorcelainChangedFile('R  old.ts -> new.ts')).toBe('R new.ts');
    expect(formatPorcelainChangedFile('## main...origin/main')).toBeNull();
  });

  it('formats pull request badges as terminal hyperlinks when requested', () => {
    const linked = formatGitBadge(
      {
        branch: 'feature/footer',
        dirty: false,
        ahead: 0,
        behind: 0,
        diffAdded: 0,
        diffDeleted: 0,
        changedFileCount: 0,
        changedFiles: [],
        pullRequest: {
          number: 12,
          url: 'https://github.com/acme/repo/pull/12',
        },
      },
      { linkPullRequest: true },
    );

    expect(linked).toContain('[PR#12]');
    expect(linked).toContain('\u001B]8;;https://github.com/acme/repo/pull/12\u0007');
    expect(linked).toContain('\u001B]8;;\u0007');
  });

  it('stops firing onChange after dispose', async () => {
    const onChange = vi.fn();
    mocks.execFile.mockImplementation(
      (
        _cmd: string,
        args: string[],
        _options: unknown,
        callback: (error: Error | null, stdout: string, stderr: string) => void,
      ) => {
        if (args.includes('branch')) {
          callback(null, 'main\n', '');
          return;
        }
        if (args.includes('status')) {
          callback(null, '## main\n M a.ts\n', '');
          return;
        }
        if (args.includes('diff')) {
          callback(null, '1\t0\ta.ts\n', '');
          return;
        }
        callback(new Error('no pull request'), '', '');
      },
    );
    mocks.spawnSync.mockImplementation((_cmd: string, args: string[]) => {
      if (args.includes('rev-parse')) {
        return { status: 0, stdout: 'true\n' };
      }
      return { status: 0, stdout: 'origin\n' };
    });

    const cache = createGitStatusCache('/tmp/repo', { onChange });
    cache.dispose();
    expect(cache.getStatus()).toBeNull();
    await flushRefreshes();
    expect(onChange).not.toHaveBeenCalled();
  });
});
