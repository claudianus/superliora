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
    expect(slices[0]?.kind).toBe('implement');
    expect(slices[0]?.staffQuery?.length).toBeGreaterThan(0);
    if (slices[0]?.expertId !== undefined) {
      expect(slices[0]!.expertScore).toBeGreaterThan(0);
    }
  });

  it('keeps multi-path ownership on one slice (claim set, not fan-out)', async () => {
    const slices = await staffJobsFromObjective({
      objective: 'Wire feature across packages',
      title: 'Fanout',
      ownershipPaths: ['packages/a', 'packages/b'],
      kind: 'task',
    });
    expect(slices.length).toBe(1);
    expect(slices[0]?.ownershipPaths).toEqual(['packages/a', 'packages/b']);
  });

  it('always keeps one slice for bullet/numbered prompts (staff = expert bind only)', async () => {
    const slices = await staffJobsFromObjective({
      objective: '1. Fix login\n2. Add tests\n3. Update docs',
      title: 'Multi',
      kind: 'task',
    });
    expect(slices.length).toBe(1);
    expect(slices[0]?.title).toBe('Multi');
    expect(slices[0]?.ownershipPaths).toBeUndefined();
    expect(slices[0]?.prompt).toContain('1. Fix login');
  });

  it('returns empty for blank objective', async () => {
    const slices = await staffJobsFromObjective({
      objective: '   ',
      title: 'Empty',
      kind: 'task',
    });
    expect(slices).toEqual([]);
  });
});
