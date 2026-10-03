import { afterEach, describe, expect, it, vi } from 'vitest';
import { Agent } from '../../src/agent';
import { applySandboxPolicyToAgents } from '../../src/session/sandbox-policy-update';
import * as sandbox from '../../src/tools/policies/process-sandbox-apply';
import { testKaos } from '../fixtures/test-kaos';
import type { ResolveProcessSandboxRuntimeResult } from '../../src/tools/policies/process-sandbox-apply';

afterEach(() => vi.restoreAllMocks());

describe('host sandbox policy fan-out', () => {
  it('invalidates main and existing children synchronously and propagates activation failures', async () => {
    const agents = [new Agent({ kaos: testKaos }), new Agent({ kaos: testKaos, type: 'sub' })];
    const retained = agents.map(agent => agent.kaos);
    const first = Promise.withResolvers<ResolveProcessSandboxRuntimeResult>();
    const child = Promise.withResolvers<ResolveProcessSandboxRuntimeResult>();
    vi.spyOn(sandbox, 'resolveProcessSandboxRuntime').mockReturnValueOnce(first.promise).mockReturnValueOnce(child.promise);
    const update = applySandboxPolicyToAgents(agents, { enforcement: 'process', profile: 'read-only' });
    const failed = expect(update).rejects.toThrow(/one or more Agents/);
    expect(agents.map(agent => agent.sandboxState)).toEqual(['pending', 'pending']);
    for (const host of retained) await expect(host.exec('forbidden')).rejects.toMatchObject({ code: 'sandbox.pending' });
    first.reject(new Error('main Docker error'));
    child.reject(new Error('child Docker error'));
    await failed;
    expect(agents.map(agent => agent.sandboxState)).toEqual(['error', 'error']);
    for (const host of retained) await expect(host.exec('forbidden')).rejects.toMatchObject({ code: 'sandbox.unavailable' });
    await applySandboxPolicyToAgents(agents, { enforcement: 'lexical', profile: 'workspace' });
    expect(agents.map(agent => agent.sandboxState)).toEqual(['ready', 'ready']);
    for (const host of retained) await expect(host.exec('forbidden')).rejects.toMatchObject({ code: 'sandbox.stale' });
  });

  it('starts every Agent update despite a synchronous setter failure and waits for all activations', async () => {
    const ready = Promise.withResolvers<void>();
    const later = vi.fn(() => ready.promise);
    const failure = new Error('first host refused update');
    const update = applySandboxPolicyToAgents([
      { setSandboxPolicy: () => { throw failure; } }, { setSandboxPolicy: later },
    ], { enforcement: 'process' });
    let settled = false;
    const observed = update.catch(error => { settled = true; return error as AggregateError; });
    expect(later).toHaveBeenCalledExactlyOnceWith({ enforcement: 'process' });
    await Promise.resolve();
    expect(settled).toBe(false);
    ready.resolve();
    expect((await observed)?.errors).toEqual([failure]);
  });
});
