import { describe, expect, it } from 'vitest';

import { WorkerDockRegistry } from '../../../src/tui/controllers/worker-dock/registry';

describe('WorkerDockRegistry job ghosts', () => {
  it('seeds recorded running Job ghosts and drops them when actual workers arrive', () => {
    const registry = new WorkerDockRegistry(() => 1_000);
    expect(
      registry.hydrateJobGhosts([
        {
          id: 'job_abc',
          title: 'implement foo',
          status: 'running',
        },
      ]),
    ).toBe(true);

    const snap = registry.snapshot(1_000);
    expect(snap.workers).toHaveLength(1);
    expect(snap.workers[0]?.id).toBe('job-ghost:job_abc');
    expect(snap.workers[0]?.status).toBe('running');
    expect(snap.workers[0]?.name).toBe('implement foo');
    expect(snap.workers[0]?.description).toBe('implement foo');
    expect(snap.workers[0]?.description).not.toMatch(/Resuming/i);

    // Live worker for the same job replaces the ghost.
    registry.apply({
      type: 'subagent.spawned',
      subagentId: 'worker-1',
      subagentName: 'implement foo',
      profileName: 'agent',
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
        { id: 'job_run', title: 'running work', status: 'running' },
      ]),
    ).toBe(true);
    const versionAfterSeed = registry.snapshot(2_000).version;
    expect(
      registry.hydrateJobGhosts([
        { id: 'job_run', title: 'running work', status: 'running' },
      ]),
    ).toBe(false);
    expect(registry.snapshot(2_000).version).toBe(versionAfterSeed);
  });

  it('leaves queued and interrupted Jobs in the recorded Job view instead of inventing worker suspension', () => {
    const registry = new WorkerDockRegistry(() => 2_000);
    expect(registry.hydrateJobGhosts([
      { id: 'job_waiting', title: 'Queued work', status: 'queued', kind: 'task' },
      { id: 'job_interrupted', title: 'Interrupted work', status: 'interrupted', kind: 'task' },
    ])).toBe(false);
    expect(registry.snapshot(2_000).workers).toHaveLength(0);
    expect(registry.snapshot(2_000).activeCount).toBe(0);
  });

  it('shows each Job own recorded provenance and telemetry without role mirroring', () => {
    const registry = new WorkerDockRegistry(() => 1_000);
    registry.hydrateJobGhosts([
      { id: 'job_parent', title: 'Checkout work', status: 'running', kind: 'task' },
      {
        id: 'job_child',
        title: 'Implement checkout',
        status: 'running',
        kind: 'task',
        progress: { phase: 'implement checkout', recentTools: ['Bash'] },
        liveTokens: 12_345,
      },
    ]);
    const snap = registry.snapshot(1_000);
    const parent = snap.workers.find((worker) => worker.id === 'job-ghost:job_parent');
    expect(parent?.ledger).toEqual({ kind: 'task', status: 'running' });
    expect(parent?.status).toBe('running');
    expect(parent?.description).toBe('Checkout work');
    const child = snap.workers.find((worker) => worker.id === 'job-ghost:job_child');
    expect(child?.ledger).toEqual({ kind: 'task', status: 'running' });
    expect(child?.description).toBe('implement checkout');
    expect(child?.tokens).toBe(12_345);
    expect(child?.lastTool).toBe('Bash');
  });

  it('bumps only when a Job own recorded phase changes', () => {
    const registry = new WorkerDockRegistry(() => 1_000);
    const job = (phase: string) => ({
      id: 'job_work',
      title: 'Checkout work',
      status: 'running',
      kind: 'task',
      progress: { phase },
    });
    registry.hydrateJobGhosts([job('inspect')]);
    const versionAfterSeed = registry.snapshot(1_000).version;
    expect(registry.hydrateJobGhosts([job('inspect')])).toBe(false);
    expect(registry.snapshot(1_000).version).toBe(versionAfterSeed);
    expect(registry.hydrateJobGhosts([job('implement')])).toBe(true);
    expect(registry.snapshot(1_000).workers[0]?.description).toBe('implement');
  });

  it('maps live activity previews onto the ghost NOW strip', () => {
    const registry = new WorkerDockRegistry(() => 1_000);
    registry.hydrateJobGhosts([
      {
        id: 'job_driver',
        title: 'Implement checkout',
        status: 'running',
        kind: 'task',
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
