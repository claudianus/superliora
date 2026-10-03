import { access, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'pathe';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { AgentOptions } from '../../src/agent';
import type { SDKSessionRPC } from '../../src/rpc';
import { Session } from '../../src/session';
import { SessionAPIImpl } from '../../src/session/rpc';
import { ProviderManager } from '../../src/session/provider/provider-manager';
import { createScriptedGenerate } from '../agent/harness/scripted-generate';
import { testKaos } from '../fixtures/test-kaos';

const tempDirs: string[] = [];
afterEach(async () => {
  for (const dir of tempDirs.splice(0)) await rm(dir, { recursive: true, force: true });
});

async function fixture(generate: NonNullable<AgentOptions['generate']>) {
  const homedir = await mkdtemp(join(tmpdir(), 'liora-side-conversation-'));
  tempDirs.push(homedir);
  const rpc: SDKSessionRPC = {
    emitEvent: vi.fn(async () => {}),
    requestApproval: vi.fn(async () => ({ decision: 'cancelled' as const })),
    requestQuestion: vi.fn(async () => null),
    requestCredential: vi.fn(async () => null),
  };
  const session = new Session({
    kaos: testKaos.withCwd(homedir), homedir, rpc,
    providerManager: new ProviderManager({ config: {
      providers: { test: { type: 'kimi', apiKey: 'test-key' } },
      models: { 'mock-model': { provider: 'test', model: 'mock-model', maxContextSize: 100000 } },
    } }),
  });
  const { agent: main } = await session.createAgent({ type: 'main', generate });
  main.config.update({ modelAlias: 'mock-model', thinkingLevel: 'off' });
  return { session, main, api: new SessionAPIImpl(session), homedir };
}

describe('native side conversations', () => {
  it('persists a completed parent snapshot and independent follow-up history for native resume', async () => {
    const scripted = createScriptedGenerate();
    const { session, main, api, homedir } = await fixture(scripted.generate);
    main.context.appendUserMessage([{ type: 'text', text: 'parent baseline' }]);
    main.context.appendLoopEvent({ type: 'step.begin', uuid: 'unfinished-step', turnId: 'parent-turn', step: 1 });
    main.context.appendLoopEvent({
      type: 'tool.call', uuid: 'unfinished-call', turnId: 'parent-turn', step: 1,
      stepUuid: 'unfinished-step', toolCallId: 'unfinished-bash', name: 'Bash',
      args: { command: 'unfinished command' },
    });
    try {
      const id = await api.startBtw({ agentId: 'main' });
      const child = session.getReadyAgent(id);
      if (child === undefined) throw new Error('Expected side conversation');
      expect(session.metadata.agents[id]).toMatchObject({ type: 'sub', parentAgentId: 'main' });
      expect(scripted.calls).toEqual([]);
      main.context.appendUserMessage([{ type: 'text', text: 'parent added later' }]);
      scripted.mockNextResponse({ type: 'text', text: 'first answer' });
      await api.prompt({ agentId: id, input: [{ type: 'text', text: 'first question' }] });
      await vi.waitFor(() => {
        expect(scripted.calls).toHaveLength(1);
        expect(child.turn.hasActiveTurn).toBe(false);
        expect(JSON.stringify(child.context.history)).toContain('first answer');
      });
      expect(JSON.stringify(scripted.calls[0]?.history)).toContain('parent baseline');
      expect(JSON.stringify(scripted.calls[0]?.history)).not.toContain('parent added later');
      expect(JSON.stringify(scripted.calls[0]?.history)).not.toContain('unfinished command');
      scripted.mockNextResponse({ type: 'text', text: 'second answer' });
      await api.prompt({ agentId: id, input: [{ type: 'text', text: 'follow-up question' }] });
      await vi.waitFor(() => {
        expect(scripted.calls).toHaveLength(2);
        expect(child.turn.hasActiveTurn).toBe(false);
        expect(JSON.stringify(child.context.history)).toContain('second answer');
      });
      expect(JSON.stringify(scripted.calls[1]?.history)).toContain('first question');
      expect(JSON.stringify(scripted.calls[1]?.history)).toContain('first answer');
      expect(JSON.stringify(main.context.history)).not.toContain('first question');
      expect(JSON.stringify(main.context.history)).not.toContain('follow-up question');
      await child.records.flush();
      await expect(access(join(homedir, 'agents', id, 'wire.jsonl'))).resolves.toBeUndefined();
      await session.close();
      const restored = new Session(session.options);
      try {
        await restored.resume();
        const resumedChild = await restored.ensureAgentResumed(id);
        const history = JSON.stringify(resumedChild.context.history);
        expect(history).toContain('parent baseline');
        expect(history).toContain('first question');
        expect(history).toContain('second answer');
        expect(history).not.toContain('parent added later');
        expect(history).not.toContain('unfinished command');
      } finally {
        await restored.close();
      }
    } finally {
      await session.close();
    }
  });

  it('cancels through the returned agent id without cancelling or changing the parent', async () => {
    const started = Promise.withResolvers<void>();
    const generate: NonNullable<AgentOptions['generate']> = async (
      _chat, _systemPrompt, _tools, _history, _callbacks, options,
    ) => {
      const signal = options?.signal;
      if (signal === undefined) throw new Error('Expected cancellation signal');
      const aborted = Promise.withResolvers<never>();
      if (signal.aborted) aborted.reject(signal.reason);
      else signal.addEventListener('abort', () => aborted.reject(signal.reason), { once: true });
      started.resolve();
      return aborted.promise;
    };
    const { session, main, api } = await fixture(generate);
    main.context.appendUserMessage([{ type: 'text', text: 'unchanged parent' }]);
    const parentHistory = structuredClone(main.context.history);
    try {
      const id = await api.startBtw({ agentId: 'main' });
      const child = session.getReadyAgent(id);
      if (child === undefined) throw new Error('Expected side conversation');
      await api.prompt({ agentId: id, input: [{ type: 'text', text: 'cancel this question' }] });
      const settled = child.turn.waitForCurrentTurn();
      await started.promise;
      await api.cancel({ agentId: id });
      expect((await settled)?.event.reason).toBe('cancelled');
      expect(main.turn.hasActiveTurn).toBe(false);
      expect(main.context.history).toEqual(parentHistory);
    } finally {
      await session.close();
    }
  });
});
