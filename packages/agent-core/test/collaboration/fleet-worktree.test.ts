import { describe, expect, it, vi } from 'vitest';
import { LocalKaos } from '@superliora/kaos';

import {
  FLEET_WORKTREE_ENV,
  FLEET_WORKTREE_FALLBACK_TIP,
  applyFleetWorktreeToSpawnTasks,
  isFleetWorktreeEnvEnabled,
  resolveFleetWorkerWorktreeDir,
} from '#/fleet';
import type { QueuedSubagentTask } from '#/session/subagent/subagent-batch-types';

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

    const result = await resolveFleetWorkerWorktreeDir(
      { kaos: new LocalKaos('/repo'), repoPath: '/repo', workerKey: 'fleet-x' },
      { env: { [FLEET_WORKTREE_ENV]: '1' }, createWorktree },
    );

    expect(createWorktree).toHaveBeenCalledOnce();
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

  it('enriches spawn tasks only when env is on', async () => {
    const createWorktree = vi.fn(async (_kaos, input: { name: string }) => ({
      workDir: `/wt/${input.name}`,
      meta: {
        path: `/wt/${input.name}`,
        branch: `liora/${input.name}`,
        repoRoot: '/repo',
        name: input.name,
        baseRef: 'HEAD',
        createdAt: '2026-01-01T00:00:00.000Z',
      },
      record: {
        name: input.name,
        path: `/wt/${input.name}`,
        repoRoot: '/repo',
        branch: `liora/${input.name}`,
        baseRef: 'HEAD',
        createdAt: '2026-01-01T00:00:00.000Z',
        lastAccessedAt: '2026-01-01T00:00:00.000Z',
      },
    }));

    const baseTask = {
      kind: 'spawn' as const,
      data: { index: 1 },
      profileName: 'coder',
      parentToolCallId: 'toolcall-abc',
      prompt: 'do work',
      description: 'worker #1',
      swarmIndex: 1,
      runInBackground: false,
    } satisfies QueuedSubagentTask<{ index: number }>;

    const off = await applyFleetWorktreeToSpawnTasks([baseTask], {
      kaos: new LocalKaos('/repo'),
      repoPath: '/repo',
      parentToolCallId: 'toolcall-abc',
    }, { env: {} });
    expect(off.tasks[0]?.worktreeDir).toBeUndefined();
    expect(createWorktree).not.toHaveBeenCalled();

    const on = await applyFleetWorktreeToSpawnTasks([baseTask], {
      kaos: new LocalKaos('/repo'),
      repoPath: '/repo',
      parentToolCallId: 'toolcall-abc',
    }, { env: { [FLEET_WORKTREE_ENV]: '1' }, createWorktree });
    expect(on.tasks[0]?.worktreeDir).toBe('/wt/fleet-toolcall-1');
    expect(createWorktree).toHaveBeenCalledOnce();
  });
});
