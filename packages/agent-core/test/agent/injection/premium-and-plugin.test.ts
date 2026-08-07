import { describe, expect, it } from 'vitest';

import type { Agent } from '#/agent';
import { resolveActivePremiumDensity } from '#/agent/injection/premium-quality';

const buildAgent = (goal?: { getGoal: () => { goal: { objective: string } | null } | null }): Agent =>
  ({ goal: goal ?? { getGoal: () => null } }) as unknown as Agent;

describe('agent/injection/premium-quality — resolveActivePremiumDensity', () => {
  it('defaults to visual when there is no active goal', () => {
    expect(resolveActivePremiumDensity(buildAgent())).toBe('visual');
  });

  it('resolves code density from the active goal objective', () => {
    const agent = buildAgent({ getGoal: () => ({ goal: { objective: 'design-a-hero' } }) });
    expect(resolveActivePremiumDensity(agent)).toBe('code');
  });
});
