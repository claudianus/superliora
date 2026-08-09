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

  it('does not intent-split bullets by default (staffing is expert bind only)', async () => {
    const slices = await staffJobsFromObjective({
      objective: '1. Fix login\n2. Add tests\n3. Update docs',
      title: 'Multi',
      kind: 'task',
    });
    expect(slices.length).toBe(1);
    expect(slices[0]?.title).toBe('Multi');
    expect(slices[0]?.ownershipPaths).toBeUndefined();
  });

  it('intent-splits bullets only when allowIntentSplit is true and ownership is empty', async () => {
    const slices = await staffJobsFromObjective({
      objective: '1. Fix login\n2. Add tests\n3. Update docs',
      title: 'Multi',
      kind: 'task',
      allowIntentSplit: true,
    });
    expect(slices.length).toBe(3);
    expect(slices[0]?.title).toBe('Multi (1)');
    expect(slices[0]?.ownershipPaths).toBeUndefined();
  });

  it('collapses near-identical opt-in slices to one job', async () => {
    const slices = await staffJobsFromObjective({
      objective:
        '1. Explore JobCreate multi-intent auto-split root cause\n2. Explore JobCreate multi-intent auto-split root cause\n3. Explore JobCreate multi-intent auto-split root cause',
      title: 'Explore',
      kind: 'explore',
      allowIntentSplit: true,
    });
    expect(slices.length).toBe(1);
  });
});
