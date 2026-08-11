/**
 * Fleet autopilot runs inside Agent.resume and may spawn workers that call
 * session.ensureAgentResumed(parent). If agents.get(id) still holds the resume
 * Promise, spawn deadlocks until the 30s budget → jobs never leave queued.
 */

import { describe, expect, it, vi } from 'vitest';

import { SessionAgentLifecycle } from '../../src/session/lifecycle/session-agent-lifecycle';
import type { AgentEntry, ResumedAgent } from '../../src/session/lifecycle/session-types';

describe('resumePersistedAgent early publish', () => {
  it('puts Agent in the map before await agent.resume()', async () => {
    const agents = new Map<string, AgentEntry>();
    let sawReadyAgentDuringResume = false;

    const fakeAgent = {
      type: 'main',
      resume: async () => {
        const entry = agents.get('main');
        sawReadyAgentDuringResume = entry === fakeAgent && !(entry instanceof Promise);
        return {};
      },
    };

    const lifecycle = new SessionAgentLifecycle({
      session: {} as never,
      options: { kimiHomeDir: '/tmp', config: {} } as never,
      agents,
      getMetadata: () =>
        ({
          agents: {
            main: { homedir: '/tmp', type: 'main', parentAgentId: null },
          },
        }) as never,
      skills: {} as never,
      getSkillsReady: async () => undefined,
      mcp: {} as never,
      hookEngine: {} as never,
      telemetry: {} as never,
      experimentalFlags: {} as never,
      fileSnapshots: {} as never,
      log: { createChild: () => ({}) } as never,
      rpc: {} as never,
      getToolKaos: () => ({ withCwd: () => ({ getcwd: () => '/tmp' }) }) as never,
      getAdditionalDirs: () => [],
      getAgentsMdWarning: () => undefined,
      setAgentsMdWarning: () => undefined,
      systemContextKaos: () => ({}) as never,
      writeMetadata: () => undefined,
    });

    vi.spyOn(lifecycle, 'instantiateAgent').mockReturnValue(fakeAgent as never);

    // Same placeholder pattern as resumeAgent():
    const promise: Promise<ResumedAgent> = lifecycle.resumePersistedAgent('main');
    agents.set('main', promise);

    const result = await promise;
    expect(sawReadyAgentDuringResume).toBe(true);
    expect(result.agent).toBe(fakeAgent);
    expect(agents.get('main')).toBe(fakeAgent);
  });
});
