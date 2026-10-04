import { createControlledPromise } from '@antfu/utils';
import { emptyUsage, type GenerateResult, type ToolCall } from '@superliora/kosong';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { Session } from '../../src/session';
import { SessionAPIImpl } from '../../src/session/rpc';
import { SessionCoordinator, type CoordinatorProjection, type IndependentSessionHandle } from '../../src/session/coordinator';
import { ProviderManager } from '../../src/session/provider/provider-manager';
import { testKaos } from '../fixtures/test-kaos';

function response(text: string, toolCalls: ToolCall[] = []): GenerateResult {
  return { id: 'test', message: { role: 'assistant', content: text ? [{ type: 'text', text }] : [], toolCalls },
    usage: emptyUsage(), finishReason: toolCalls.length > 0 ? 'tool_calls' : 'completed', rawFinishReason: toolCalls.length > 0 ? 'tool_calls' : 'stop' };
}

describe('product conductor independent dispatch and preemption', () => {
  it.each(['admitting', 'running'] as const)('answers user input without joining an independent runtime held at %s', async (phase) => {
    const workDir = await mkdtemp(join(tmpdir(), 'liora-independent-priority-'));
    const admission = createControlledPromise<IndependentSessionHandle>();
    const completion = createControlledPromise<string | undefined>();
    const admissionEntered = createControlledPromise<void>();
    const inferenceEntered = createControlledPromise<void>();
    let workerSignal: AbortSignal | undefined;
    let projection: CoordinatorProjection | undefined;
    const handle = { sessionId: 'independent-worker', completion, message: async () => {} };
    if (phase === 'running') admission.resolve(handle);
    const coordinator = await SessionCoordinator.open({
      policy: { role: 'conductor', maxConcurrent: 1, authorizedRoots: [workDir] },
      store: {
        load: async () => undefined,
        save: async (next) => { projection = structuredClone(next); },
        close: async () => {},
      },
      runtime: { admit: async (_id, _request, signal) => {
        workerSignal = signal;
        admissionEntered.resolve();
        return admission;
      } },
    });
    const session = new Session({
      role: 'interactive-conductor', coordination: coordinator, homedir: workDir,
      kaos: testKaos.withCwd(workDir),
      rpc: { emitEvent: async () => {}, requestApproval: async () => ({ decision: 'cancelled' }), requestQuestion: async () => null, requestCredential: async () => null },
      providerManager: new ProviderManager({ config: {
        providers: { test: { type: 'kimi', apiKey: 'test-key' } },
        models: { 'mock-model': { provider: 'test', model: 'mock-model', maxContextSize: 100000 } },
      } }),
    });
    let requests = 0;
    try {
      const { agent } = await session.createAgent({ type: 'main', generate: async (_provider, _system, _tools, _history, _callbacks, options) => {
        requests++;
        if (requests === 1) return response('', [{ type: 'function', id: 'dispatch-worker', name: 'SessionControl', arguments: JSON.stringify({
          operation: 'spawn', cwd: workDir, prompt: 'Independent work that remains held', description: 'Held worker', idempotencyKey: 'request-one',
        }) }]);
        if (requests === 2) {
          inferenceEntered.resolve();
          return new Promise<GenerateResult>((_resolve, reject) => {
            options!.signal!.addEventListener('abort', () => { reject(options!.signal!.reason); }, { once: true });
          });
        }
        return response('User answer while independent work continues');
      } });
      agent.config.update({ modelAlias: 'mock-model', thinkingLevel: 'off' });
      agent.permission.setMode('yolo');
      const api = new SessionAPIImpl(session);
      await api.prompt({ agentId: 'main', input: [{ type: 'text', text: 'Dispatch independent work' }] });
      const oldTurn = agent.turn.waitForCurrentTurn();
      await inferenceEntered;
      expect(projection?.records[0]?.request.description, JSON.stringify(agent.context.messages)).toBe('Held worker');
      const acceptedId = coordinator.list()[0]!.id;
      const reachedPhase = createControlledPromise<void>();
      const unsubscribe = coordinator.onChange(() => { if (coordinator.get(acceptedId)?.status === phase) reachedPhase.resolve(); });
      await coordinator.tick();
      await admissionEntered;
      if (coordinator.get(acceptedId)?.status === phase) reachedPhase.resolve();
      await reachedPhase;
      unsubscribe();
      // Admission/completion do not resolve until the fixture cleanup below.
      // No timing budget: reaching the new answer proves neither was joined.
      await new SessionAPIImpl(session).prompt({ agentId: 'main', input: [{ type: 'text', text: 'Answer me immediately' }] });
      await agent.turn.waitForCurrentTurn();
      expect((await oldTurn).event.reason).toBe('cancelled');
      expect(requests).toBe(3);
      expect(workerSignal?.aborted).toBe(false);
      expect(coordinator.get(acceptedId)?.status).toBe(phase);
      expect(agent.context.messages.at(-1)?.content).toEqual([{ type: 'text', text: 'User answer while independent work continues' }]);
    } finally {
      admission.resolve(handle);
      completion.resolve('Fixture teardown');
      await session.close();
      await coordinator.close();
      await rm(workDir, { recursive: true, force: true });
    }
  });
});
