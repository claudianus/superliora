import { describe, expect, it } from 'vitest';

import type { Agent } from '#/agent';
import { resolveActivePremiumDensity } from '#/agent/injection/premium-quality';
import { ObjectiveProfileCache } from '#/premium-quality/objective-profile-cache';

const buildAgent = (goal?: {
  getGoal: () => { goal: { objective: string } | null } | null;
}): Agent =>
  ({
    goal: goal ?? { getGoal: () => null },
    objectiveProfile: new ObjectiveProfileCache(),
  }) as unknown as Agent;

describe('agent/injection/premium-quality — resolveActivePremiumDensity', () => {
  it('defaults to visual when there is no active goal', () => {
    expect(resolveActivePremiumDensity(buildAgent())).toBe('visual');
  });

  it('resolves visual density for UI objectives like design-a-hero', () => {
    const agent = buildAgent({ getGoal: () => ({ goal: { objective: 'design-a-hero' } }) });
    expect(resolveActivePremiumDensity(agent)).toBe('visual');
  });

  it('resolves code density for non-visual objectives', () => {
    const agent = buildAgent({
      getGoal: () => ({ goal: { objective: 'Fix the CLI parser and add unit tests' } }),
    });
    expect(resolveActivePremiumDensity(agent)).toBe('code');
  });

  it('honors a cached visual profile over a bare objective string', () => {
    const agent = buildAgent({
      getGoal: () => ({ goal: { objective: 'Refactor the RPC session API' } }),
    });
    agent.objectiveProfile.set('Refactor the RPC session API', {
      premiumDensity: 'visual',
      visualSurface: true,
    });
    expect(resolveActivePremiumDensity(agent)).toBe('visual');
  });
});
