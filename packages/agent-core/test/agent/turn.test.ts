import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { LocalKaos } from '@superliora/kaos';
import { createControlledPromise } from '@antfu/utils';
import { emptyUsage, type GenerateResult, type Message, type ToolCall } from '@superliora/kosong';
import { describe, expect, it, onTestFinished, vi } from 'vitest';

import type { AgentOptions } from '../../src/agent';
import { userCancellationReason } from '../../src/utils/abort';
import { testAgent } from './harness/agent';

function response(text: string, toolCalls: ToolCall[] = []): GenerateResult {
  return {
    id: 'test-response',
    message: { role: 'assistant', content: text ? [{ type: 'text', text }] : [], toolCalls },
    usage: { ...emptyUsage(), inputOther: 2, output: 1 },
    finishReason: toolCalls.length > 0 ? 'tool_calls' : 'completed',
    rawFinishReason: toolCalls.length > 0 ? 'tool_calls' : 'stop',
  };
}

function bashCall(id: string, command: string): ToolCall {
  return { type: 'function', id, name: 'Bash', arguments: JSON.stringify({ command }) };
}

describe('autonomous Agent turn flow', () => {
  it('ends after the model ends, retaining exact text and native reasoning', async () => {
    const text = 'In conclusion, <think>this is literal user-visible text</think>.';
    const ctx = testAgent({
      generate: async (_provider, _system, tools, _history, callbacks) => {
        expect(tools.map((tool) => tool.name)).toEqual(['Bash', 'SessionControl']);
        await callbacks?.onMessagePart?.({ type: 'think', think: 'native reasoning', encrypted: 'signature' });
        await callbacks?.onMessagePart?.({ type: 'text', text });
        const result = response(text);
        result.message.content.unshift({ type: 'think', think: 'native reasoning', encrypted: 'signature' });
        return result;
      },
    });
    ctx.configure();
    const events: unknown[] = [];
    vi.spyOn(ctx.agent, 'emitEvent').mockImplementation((event) => { events.push(event); });
    ctx.agent.turn.prompt([{ type: 'text', text: 'Answer directly' }]);
    const end = await ctx.agent.turn.waitForCurrentTurn();
    expect(end.event.reason).toBe('completed');
    expect(events).toContainEqual({ type: 'assistant.delta', turnId: 0, delta: text });
    expect(events).toContainEqual({ type: 'thinking.delta', turnId: 0, delta: 'native reasoning' });
    expect(ctx.agent.context.messages.at(-1)?.content).toEqual([
      { type: 'think', think: 'native reasoning', encrypted: 'signature' },
      { type: 'text', text },
    ]);
    expect(ctx.agent.turn.hasActiveTurn).toBe(false);
  });

  it('executes repeated requested effects and keeps them after a later provider failure and explicit retry', async () => {
    let calls = 0;
    const requests: Message[][] = [];
    const directory = await mkdtemp(join(tmpdir(), 'liora-repeated-effects-'));
    onTestFinished(() => rm(directory, { recursive: true, force: true }));
    const effectPath = join(directory, 'effects.txt');
    const kaos = await LocalKaos.create();
    const ctx = testAgent({
      kaos,
      generate: async (_provider, _system, _tools, history) => {
        requests.push(structuredClone(history));
        calls += 1;
        if (calls === 1) return response('', [
          bashCall('first', 'printf effect >> effects.txt'),
          bashCall('second', 'printf effect >> effects.txt'),
        ]);
        if (calls === 2) throw new Error('provider failed after effects');
        return response('Recovered by explicit user retry');
      },
    });
    ctx.configure();
    ctx.agent.config.update({ cwd: directory });
    ctx.agent.permission.setMode('yolo');
    ctx.agent.turn.prompt([{ type: 'text', text: 'Run both calls' }]);
    const failed = await ctx.agent.turn.waitForCurrentTurn();
    expect(failed.event.reason).toBe('failed');
    expect(failed.event.error?.message).toContain('provider failed after effects');
    expect(calls).toBe(2);
    expect(await readFile(effectPath, 'utf8')).toBe('effecteffect');
    const beforeRetry = structuredClone(ctx.agent.context.messages);
    expect(beforeRetry.filter((message) => message.role === 'tool')).toHaveLength(2);
    ctx.agent.turn.retry();
    expect((await ctx.agent.turn.waitForCurrentTurn()).event.reason).toBe('completed');
    expect(await readFile(effectPath, 'utf8')).toBe('effecteffect');
    expect(requests[2]?.slice(0, beforeRetry.length)).toEqual(beforeRetry);
  });

  it('preserves steering verbatim without adding workflow instructions', async () => {
    const entered = createControlledPromise<void>();
    const release = createControlledPromise<void>();
    const requests: Message[][] = [];
    const generate: NonNullable<AgentOptions['generate']> = async (_provider, _system, _tools, history) => {
      requests.push(structuredClone(history));
      if (requests.length === 1) {
        entered.resolve();
        await release;
      }
      return response('answer');
    };
    const ctx = testAgent({ generate });
    ctx.configure();
    ctx.agent.turn.prompt([{ type: 'text', text: 'Initial input' }]);
    const end = ctx.agent.turn.waitForCurrentTurn();
    await entered;
    ctx.agent.turn.steer([{ type: 'text', text: 'Change direction, exactly this.' }]);
    release.resolve();
    expect((await end).event.reason).toBe('completed');
    expect(requests).toHaveLength(2);
    expect(requests[1]?.at(-1)).toMatchObject({
      role: 'user', content: [{ type: 'text', text: 'Change direction, exactly this.' }],
    });
  });

  it('retains cancellation ownership until an abort-ignoring provider settles', async () => {
    const entered = createControlledPromise<void>();
    const release = createControlledPromise<void>();
    const ctx = testAgent({ generate: async () => {
      entered.resolve();
      await release;
      return response('late response');
    } });
    ctx.configure();
    ctx.agent.turn.prompt([{ type: 'text', text: 'Work' }]);
    let settled = false;
    const end = ctx.agent.turn.waitForCurrentTurn().then((result) => { settled = true; return result; });
    await entered;
    ctx.agent.turn.cancel(undefined, userCancellationReason());
    await Promise.resolve();
    expect(settled).toBe(false);
    expect(ctx.agent.turn.hasActiveTurn).toBe(true);
    expect(ctx.agent.turn.prompt([{ type: 'text', text: 'Cannot race execution' }])).toBeNull();
    release.resolve();
    expect((await end).event.reason).toBe('cancelled');
    expect(ctx.agent.turn.hasActiveTurn).toBe(false);
    const history = structuredClone(ctx.agent.context.messages);
    await Promise.resolve();
    expect(ctx.agent.context.messages).toEqual(history);
  });
});
