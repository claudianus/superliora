import type { Kaos } from '@superliora/kaos';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { runGit, type GitResult } from '../../src/session/git-context';
import { computeFilesChanged, snapshotGitWork } from '../../src/session/subagent/subagent-work-snapshot';

vi.mock('../../src/session/git-context', () => ({ runGit: vi.fn() }));

describe('worker cwd git delta', () => {
  it('merges committed and newly dirty files, sorted and de-duplicated', () => {
    expect(computeFilesChanged({
      committedChanged: ['src/b.ts', 'src/a.ts'], dirtyBefore: [], dirtyNow: ['src/a.ts', 'src/c.ts'],
    })).toEqual(['src/a.ts', 'src/b.ts', 'src/c.ts']);
  });

  it('excludes files already dirty before the worker began', () => {
    expect(computeFilesChanged({
      committedChanged: ['src/child.ts'], dirtyBefore: ['src/parent.ts'], dirtyNow: ['src/parent.ts', 'src/child.ts'],
    })).toEqual(['src/child.ts']);
  });

  it('does not silently drop observed files beyond an arbitrary handoff limit', () => {
    const many = Array.from({ length: 150 }, (_, index) => `f${String(index).padStart(3, '0')}.ts`);
    expect(computeFilesChanged({ committedChanged: many, dirtyBefore: [], dirtyNow: [] })).toEqual(many);
  });
});

describe('worker snapshot resource settlement', () => {
  const kaos = {} as Kaos;

  beforeEach(() => {
    vi.mocked(runGit).mockReset();
  });

  it('joins the sibling Git probe before reporting an unconfirmed resource failure', async () => {
    const sibling = Promise.withResolvers<GitResult>();
    const failure = Object.assign(new Error('Git exit was not confirmed'), { resourcesSettled: false });
    vi.mocked(runGit).mockRejectedValueOnce(failure).mockReturnValueOnce(sibling.promise);
    let settled = false;
    const snapshot = snapshotGitWork(kaos, '/work');
    void snapshot.then(() => { settled = true; }, () => { settled = true; });

    const nextTurn = Promise.withResolvers<void>();
    setImmediate(nextTurn.resolve);
    await nextTurn.promise;
    expect(settled).toBe(false);

    sibling.resolve({ ok: true, stdout: '' });
    await expect(snapshot).rejects.toBe(failure);
  });

  it('keeps aggregate physical ownership live until every failed Git resource settles', async () => {
    let firstSettled = false;
    let secondSettled = false;
    const first = Object.defineProperty(new Error('head cleanup failed'), 'resourcesSettled', {
      get: () => firstSettled,
    });
    const second = Object.defineProperty(new Error('status cleanup failed'), 'resourcesSettled', {
      get: () => secondSettled,
    });
    vi.mocked(runGit).mockRejectedValueOnce(first).mockRejectedValueOnce(second);

    const error: unknown = await snapshotGitWork(kaos, '/work').catch((error: unknown) => error);
    expect(error).toBeInstanceOf(AggregateError);
    expect(error).toHaveProperty('resourcesSettled', false);
    firstSettled = true;
    expect(error).toHaveProperty('resourcesSettled', false);
    secondSettled = true;
    expect(error).toHaveProperty('resourcesSettled', true);
  });

  it('passes the selected cancellation signal to both physical Git probes', async () => {
    vi.mocked(runGit).mockResolvedValue({ ok: true, stdout: '' });
    const signal = new AbortController().signal;
    await snapshotGitWork(kaos, '/work', signal);
    expect(runGit).toHaveBeenCalledWith(kaos, '/work', ['rev-parse', 'HEAD'], signal);
    expect(runGit).toHaveBeenCalledWith(kaos, '/work', ['status', '--porcelain'], signal);
  });
});
