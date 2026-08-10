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
});
