import { describe, expect, it } from 'vitest';

import type { TeamPlan } from '@superliora/protocol';

import { Agent } from '../../src/agent';
import {
  createUltraSwarmRunContext,
  hasPendingUltraSwarmRestaff,
} from '../../src/agent/ultra-swarm-run';
import { testKaos } from '../fixtures/test-kaos';

describe('Agent.swarmRestaff', () => {
  const team = { experts: [], maxExperts: 1, reason: 'test' } as unknown as TeamPlan;

  it('returns false when no UltraSwarm run is active', () => {
    const agent = new Agent({ kaos: testKaos });
    expect(agent.swarmRestaff('dock restaff')).toBe(false);
  });

  it('queues force restaff without pausing for steer', () => {
    const agent = new Agent({ kaos: testKaos });
    agent.ultraSwarmRun = createUltraSwarmRunContext({
      runId: 'run-restaff',
      parentToolCallId: 'tool-1',
      team,
      busEnabled: true,
    });

    expect(agent.swarmRestaff('Close QA gaps')).toBe(true);
    expect(hasPendingUltraSwarmRestaff(agent.ultraSwarmRun)).toBe(true);
    expect(agent.ultraSwarmRun.pausedForSteer).toBe(false);
    expect(agent.ultraSwarmRun.restaffRequested).toBe(true);
    expect(agent.ultraSwarmRun.restaffRequests[0]?.reason).toBe('Close QA gaps');
  });
});

describe('Agent pauseUltrawork during UltraSwarm', () => {
  const team = { experts: [], maxExperts: 1, reason: 'test' } as unknown as TeamPlan;

  it('sets ultraSwarmRun.pausedForSteer so phase loop can stop', async () => {
    const agent = new Agent({ kaos: testKaos });
    agent.ultraSwarmRun = createUltraSwarmRunContext({
      runId: 'run-pause',
      parentToolCallId: 'tool-pause',
      team,
      busEnabled: true,
    });
    expect(agent.ultraSwarmRun.pausedForSteer).toBe(false);

    // AgentAPI path used by session.pauseUltrawork / war-room dock.
    await agent.rpcMethods.pauseUltrawork({ reason: 'Paused from war room' });
    expect(agent.ultraSwarmRun.pausedForSteer).toBe(true);

    await agent.rpcMethods.resumeUltrawork({});
    expect(agent.ultraSwarmRun.pausedForSteer).toBe(false);
  });

  it('rpcMethods.swarmRestaff mirrors Agent.swarmRestaff', () => {
    const agent = new Agent({ kaos: testKaos });
    agent.ultraSwarmRun = createUltraSwarmRunContext({
      runId: 'run-api',
      parentToolCallId: 'tool-api',
      team,
      busEnabled: false,
    });
    expect(agent.rpcMethods.swarmRestaff({ reason: 'from rpc' })).toBe(true);
    expect(hasPendingUltraSwarmRestaff(agent.ultraSwarmRun)).toBe(true);
  });
});
