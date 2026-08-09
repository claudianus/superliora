import { Readable } from 'node:stream';

import type { Kaos } from '@superliora/kaos';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { landJobToMain } from '../../src/tools/builtin/job/job-land';
import { createJob, getJob, patchJob } from '../../src/tools/builtin/job/job-ledger';
import type { ToolStore } from '../../src/tools/store';

vi.mock('../../src/session/worktree', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/session/worktree')>();
  return {
    ...actual,
    removeSessionWorktree: vi.fn(async (_kaos: unknown, options: { nameOrPath: string }) => ({
      name: 'mock',
      path: options.nameOrPath,
      repoRoot: '/repo/main',
      branch: 'liora/mock',
      baseRef: 'HEAD',
      createdAt: new Date().toISOString(),
      lastAccessedAt: new Date().toISOString(),
    })),
    gcSessionWorktrees: vi.fn(async () => ({ removed: [], kept: 0 })),
  };
});

import { removeSessionWorktree } from '../../src/session/worktree';

function memoryStore(): ToolStore {
  const data: Record<string, unknown> = {};
  return {
    get(key) {
      return data[key] as never;
    },
    set(key, value) {
      data[key] = value;
    },
  };
}

function stubKaos(): Kaos {
  return {
    exec: async (...args: string[]) => {
      const gitArgs = args[0] === 'git' && args[1] === '-C' ? args.slice(3) : args;
      let stdout = '';
      if (gitArgs[0] === 'status') stdout = '';
      else if (gitArgs[0] === 'merge') stdout = 'Fast-forward';
      else if (gitArgs[0] === 'rev-parse' && gitArgs[1] === 'HEAD') {
        stdout = 'cafebabe01234567\n';
      } else if (gitArgs[0] === 'rev-parse' && gitArgs[1] === '--abbrev-ref') {
        stdout = 'liora/land-me\n';
      } else if (gitArgs[0] === 'merge-base') stdout = '';
      else if (gitArgs[0] === 'config') {
        stdout = gitArgs[1] === 'user.name' ? 'Test\n' : 'test@example.com\n';
      }
      return {
        stdin: { end: () => {} },
        stdout: Readable.from([stdout]),
        stderr: Readable.from(['']),
        pid: 1,
        exitCode: null,
        wait: async () => 0,
        kill: async () => {},
        dispose: () => {},
      };
    },
  } as unknown as Kaos;
}

describe('landJobToMain worktree sweep', () => {
  afterEach(() => {
    vi.mocked(removeSessionWorktree).mockReset();
    vi.mocked(removeSessionWorktree).mockImplementation(
      async (_kaos: unknown, options: { nameOrPath: string }) => ({
        name: 'mock',
        path: options.nameOrPath,
        repoRoot: '/repo/main',
        branch: 'liora/mock',
        baseRef: 'HEAD',
        createdAt: new Date().toISOString(),
        lastAccessedAt: new Date().toISOString(),
      }),
    );
  });

  it('sweeps other done job worktrees after a successful land', async () => {
    const store = memoryStore();
    const leftover = createJob(store, { title: 'leftover done', kind: 'explore' });
    patchJob(store, leftover.id, {
      status: 'done',
      worktreePath: '/tmp/wt/leftover',
    });
    const landMe = createJob(store, { title: 'land me', kind: 'implement' });
    patchJob(store, landMe.id, {
      status: 'done',
      worktreePath: '/tmp/wt/land-me',
      worktreeBranch: 'liora/land-me',
    });

    const result = await landJobToMain({
      store,
      job: getJob(store, landMe.id)!,
      repoPath: '/repo/main',
      kaos: stubKaos(),
    });

    expect(result.ok).toBe(true);
    expect(result.merged).toBe(true);
    expect(result.gcRemoved).toBe(true);
    expect(result.message).toContain('worktree removed');
    expect(result.message).toMatch(/Swept \d+ leftover/);
    expect(getJob(store, landMe.id)?.worktreePath).toBeUndefined();
    expect(getJob(store, leftover.id)?.worktreePath).toBeUndefined();
    expect(getJob(store, landMe.id)?.notes).toContain('swept');
    expect(vi.mocked(removeSessionWorktree).mock.calls.length).toBeGreaterThanOrEqual(2);
  });

  it('keeps failed job worktrees (TTL) and surfaces retain when GC keeps failing', async () => {
    vi.mocked(removeSessionWorktree).mockRejectedValue(new Error('busy'));

    const store = memoryStore();
    const failed = createJob(store, { title: 'failed keep', kind: 'implement' });
    patchJob(store, failed.id, {
      status: 'failed',
      worktreePath: '/tmp/wt/failed',
    });
    const landMe = createJob(store, { title: 'land retain', kind: 'implement' });
    patchJob(store, landMe.id, {
      status: 'done',
      worktreePath: '/tmp/wt/land-retain',
      worktreeBranch: 'liora/land-me',
    });

    const result = await landJobToMain({
      store,
      job: getJob(store, landMe.id)!,
      repoPath: '/repo/main',
      kaos: stubKaos(),
    });

    expect(result.ok).toBe(true);
    expect(result.gcRemoved).toBe(false);
    expect(result.message).toContain('worktree retained — run /job gc');
    expect(getJob(store, failed.id)?.worktreePath).toBe('/tmp/wt/failed');
    expect(getJob(store, landMe.id)?.worktreePath).toBe('/tmp/wt/land-retain');
  });

  it('mentions /job gc when land succeeds without kaos (cannot remove)', async () => {
    const store = memoryStore();
    const job = createJob(store, { title: 'no kaos', kind: 'implement' });
    patchJob(store, job.id, {
      status: 'done',
      worktreePath: '/tmp/wt/no-kaos',
      worktreeBranch: 'liora/no-kaos',
    });

    const result = await landJobToMain({
      store,
      job: getJob(store, job.id)!,
      repoPath: '/repo/main',
      runGit: async (_cwd, args) => {
        if (args[0] === 'rev-parse' && args[1] === '--abbrev-ref') {
          return { code: 0, stdout: 'liora/no-kaos\n', stderr: '' };
        }
        if (args[0] === 'rev-parse' && args[1] === 'HEAD') {
          return { code: 0, stdout: 'deadbeefcafe1234\n', stderr: '' };
        }
        if (args[0] === 'merge-base') return { code: 0, stdout: '', stderr: '' };
        if (args[0] === 'merge') return { code: 0, stdout: 'ok', stderr: '' };
        return { code: 0, stdout: '', stderr: '' };
      },
    });

    expect(result.ok).toBe(true);
    expect(result.gcRemoved).toBe(false);
    expect(result.message).toContain('worktree retained — run /job gc');
    expect(getJob(store, job.id)?.notes).toContain('run /job gc');
  });
});
