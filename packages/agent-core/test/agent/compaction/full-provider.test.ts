import type { GenerateResult } from '@superliora/kosong';
import { describe, expect, it, vi } from 'vitest';

import type { AgentOptions } from '../../../src/agent';
import { ErrorCodes } from '../../../src/errors';
import { testAgent } from '../harness/agent';

type GenerateFn = NonNullable<AgentOptions['generate']>;

function textResult(): GenerateResult {
  return {
    id: 'summary',
    message: {
      role: 'assistant',
      content: [
        { type: 'text', text: 'Current state. ' },
        { type: 'think', think: 'Not summary content.' },
        { type: 'text', text: 'Next action.' },
      ],
      toolCalls: [],
    },
    usage: { inputOther: 17, output: 5, inputCacheRead: 3, inputCacheCreation: 2 },
    finishReason: 'completed',
    rawFinishReason: 'stop',
  };
}

describe('compaction current provider', () => {
  it('uses the selected session provider, not a cheaper catalog model, including after a model change', async () => {
    const generate = vi.fn<GenerateFn>().mockImplementation(async (_provider, _system, _tools, _history, callbacks) => {
      await callbacks?.onMessagePart?.({ type: 'text', text: 'Current state. ' });
      return textResult();
    });
    const ctx = testAgent({
      generate,
      initialConfig: {
        providers: { catalog: { type: 'kimi', apiKey: 'test-key' } },
        models: { 'cheap-alias': { provider: 'catalog', model: 'claude-3-5-haiku' } },
      },
    });
    ctx.configure({ provider: { type: 'kimi', apiKey: 'test-key', model: 'kimi-code' } });
    ctx.agent.config.update({ thinkingLevel: 'high' });
    ctx.appendExchange(1, 'Continue the same task.', 'Earlier state.', 40);
    const firstProvider = ctx.agent.config.provider;

    ctx.agent.fullCompaction.begin({ source: 'manual', instruction: 'Preserve the deployment constraints and summarize only the conversation.' });
    await ctx.agent.fullCompaction.waitUntilSettled();

    expect(generate.mock.calls[0]?.[0]).toBe(firstProvider);
    expect(generate.mock.calls[0]?.[1]).toBe('Preserve the deployment constraints and summarize only the conversation.');
    expect(generate.mock.calls[0]?.[2]).toEqual([]);
    expect(generate.mock.calls[0]?.[3].map((message) => message.role)).toEqual(['user', 'assistant']);
    expect(generate.mock.calls[0]?.[5]?.signal).toBeInstanceOf(AbortSignal);
    expect(ctx.agent.context.history[1]?.content).toEqual([{ type: 'text', text: 'Conversation summary:\nCurrent state. Next action.' }]);
    expect(ctx.allEvents).toContainEqual(expect.objectContaining({
      event: 'compaction.progress', args: expect.objectContaining({ phase: 'summarizing', delta: 'Current state. ' }),
    }));
    expect(ctx.allEvents).toContainEqual(expect.objectContaining({
      event: 'usage.record', args: expect.objectContaining({
        model: 'kimi-code', usage: textResult().usage,
      }),
    }));

    ctx.configureRuntimeModel({ type: 'kimi', apiKey: 'test-key', model: 'kimi-k2' });
    const secondProvider = ctx.agent.config.provider;
    ctx.agent.fullCompaction.begin({ source: 'manual' });
    await ctx.agent.fullCompaction.waitUntilSettled();

    expect(generate).toHaveBeenCalledTimes(2);
    expect(generate.mock.calls[1]?.[0]).toBe(secondProvider);
    expect(secondProvider.modelName).toBe('kimi-k2');
    expect(ctx.allEvents).toContainEqual(expect.objectContaining({
      event: 'usage.record', args: expect.objectContaining({ model: 'kimi-k2' }),
    }));
  });

  it('uses conversation-only summary instructions rather than the agent tool-operating system prompt', async () => {
    const generate = vi.fn<GenerateFn>().mockResolvedValue(textResult());
    const ctx = testAgent({ generate });
    ctx.configure();
    ctx.agent.config.update({ systemPrompt: 'Private tool-operating instructions for the active agent.' });
    ctx.appendExchange(1, 'Keep the exact user request.', 'Current work.', 40);
    const original = structuredClone(ctx.agent.context.history);

    ctx.agent.fullCompaction.begin({ source: 'manual' });
    await ctx.agent.fullCompaction.waitUntilSettled();

    const request = generate.mock.calls[0]!;
    expect(request[1]).not.toContain('Private tool-operating instructions');
    expect(request[2]).toEqual([]);
    expect(request[3].map(({ role, content, toolCalls }) => ({ role, content, toolCalls })))
      .toEqual(original.map(({ role, content, toolCalls }) => ({ role, content, toolCalls })));
    expect(ctx.agent.config.systemPrompt).toBe('Private tool-operating instructions for the active agent.');
  });

  it('surfaces missing current-provider configuration without issuing a summarizer request', async () => {
    const generate = vi.fn<GenerateFn>();
    const ctx = testAgent({ generate });
    ctx.agent.context.appendUserMessage([{ type: 'text', text: 'An existing request without a configured provider.' }]);
    const history = structuredClone(ctx.agent.context.history);

    ctx.agent.fullCompaction.begin({ source: 'manual' });
    await expect(ctx.agent.fullCompaction.waitUntilSettled()).rejects.toMatchObject({ code: ErrorCodes.MODEL_NOT_CONFIGURED });

    expect(generate).not.toHaveBeenCalled();
    expect(ctx.agent.context.history).toEqual(history);
    expect(ctx.agent.fullCompaction.isCompacting).toBe(false);
  });
});
