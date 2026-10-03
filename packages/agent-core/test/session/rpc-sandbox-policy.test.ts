import { afterEach, describe, expect, it, vi } from 'vitest';

import { Agent } from '../../src/agent';
import type { Session } from '../../src/session';
import { SessionAPIImpl } from '../../src/session/rpc';
import * as sandbox from '../../src/tools/policies/process-sandbox-apply';
import type { ResolveProcessSandboxRuntimeResult } from '../../src/tools/policies/process-sandbox-apply';
import { testKaos } from '../fixtures/test-kaos';

afterEach(() => vi.restoreAllMocks());

function session(agents: readonly Agent[]) {
  return {
    metadata: { agents: {}, custom: { sandboxProfile: 'workspace', sandboxEnforcement: 'lexical' } },
    readyAgents: () => agents.values(),
    writeMetadata: vi.fn(async () => {}),
  };
}

describe('Session RPC sandbox metadata fan-out', () => {
  it('invalidates existing main and child gates synchronously and refuses ACK while a child activation is still pending', async () => {
    const agents = [new Agent({ kaos: testKaos }), new Agent({ kaos: testKaos, type: 'sub' })];
    const retained = agents.map((agent) => agent.kaos);
    const main = Promise.withResolvers<ResolveProcessSandboxRuntimeResult>();
    const child = Promise.withResolvers<ResolveProcessSandboxRuntimeResult>();
    vi.spyOn(sandbox, 'resolveProcessSandboxRuntime').mockReturnValueOnce(main.promise).mockReturnValueOnce(child.promise);
    const host = session(agents);
    const api = new SessionAPIImpl(host as unknown as Session);
    let acknowledged = false;
    const update = api.updateSessionMetadata({ metadata: { custom: { sandboxProfile: 'read-only', sandboxEnforcement: 'process' } } });
    const failed = expect(update).rejects.toThrow('one or more Agents');
    void update.then(() => { acknowledged = true; }, () => {});

    expect(agents.map((agent) => agent.sandboxState)).toEqual(['pending', 'pending']);
    for (const kaos of retained) await expect(kaos.exec('forbidden')).rejects.toMatchObject({ code: 'sandbox.pending' });
    main.reject(new Error('Main activation failed'));
    await Promise.resolve();
    expect(acknowledged).toBe(false);
    expect(host.writeMetadata).not.toHaveBeenCalled();
    expect(agents[1]?.sandboxState).toBe('pending');
    child.reject(new Error('Child activation failed'));
    await failed;
    expect(agents.map((agent) => agent.sandboxState)).toEqual(['error', 'error']);
    for (const kaos of retained) await expect(kaos.exec('forbidden')).rejects.toMatchObject({ code: 'sandbox.unavailable' });
    expect(host.writeMetadata).not.toHaveBeenCalled();
  });

  it('does not let an independent worker RPC metadata change weaken its host minimum or newly created children', async () => {
    const agents = [new Agent({ kaos: testKaos }), new Agent({ kaos: testKaos, type: 'sub' })];
    const host = { ...session(agents), options: { sandboxMinimum: { profile: 'read-only' as const, enforcement: 'lexical' as const } } };
    await new SessionAPIImpl(host as unknown as Session).updateSessionMetadata({ metadata: { custom: { sandboxProfile: 'off', sandboxEnforcement: 'lexical' } } });
    expect(agents.map((agent) => agent.sandboxProfile)).toEqual(['read-only', 'read-only']);
    expect(host.metadata.custom).toEqual({ sandboxProfile: 'read-only', sandboxEnforcement: 'lexical' });
    expect(host.writeMetadata).toHaveBeenCalledTimes(1);
  });

  it('applies the combined policy exactly once per agent and persists only after successful activation', async () => {
    const agents = [new Agent({ kaos: testKaos }), new Agent({ kaos: testKaos, type: 'sub' })];
    const setters = agents.map((agent) => vi.spyOn(agent, 'setSandboxPolicy'));
    const host = session(agents);
    await new SessionAPIImpl(host as unknown as Session).updateSessionMetadata({ metadata: { custom: { sandboxProfile: 'read-only', sandboxEnforcement: 'lexical' } } });
    for (const setter of setters) expect(setter).toHaveBeenCalledExactlyOnceWith({ profile: 'read-only', enforcement: 'lexical' });
    expect(agents.map((agent) => agent.sandboxState)).toEqual(['ready', 'ready']);
    expect(host.writeMetadata).toHaveBeenCalledTimes(1);
  });
});
