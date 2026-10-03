import { describe, expect, it, vi } from 'vitest';
import { LocalKaos } from '@superliora/kaos';

import {
  FLEET_WORKTREE_ENV,
  FLEET_WORKTREE_FALLBACK_TIP,
  isFleetWorktreeEnvEnabled,
  resolveFleetWorkerWorktreeDir,
} from '#/fleet';

describe('fleet worktree soft path', () => {
  it('is disabled unless SUPERLIORA_FLEET_WORKTREE is truthy', () => {
    expect(isFleetWorktreeEnvEnabled({})).toBe(false);
    expect(isFleetWorktreeEnvEnabled({ [FLEET_WORKTREE_ENV]: '1' })).toBe(true);
    expect(isFleetWorktreeEnvEnabled({ [FLEET_WORKTREE_ENV]: 'true' })).toBe(true);
  });

  it('returns worktreeDir when env is on and create succeeds', async () => {
    const createWorktree = vi.fn(async () => ({
      workDir: '/tmp/fleet-worker',
      meta: {
        path: '/tmp/fleet-worker',
        branch: 'liora/fleet-x',
        repoRoot: '/repo',
        name: 'fleet-x',
        baseRef: 'HEAD',
        createdAt: '2026-01-01T00:00:00.000Z',
      },
      record: {
        name: 'fleet-x',
        path: '/tmp/fleet-worker',
        repoRoot: '/repo',
        branch: 'liora/fleet-x',
        baseRef: 'HEAD',
        createdAt: '2026-01-01T00:00:00.000Z',
        lastAccessedAt: '2026-01-01T00:00:00.000Z',
      },
    }));
    const signal = new AbortController().signal;
    const onWorktreePath = vi.fn();

    const result = await resolveFleetWorkerWorktreeDir(
      { kaos: new LocalKaos('/repo'), repoPath: '/repo', workerKey: 'fleet-x', signal, onWorktreePath },
      { env: { [FLEET_WORKTREE_ENV]: '1' }, createWorktree },
    );

    expect(createWorktree).toHaveBeenCalledOnce();
    expect(createWorktree).toHaveBeenCalledWith(expect.any(LocalKaos), {
      repoPath: '/repo', name: 'fleet-x', signal, onWorktreePath,
    });
    expect(result.worktreeDir).toBe('/tmp/fleet-worker');
    expect(result.fallbackTip).toBeUndefined();
  });

  it('falls back with tip when worktree create fails', async () => {
    const log = { warn: vi.fn() };
    const createWorktree = vi.fn(async () => {
      throw new Error('not a git repo');
    });

    const result = await resolveFleetWorkerWorktreeDir(
      {
        kaos: new LocalKaos('/repo'),
        repoPath: '/repo',
        workerKey: 'fleet-x',
        log: log as never,
      },
      { env: { [FLEET_WORKTREE_ENV]: '1' }, createWorktree },
    );

    expect(result.worktreeDir).toBeUndefined();
    expect(result.fallbackTip).toContain(FLEET_WORKTREE_FALLBACK_TIP);
    expect(result.fallbackTip).toContain('not a git repo');
    expect(log.warn).toHaveBeenCalledOnce();
  });

  it('does not fall back while native preparation resources remain unsettled', async () => {
    const failure = Object.assign(new Error('process disposal failed'), { resourcesSettled: false });
    const error = new AggregateError([failure], 'worktree preparation failed');
    const log = { warn: vi.fn() };
    await expect(resolveFleetWorkerWorktreeDir(
      { kaos: new LocalKaos('/repo'), repoPath: '/repo', workerKey: 'fleet-x', log: log as never },
      { env: { [FLEET_WORKTREE_ENV]: '1' }, createWorktree: vi.fn().mockRejectedValue(error) },
    )).rejects.toBe(error);
    expect(log.warn).not.toHaveBeenCalled();
  });

  it('does not fall back when preparation is cancelled', async () => {
    const controller = new AbortController();
    const error = new Error('cancelled');
    const createWorktree = vi.fn(async () => {
      controller.abort(error);
      throw error;
    });
    await expect(resolveFleetWorkerWorktreeDir(
      { kaos: new LocalKaos('/repo'), repoPath: '/repo', workerKey: 'fleet-x', signal: controller.signal },
      { env: { [FLEET_WORKTREE_ENV]: '1' }, createWorktree },
    )).rejects.toBe(error);
  });

});
