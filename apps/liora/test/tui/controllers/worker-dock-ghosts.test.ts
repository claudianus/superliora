import { describe, expect, it } from 'vitest';

import { WorkerDockRegistry } from '../../../src/tui/controllers/worker-dock/registry';

describe('WorkerDockRegistry job ghosts', () => {
  it('seeds suspended ghosts for interrupted jobs and drops them when live', () => {
    const registry = new WorkerDockRegistry(() => 1_000);
    expect(
      registry.hydrateJobGhosts([
        {
          id: 'job_abc',
          title: 'implement foo',
          status: 'interrupted',
        },
      ]),
    ).toBe(true);

    const snap = registry.snapshot(1_000);
    expect(snap.workers).toHaveLength(1);
    expect(snap.workers[0]?.id).toBe('job-ghost:job_abc');
    expect(snap.workers[0]?.status).toBe('suspended');
    expect(snap.workers[0]?.name).toBe('implement foo');
    expect(snap.workers[0]?.description).toBe('implement foo');
    expect(snap.workers[0]?.description).not.toMatch(/Resuming/i);

    // Live worker for the same job replaces the ghost.
    registry.apply({
      type: 'subagent.spawned',
      subagentId: 'worker-1',
      subagentName: 'implement foo',
      profileName: 'core',
      parentAgentId: 'main',
      runInBackground: true,
    } as never);
    expect(
      registry.hydrateJobGhosts([
        {
          id: 'job_abc',
          title: 'implement foo',
          status: 'running',
          workerAgentId: 'worker-1',
        },
      ]),
    ).toBe(true);
    const after = registry.snapshot(1_000);
    expect(after.workers.some((w) => w.id === 'job-ghost:job_abc')).toBe(false);
    expect(after.workers.some((w) => w.id === 'worker-1')).toBe(true);
  });

  it('does not version-bump when ghost fields are unchanged', () => {
    const registry = new WorkerDockRegistry(() => 2_000);
    expect(
      registry.hydrateJobGhosts([
        { id: 'job_q', title: 'queued work', status: 'queued' },
      ]),
    ).toBe(true);
    const versionAfterSeed = registry.snapshot(2_000).version;
    expect(
      registry.hydrateJobGhosts([
        { id: 'job_q', title: 'queued work', status: 'queued' },
      ]),
    ).toBe(false);
    expect(registry.snapshot(2_000).version).toBe(versionAfterSeed);
  });

  it('tags goal lanes with ledger provenance and mirrors the desk driver', () => {
    const registry = new WorkerDockRegistry(() => 1_000);
    registry.hydrateJobGhosts([
      { id: 'job_desk', title: 'Goal Desk: ship checkout', status: 'running', kind: 'goal-desk' },
      {
        id: 'job_driver',
        title: 'Goal: ship checkout',
        status: 'queued',
        kind: 'goal-driver',
        parentJobId: 'job_desk',
        progress: {
          phase: 'implement checkout',
          recentTools: ['Read', 'Edit'],
          stepsCompleted: 4,
          stepsTotal: 9,
        },
        liveTokens: 12_345,
      },
    ]);

    const snap = registry.snapshot(1_000);
    const desk = snap.workers.find((w) => w.id === 'job-ghost:job_desk');
    expect(desk?.ledger).toEqual({ kind: 'goal-desk', status: 'running' });
    // Desk mirrors its driver lane instead of a bare title.
    expect(desk?.description).toBe('driver · implement checkout');

    const driver = snap.workers.find((w) => w.id === 'job-ghost:job_driver');
    expect(driver?.ledger).toEqual({ kind: 'goal-driver', status: 'queued' });
    expect(driver?.description).toBe('implement checkout');
    expect(driver?.tokens).toBe(12_345);
    expect(driver?.todoDone).toBe(4);
    expect(driver?.todoTotal).toBe(9);
    expect(driver?.lastTool).toBe('Edit');
  });

  it('bumps when the mirrored driver phase moves', () => {
    const registry = new WorkerDockRegistry(() => 1_000);
    const desk = {
      id: 'job_desk',
      title: 'Goal Desk: ship checkout',
      status: 'running',
      kind: 'goal-desk',
    } as const;
    const driver = (phase: string) =>
      ({
        id: 'job_driver',
        title: 'Goal: ship checkout',
        status: 'queued',
        kind: 'goal-driver',
        parentJobId: 'job_desk',
        progress: { phase },
      }) as const;
    registry.hydrateJobGhosts([desk, driver('plan')]);
    const versionAfterSeed = registry.snapshot(1_000).version;
    // Unchanged telemetry → no repaint.
    expect(registry.hydrateJobGhosts([desk, driver('plan')])).toBe(false);
    expect(registry.snapshot(1_000).version).toBe(versionAfterSeed);
    // Driver phase moved → the desk row reflects it.
    expect(registry.hydrateJobGhosts([desk, driver('implement')])).toBe(true);
    const snap = registry.snapshot(1_000);
    expect(snap.workers.find((w) => w.id === 'job-ghost:job_desk')?.description).toBe(
      'driver · implement',
    );
  });

  it('maps live activity previews onto the ghost NOW strip', () => {
    const registry = new WorkerDockRegistry(() => 1_000);
    registry.hydrateJobGhosts([
      {
        id: 'job_driver',
        title: 'Goal: ship checkout',
        status: 'running',
        kind: 'goal-driver',
        liveActivity: {
          name: 'Bash',
          target: 'pnpm test',
          preview: 'tests 42 passed',
          previewKind: 'stdout',
        },
        liveTokens: 500,
      },
    ]);
    const snap = registry.snapshot(1_000);
    const ghost = snap.workers.find((w) => w.id === 'job-ghost:job_driver');
    expect(ghost?.lastTool).toBe('Bash');
    expect(ghost?.lastTarget).toBe('pnpm test');
    expect(ghost?.liveKind).toBe('stdout');
    expect(ghost?.liveText).toBe('tests 42 passed');
    expect(ghost?.liveAtMs).toBe(1_000);
  });
});
