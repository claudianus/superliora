import { describe, expect, it } from 'vitest';

import type { Agent } from '#/agent';
import { InjectionManager } from '#/agent/injection/manager';

describe('agent/injection/manager — InjectionManager construction', () => {
  it('can be constructed with a minimal agent (smoke)', () => {
    const agent = {
      type: 'main',
      tools: { loopTools: [] },
      context: { history: [], appendSystemReminder: () => undefined },
      planMode: { isActive: false, isUltraMode: false, phase: null, planFilePath: null },
      getResponseLanguagePreference: () => undefined,
      goal: undefined,
      memory: undefined,
      skills: undefined,
      contextOS: undefined,
    } as unknown as Agent;
    expect(() => new InjectionManager(agent)).not.toThrow();
  });

  it('can be constructed for a sub-agent type without a goal', () => {
    const agent = {
      type: 'sub',
      tools: { loopTools: [] },
      context: { history: [] },
    } as unknown as Agent;
    expect(() => new InjectionManager(agent)).not.toThrow();
  });
});
