import { describe, expect, it } from 'vitest';

import { Agent } from '../../src/agent';
import { DEFAULT_AGENT_PROFILES } from '../../src/profile';
import type { ResolvedAgentProfile } from '../../src/profile';
import { testKaos } from '../fixtures/test-kaos';

function bundledProfile(name: string): ResolvedAgentProfile {
  const profile = DEFAULT_AGENT_PROFILES[name];
  if (profile === undefined) throw new Error(`missing bundled profile: ${name}`);
  return profile;
}

/**
 * Agent-level wiring for the conductor delegation guard: guard activation
 * scope (main agent + conductor profile only, contract §2.3).
 */
describe('Agent conductor guard wiring', () => {
  function makeAgent(): Agent {
    return new Agent({ kaos: testKaos });
  }

  it('activates the guard only for a main agent on the conductor profile', () => {
    const agent = makeAgent();
    expect(agent.conductorGuard).toBeUndefined();

    agent.useProfile(bundledProfile('conductor'));
    expect(agent.conductorGuard).toBeDefined();

    // Non-conductor waists are not subject to delegation-only (§2.3).
    agent.useProfile(bundledProfile('agent'));
    expect(agent.conductorGuard).toBeUndefined();
  });
});
