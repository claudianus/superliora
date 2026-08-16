import { describe, expect, it } from 'vitest';

import { MissionControlRegistry } from '../../../src/tui/controllers/mission-control/registry';

describe('MissionControlRegistry job ghosts', () => {
  it('seeds suspended ghosts for interrupted jobs and drops them when live', () => {
    const registry = new MissionControlRegistry(() => 1_000);
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
    const registry = new MissionControlRegistry(() => 2_000);
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
});
