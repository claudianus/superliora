import { describe, expect, it } from 'vitest';

import { Agent } from '../../src/agent';
import { CONDUCTOR_GUARD_CODES } from '../../src/agent/conductor-guard';
import { DEFAULT_AGENT_PROFILES } from '../../src/profile';
import type { ResolvedAgentProfile } from '../../src/profile';
import { testKaos } from '../fixtures/test-kaos';

function bundledProfile(name: string): ResolvedAgentProfile {
  const profile = DEFAULT_AGENT_PROFILES[name];
  if (profile === undefined) throw new Error(`missing bundled profile: ${name}`);
  return profile;
}

/**
 * Agent-level wiring for the conductor delegation guard:
 * guard activation scope + orchestratorMode entry block (inventory B-1 ①).
 */
describe('Agent conductor guard wiring', () => {
  function makeAgent(options: { orchestratorMode?: boolean } = {}): Agent {
    return new Agent({
      kaos: testKaos,
      ...(options.orchestratorMode === true ? { orchestratorMode: true } : {}),
    });
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

  it('blocks orchestratorMode entry on the conductor lane and records it', () => {
    const agent = makeAgent();
    agent.useProfile(bundledProfile('conductor'));

    agent.setOrchestratorMode(true);

    expect(agent.orchestratorMode).toBe(false);
    const guard = agent.conductorGuard;
    expect(guard).toBeDefined();
    const events = guard?.events() ?? [];
    expect(events.some((e) => e.code === CONDUCTOR_GUARD_CODES.orchestratorModeBlocked)).toBe(
      true,
    );
  });

  it('forces orchestratorMode off when the conductor profile is applied later', () => {
    const agent = makeAgent({ orchestratorMode: true });
    expect(agent.orchestratorMode).toBe(true);

    agent.useProfile(bundledProfile('conductor'));

    expect(agent.orchestratorMode).toBe(false);
    const events = agent.conductorGuard?.events() ?? [];
    expect(
      events.some(
        (e) =>
          e.code === CONDUCTOR_GUARD_CODES.orchestratorModeBlocked &&
          (e.detail ?? '').includes('useProfile'),
      ),
    ).toBe(true);
  });

  it('keeps orchestratorMode available on non-conductor main profiles', () => {
    const agent = makeAgent();
    agent.useProfile(bundledProfile('agent'));

    agent.setOrchestratorMode(true);

    expect(agent.orchestratorMode).toBe(true);
    expect(agent.conductorGuard).toBeUndefined();
  });
});
