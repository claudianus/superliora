import { describe, expect, it } from 'vitest';

import type { Agent } from '#/agent';
import { resolveActivePremiumDensity } from '#/agent/injection/premium-quality';

const buildAgent = (overrides: {
  goal?: { getGoal: () => { goal: { objective: string } | null } | null };
  ultrawork?: { getRun: () => { objective: string } | null };
  profile?: Map<string, unknown>;
}): Agent =>
  ({
    goal: overrides.goal ?? { getGoal: () => null },
    ultrawork: overrides.ultrawork ?? { getRun: () => null },
    ultraworkObjectiveProfile: overrides.profile ?? new Map(),
  }) as unknown as Agent;

describe('agent/injection/premium-quality — resolveActivePremiumDensity', () => {
  it('falls back to the default density when there is no goal or run', () => {
    const result = resolveActivePremiumDensity(buildAgent({}));
    expect(['code', 'visual', 'evidence', 'minimal']).toContain(result);
  });

  it('looks up the profile keyed by the goal objective', () => {
    const profile = new Map<string, unknown>([
      ['design-a-hero', { premiumDensity: 'visual' }],
    ]);
    const agent = buildAgent({
      goal: { getGoal: () => ({ goal: { objective: 'design-a-hero' } }) },
      profile,
    });
    expect(resolveActivePremiumDensity(agent)).toBe('visual');
  });

  it('falls back to the run-objective profile when the goal has no match', () => {
    const profile = new Map<string, unknown>([
      ['refactor-runtime', { premiumDensity: 'code' }],
    ]);
    const agent = buildAgent({
      ultrawork: { getRun: () => ({ objective: 'refactor-runtime' }) },
      profile,
    });
    expect(resolveActivePremiumDensity(agent)).toBe('code');
  });

  it('goal objective wins over the run objective', () => {
    const profile = new Map<string, unknown>([
      ['goal-x', { premiumDensity: 'visual' }],
      ['run-y', { premiumDensity: 'code' }],
    ]);
    const agent = buildAgent({
      goal: { getGoal: () => ({ goal: { objective: 'goal-x' } }) },
      ultrawork: { getRun: () => ({ objective: 'run-y' }) },
      profile,
    });
    expect(resolveActivePremiumDensity(agent)).toBe('visual');
  });

  it('returns the default density when the profile lookup misses', () => {
    const agent = buildAgent({
      goal: { getGoal: () => ({ goal: { objective: 'no-profile-here' } }) },
      profile: new Map(),
    });
    expect(['code', 'visual', 'evidence', 'minimal']).toContain(
      resolveActivePremiumDensity(agent),
    );
  });
});
