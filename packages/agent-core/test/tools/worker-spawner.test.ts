/**
 * V2-2 spawn isolation tests (contract §3, checklist V2-2):
 * serialized spawn queue, duplicate-spawn rejection, failure isolation,
 * and the spawn budget guard.
 */

import { describe, expect, it } from 'vitest';

import {
  JOB_WORKER_SPAWN_BUDGET_MS,
  WorkerSpawner,
  type WorkerSpawnPhase,
} from '../../src/session/job/worker-spawner';

function defer(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

describe('WorkerSpawner (V2-2 spawn isolation)', () => {
  it('exposes the locked 30s spawn budget', () => {
    expect(JOB_WORKER_SPAWN_BUDGET_MS).toBe(30_000);
  });

  it('serializes concurrent spawns in FIFO order', async () => {
    const spawner = new WorkerSpawner();
    const running: string[] = [];
    const done: string[] = [];
    let inFlight = 0;
    let maxInFlight = 0;
    const gates: Record<string, () => void> = {};

    const makeRun = (key: string) => async () => {
      inFlight += 1;
      maxInFlight = Math.max(maxInFlight, inFlight);
      running.push(key);
      await new Promise<void>((resolve) => {
        gates[key] = resolve;
      });
      inFlight -= 1;
      done.push(key);
    };

    expect(spawner.enqueue({ key: 'job_a', run: makeRun('job_a') }).queued).toBe(true);
    expect(spawner.enqueue({ key: 'job_b', run: makeRun('job_b') }).queued).toBe(true);
    expect(spawner.enqueue({ key: 'job_c', run: makeRun('job_c') }).queued).toBe(true);
    await defer();

    // Only the first spawn may be in flight — the queue serializes.
    expect(running).toEqual(['job_a']);
    expect(maxInFlight).toBe(1);
    expect(spawner.isSpawning('job_a')).toBe(true);

    gates['job_a']!();
    await defer();
    expect(running).toEqual(['job_a', 'job_b']);
    expect(maxInFlight).toBe(1);

    gates['job_b']!();
    await defer();
    expect(running).toEqual(['job_a', 'job_b', 'job_c']);
    gates['job_c']!();
    await spawner.settle();
    expect(done).toEqual(['job_a', 'job_b', 'job_c']);
    expect(maxInFlight).toBe(1);
    expect(spawner.queuedCount).toBe(0);
    expect(spawner.currentSpawningKey).toBeUndefined();
  });

  it('rejects duplicate spawns while queued and while spawning', async () => {
    const spawner = new WorkerSpawner();
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });

    const first = spawner.enqueue({ key: 'job_dup', run: async () => gate });
    expect(first).toEqual({ queued: true, duplicate: false });
    // Still queued (drain starts on a microtask) — duplicate rejected.
    expect(spawner.enqueue({ key: 'job_dup', run: async () => {} })).toEqual({
      queued: false,
      duplicate: true,
    });
    await defer();
    // Now spawning — still rejected.
    expect(spawner.isSpawning('job_dup')).toBe(true);
    expect(spawner.enqueue({ key: 'job_dup', run: async () => {} }).duplicate).toBe(true);

    release();
    await spawner.settle();
    // After settling, the key is free again.
    expect(spawner.enqueue({ key: 'job_dup', run: async () => {} }).queued).toBe(true);
    await spawner.settle();
  });

  it('isolates spawn failures from the caller stack and the queue', async () => {
    const spawner = new WorkerSpawner();
    const phases: Array<{ key: string; phase: WorkerSpawnPhase }> = [];

    // enqueue itself must not throw even though the task will throw.
    expect(
      spawner.enqueue({
        key: 'job_boom',
        run: async () => {
          throw new Error('spawn exploded');
        },
        onPhase: (phase) => phases.push({ key: 'job_boom', phase }),
      }).queued,
    ).toBe(true);
    const next = spawner.enqueue({
      key: 'job_next',
      run: async () => 'ok',
      onPhase: (phase) => phases.push({ key: 'job_next', phase }),
    });
    expect(next.queued).toBe(true);

    await spawner.settle();
    expect(phases).toEqual([
      { key: 'job_boom', phase: 'spawning' },
      { key: 'job_boom', phase: 'spawn_failed' },
      { key: 'job_next', phase: 'spawning' },
      { key: 'job_next', phase: 'spawned' },
    ]);
    expect(spawner.queuedCount).toBe(0);
  });

  it('enforces the spawn budget: abort, record, and move on without stalling', async () => {
    const spawner = new WorkerSpawner({ budgetMs: 5 });
    const phases: WorkerSpawnPhase[] = [];
    let timedOut = 0;
    let aborted: AbortSignal | undefined;
    let hungSettled = false;
    const later: string[] = [];

    spawner.enqueue({
      key: 'job_hung',
      // Ignores the budget signal long enough to prove the queue moves on.
      run: async ({ signal }) => {
        aborted = signal;
        await new Promise((resolve) => setTimeout(resolve, 50));
        hungSettled = true;
      },
      onPhase: (phase) => phases.push(phase),
      onTimeout: () => {
        timedOut += 1;
      },
    });
    spawner.enqueue({
      key: 'job_after',
      run: async () => later.push('job_after'),
      onPhase: (phase) => phases.push(phase),
    });

    await spawner.settle();
    expect(phases).toEqual(['spawning', 'spawn_budget_exceeded', 'spawning', 'spawned']);
    expect(timedOut).toBe(1);
    expect(later).toEqual(['job_after']);
    expect(aborted?.aborted).toBe(true);
    // The hung handshake was detached, not awaited.
    expect(hungSettled).toBe(false);
    await defer();
    await defer();
    expect(spawner.queuedCount).toBe(0);
  });

  it('settles immediately when idle', async () => {
    const spawner = new WorkerSpawner();
    await expect(spawner.settle()).resolves.toBeUndefined();
  });
});
