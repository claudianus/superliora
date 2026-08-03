import { describe, expect, it } from 'vitest';

import { Agent } from '../../src/agent';
import { testKaos } from '../fixtures/test-kaos';

/**
 * UltraSwarm was retired in S3-R4 (inventory B-2). The `swarmRestaff` surface
 * stays as a graceful no-op until the war-room RPC/TUI surface is removed, so
 * these tests pin the retired behavior: restaff always rejects and the
 * RPC mirror never claims an active swarm run.
 */
describe('Agent.swarmRestaff (retired UltraSwarm, S3-R4)', () => {
  it('returns false when no swarm run can be active', () => {
    const agent = new Agent({ kaos: testKaos });
    expect(agent.swarmRestaff('dock restaff')).toBe(false);
    expect(agent.swarmRestaff()).toBe(false);
  });

  it('rpcMethods.swarmRestaff mirrors the always-false no-op', () => {
    const agent = new Agent({ kaos: testKaos });
    expect(agent.rpcMethods.swarmRestaff({ reason: 'from rpc' })).toBe(false);
  });

  it('pauseUltrawork/resumeUltrawork no longer touch swarm pause state', async () => {
    const agent = new Agent({ kaos: testKaos });
    await agent.rpcMethods.pauseUltrawork({ reason: 'Paused from war room' });
    await agent.rpcMethods.resumeUltrawork({});
    expect('ultraSwarmRun' in agent).toBe(false);
  });
});
