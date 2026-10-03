import { createControlledPromise } from '@antfu/utils';
import { emptyUsage, type GenerateResult } from '@superliora/kosong';
import { describe, expect, it, vi } from 'vitest';

import type { Session } from '../../src/session';
import { SessionAPIImpl } from '../../src/session/rpc';
import { testAgent } from '../agent/harness/agent';

function response(text: string): GenerateResult {
  return {
    id: 'test', message: { role: 'assistant', content: [{ type: 'text', text }], toolCalls: [] },
    usage: emptyUsage(), finishReason: 'completed', rawFinishReason: 'stop',
  };
}

function host(agent: ReturnType<typeof testAgent>['agent'], role?: 'worker' | 'interactive-conductor') {
  return {
    options: { role },
    assertOpen: vi.fn(),
    metadata: { title: 'New Session', agents: {}, custom: {} },
    ensureAgentResumed: vi.fn(async () => agent),
    getSubagentHost: vi.fn(),
    writeMetadata: vi.fn(async () => {}),
    rpc: { emitEvent: vi.fn(async () => {}) },
  };
}

const input = (text: string, agentId = 'main') => ({ agentId, input: [{ type: 'text' as const, text }] });

describe('interactive conductor prompt admission', () => {
  it.each(['admitting', 'running'] as const)('preempts conductor inference while detached %s work never resolves', async (status) => {
    const entered = createControlledPromise<void>();
    const answered = createControlledPromise<void>();
    let requests = 0;
    const ctx = testAgent({ generate: async (_provider, _system, _tools, _history, _callbacks, options) => {
      if (++requests === 1) {
        entered.resolve();
        return new Promise<GenerateResult>((_resolve, reject) => {
          options!.signal!.addEventListener('abort', () => { reject(options!.signal!.reason); }, { once: true });
        });
      }
      answered.resolve();
      return response('Immediate answer');
    } });
    ctx.configure();
    const detachedCompletion = new Promise<void>(() => {});
    const coordination = { status, completion: detachedCompletion, close: vi.fn(), stop: vi.fn() };
    const session = { ...host(ctx.agent, 'interactive-conductor'), options: { role: 'interactive-conductor', coordination } } as unknown as Session;
    await new SessionAPIImpl(session).prompt(input('start work'));
    const oldTurn = ctx.agent.turn.waitForCurrentTurn();
    await entered;

    await new SessionAPIImpl(session).prompt(input('answer me now'));
    await answered;
    const nextTurn = ctx.agent.turn.waitForCurrentTurn();
    expect((await oldTurn).event.reason).toBe('cancelled');
    expect((await nextTurn).event.reason).toBe('completed');
    expect(requests).toBe(2);
    expect(coordination.close).not.toHaveBeenCalled();
    expect(coordination.stop).not.toHaveBeenCalled();
    expect(ctx.agent.context.messages.at(-1)?.content).toEqual([{ type: 'text', text: 'Immediate answer' }]);
  });

  it.each([undefined, 'worker'] as const)('preserves foreground busy semantics for role %s', async (role) => {
    const entered = createControlledPromise<void>();
    const release = createControlledPromise<void>();
    const ctx = testAgent({ generate: async () => { entered.resolve(); await release; return response('Original answer'); } });
    ctx.configure();
    const session = host(ctx.agent, role) as unknown as Session;
    await new SessionAPIImpl(session).prompt(input('foreground'));
    const end = ctx.agent.turn.waitForCurrentTurn();
    await entered;
    const cancel = vi.spyOn(ctx.agent.turn, 'cancel');
    await new SessionAPIImpl(session).prompt(input('second'));
    expect(cancel).not.toHaveBeenCalled();
    expect(ctx.agent.turn.currentId).toBe(0);
    release.resolve();
    expect((await end).event.reason).toBe('completed');
  });

  it('does not preempt a selected child in an interactive conductor session', async () => {
    const ctx = testAgent();
    ctx.configure();
    const prompt = vi.spyOn(ctx.agent.turn, 'prompt').mockReturnValue(0);
    const cancel = vi.spyOn(ctx.agent.turn, 'cancel');
    await new SessionAPIImpl(host(ctx.agent, 'interactive-conductor') as unknown as Session).prompt(input('worker input', 'agent-2'));
    expect(prompt).toHaveBeenCalledWith([{ type: 'text', text: 'worker input' }]);
    expect(cancel).not.toHaveBeenCalled();
  });

  it('retains local tool/context ownership until abort-ignoring execution settles', async () => {
    const entered = createControlledPromise<void>();
    const release = createControlledPromise<void>();
    let requests = 0;
    const ctx = testAgent({ generate: async () => {
      if (++requests === 1) { entered.resolve(); await release; }
      return response('answer');
    } });
    ctx.configure();
    const session = host(ctx.agent, 'interactive-conductor') as unknown as Session;
    await new SessionAPIImpl(session).prompt(input('original'));
    await entered;
    const cancelled = createControlledPromise<void>();
    const cancel = ctx.agent.turn.cancel.bind(ctx.agent.turn);
    vi.spyOn(ctx.agent.turn, 'cancel').mockImplementation((...args) => { cancel(...args); cancelled.resolve(); });
    let admitted = false;
    const next = new SessionAPIImpl(session).prompt(input('follow-up')).then(() => { admitted = true; });
    await cancelled;
    expect(admitted).toBe(false);
    expect(ctx.agent.turn.currentId).toBe(0);
    release.resolve();
    await next;
    expect(ctx.agent.turn.currentId).toBe(1);
    await ctx.agent.turn.waitForCurrentTurn();
  });
});
