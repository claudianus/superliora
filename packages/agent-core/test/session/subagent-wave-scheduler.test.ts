import { describe, expect, it } from 'vitest';

import { buildDependencyWaves, phaseHasDependencyWaves } from '../../src/session/subagent-wave-scheduler';

describe('subagent wave scheduler', () => {
  it('runs independent experts in one wave', () => {
    const waves = buildDependencyWaves([
      { expertId: 'a', dependsOn: undefined },
      { expertId: 'b', dependsOn: undefined },
    ]);

    expect(waves).toHaveLength(1);
    expect(waves[0]?.map((item) => item.expertId)).toEqual(['a', 'b']);
    expect(phaseHasDependencyWaves([
      { expertId: 'a' },
      { expertId: 'b' },
    ])).toBe(false);
  });

  it('schedules dependent experts into later waves', () => {
    const waves = buildDependencyWaves([
      { expertId: 'planner', dependsOn: undefined },
      { expertId: 'implementer', dependsOn: ['planner'] },
      { expertId: 'reviewer', dependsOn: ['implementer'] },
    ]);

    expect(waves).toHaveLength(3);
    expect(waves[0]?.map((item) => item.expertId)).toEqual(['planner']);
    expect(waves[1]?.map((item) => item.expertId)).toEqual(['implementer']);
    expect(waves[2]?.map((item) => item.expertId)).toEqual(['reviewer']);
    expect(phaseHasDependencyWaves([
      { expertId: 'planner' },
      { expertId: 'implementer', dependsOn: ['planner'] },
    ])).toBe(true);
  });

  it('falls back to one wave when dependency cycles exist', () => {
    const waves = buildDependencyWaves([
      { expertId: 'a', dependsOn: ['b'] },
      { expertId: 'b', dependsOn: ['a'] },
    ]);

    expect(waves).toHaveLength(1);
    expect(waves[0]?.map((item) => item.expertId).sort()).toEqual(['a', 'b']);
  });
});
