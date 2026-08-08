import { describe, expect, it } from 'vitest';

import { staffJobsFromObjective } from '../../src/tools/builtin/job/job-staff';

describe('staffJobsFromObjective', () => {
  it('binds an expert or falls back to generic without throwing', async () => {
    const slices = await staffJobsFromObjective({
      objective: 'Improve React accessibility keyboard focus traps in the settings dialog',
      title: 'A11y focus',
      kind: 'implement',
    });
    expect(slices.length).toBe(1);
    expect(slices[0]?.expertRole === 'implement' || slices[0]?.expertRole === 'generic').toBe(
      true,
    );
    if (slices[0]?.expertId !== undefined) {
      expect(slices[0]!.expertScore).toBeGreaterThan(0);
    }
  });

  it('splits ownership paths into parallel slices', async () => {
    const slices = await staffJobsFromObjective({
      objective: 'Wire feature across packages',
      title: 'Fanout',
      ownershipPaths: ['packages/a', 'packages/b'],
      kind: 'task',
    });
    expect(slices.length).toBe(2);
    expect(slices[0]?.ownershipPaths).toEqual(['packages/a']);
    expect(slices[1]?.ownershipPaths).toEqual(['packages/b']);
  });
});
