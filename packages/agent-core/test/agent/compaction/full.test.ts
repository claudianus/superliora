import { APIStatusError, type GenerateResult } from '@superliora/kosong';
import { describe, expect, it, vi } from 'vitest';

import type { AgentOptions } from '../../../src/agent';
import { ErrorCodes, LioraError } from '../../../src/errors';
import { testAgent } from '../harness/agent';

type GenerateFn = NonNullable<AgentOptions['generate']>;

function textResult(text: string): GenerateResult {
  return {
    id: 'summary',
    message: { role: 'assistant', content: [{ type: 'text', text }], toolCalls: [] },
    usage: null,
    finishReason: 'completed',
    rawFinishReason: 'stop',
  };
}

describe('FullCompaction explicit lifecycle', () => {
  it.each(['manual', 'agent'] as const)('applies an explicit %s summary without calling the provider', async (source) => {
    const generate = vi.fn<GenerateFn>();
    const ctx = testAgent({ generate });
    ctx.configure();
    ctx.appendExchange(1, 'Keep the existing API.', 'Updated the implementation.', 40);
    const user = ctx.agent.context.history[0];

    ctx.agent.fullCompaction.begin({ source, summary: 'The implementation changed; the API is unchanged.' });
    expect(ctx.agent.fullCompaction.isCompacting).toBe(true);
    await expect(ctx.agent.fullCompaction.waitUntilSettled()).resolves.toBe(true);

    expect(generate).not.toHaveBeenCalled();
    expect(ctx.agent.fullCompaction.isCompacting).toBe(false);
    expect(ctx.agent.context.history[0]).toBe(user);
    expect(ctx.agent.context.history[1]).toMatchObject({
      role: 'user',
      origin: { kind: 'compaction_summary' },
      content: [{ type: 'text', text: 'Conversation summary:\nThe implementation changed; the API is unchanged.' }],
    });
    expect(ctx.allEvents).toContainEqual(expect.objectContaining({
      event: 'compaction.started', args: expect.objectContaining({ trigger: source }),
    }));
    expect(ctx.allEvents).toContainEqual(expect.objectContaining({ event: 'compaction.completed' }));
    await expect(ctx.agent.fullCompaction.waitUntilSettled()).resolves.toBe(false);
  });

  it('rejects an empty conversation synchronously without starting a request', () => {
    const generate = vi.fn<GenerateFn>();
    const ctx = testAgent({ generate });
    ctx.configure();

    expect(() => ctx.agent.fullCompaction.begin({ source: 'manual' })).toThrow(
      expect.objectContaining({ code: ErrorCodes.COMPACTION_UNABLE }),
    );
    expect(ctx.agent.fullCompaction.isCompacting).toBe(false);
    expect(generate).not.toHaveBeenCalled();
  });

  it('rejects manual compaction while a provider turn is actually running', async () => {
    const started = Promise.withResolvers<void>();
    const response = Promise.withResolvers<GenerateResult>();
    const ctx = testAgent({ generate: async () => {
      started.resolve();
      return response.promise;
    } });
    ctx.configure();
    ctx.agent.turn.prompt([{ type: 'text', text: 'Continue the task.' }]);
    await started.promise;

    expect(() => ctx.agent.fullCompaction.begin({ source: 'manual', summary: 'Premature.' })).toThrow(
      expect.objectContaining({ code: ErrorCodes.COMPACTION_UNABLE }),
    );
    expect(ctx.agent.fullCompaction.isCompacting).toBe(false);
    response.resolve(textResult('Finished.'));
    await ctx.agent.turn.waitForCurrentTurn();
  });

  it('keeps cancellation active until an abort-ignoring provider settles', async () => {
    const started = Promise.withResolvers<AbortSignal>();
    const response = Promise.withResolvers<GenerateResult>();
    const generate: GenerateFn = async (_provider, _system, _tools, _history, _callbacks, options) => {
      started.resolve(options!.signal!);
      return response.promise;
    };
    const ctx = testAgent({ generate });
    ctx.configure();
    ctx.appendExchange(1, 'Original request.', 'Original response.', 40);
    const history = [...ctx.agent.context.history];
    ctx.agent.fullCompaction.begin({ source: 'manual' });
    const signal = await started.promise;
    const settled = ctx.agent.fullCompaction.waitUntilSettled();
    const rejected = expect(settled).rejects.toMatchObject({ name: 'AbortError' });

    ctx.agent.fullCompaction.cancel();
    expect(signal.aborted).toBe(true);
    expect(ctx.agent.fullCompaction.isCompacting).toBe(true);
    expect(ctx.allEvents.some((event) => event.event === 'compaction.cancelled')).toBe(false);
    expect(() => ctx.agent.fullCompaction.begin({ source: 'manual', summary: 'Concurrent.' })).toThrow(
      expect.objectContaining({ code: ErrorCodes.COMPACTION_UNABLE }),
    );

    response.resolve(textResult('Must not be applied.'));
    await rejected;
    expect(ctx.agent.fullCompaction.isCompacting).toBe(false);
    expect(ctx.agent.context.history).toEqual(history);
    expect(ctx.allEvents.some((event) => event.event === 'compaction.completed')).toBe(false);
    expect(ctx.allEvents.some((event) => event.event === 'compaction.cancelled')).toBe(true);

    ctx.agent.fullCompaction.begin({ source: 'manual', summary: 'A later request may complete.' });
    await ctx.agent.fullCompaction.waitUntilSettled();
    expect(ctx.agent.context.history[1]?.origin?.kind).toBe('compaction_summary');
  });

  it.each([
    ['provider failure', new Error('provider unavailable')],
    ['authentication failure', new APIStatusError(401, 'invalid credential')],
    ['login required', new LioraError(ErrorCodes.AUTH_LOGIN_REQUIRED, 'login required')],
  ])('surfaces %s without replacing context with fabricated fallback content', async (_name, failure) => {
    const generate = vi.fn<GenerateFn>().mockRejectedValue(failure);
    const ctx = testAgent({ generate });
    ctx.configure();
    ctx.appendExchange(1, 'Original intent.', 'Original state.', 40);
    const history = [...ctx.agent.context.history];

    ctx.agent.fullCompaction.begin({ source: 'manual' });
    await expect(ctx.agent.fullCompaction.waitUntilSettled()).rejects.toBe(failure);

    expect(generate).toHaveBeenCalledTimes(1);
    expect(ctx.agent.context.history).toEqual(history);
    expect(ctx.agent.fullCompaction.isCompacting).toBe(false);
    expect(ctx.allEvents).toContainEqual(expect.objectContaining({
      event: 'error', args: expect.objectContaining({ code: ErrorCodes.COMPACTION_FAILED }),
    }));
    expect(ctx.allEvents.some((event) => event.event === 'compaction.completed')).toBe(false);
  });

  it.each(['', ' \n\t '])('rejects an empty explicit summary and allows a later request', async (summary) => {
    const ctx = testAgent();
    ctx.configure();
    ctx.appendExchange(1, 'User intent.', 'Prior work.', 40);
    const history = [...ctx.agent.context.history];

    ctx.agent.fullCompaction.begin({ source: 'manual', summary });
    await expect(ctx.agent.fullCompaction.waitUntilSettled()).rejects.toMatchObject({
      code: ErrorCodes.COMPACTION_FAILED,
    });
    expect(ctx.agent.context.history).toEqual(history);
    expect(ctx.agent.fullCompaction.isCompacting).toBe(false);

    ctx.agent.fullCompaction.begin({ source: 'manual', summary: 'Valid summary.' });
    await ctx.agent.fullCompaction.waitUntilSettled();
    expect(ctx.agent.context.history[1]?.origin?.kind).toBe('compaction_summary');
  });

  it('rejects a provider response containing no summary text', async () => {
    const result = textResult('');
    result.message.content = [{ type: 'think', think: 'Internal reasoning is not a summary.' }];
    const generate = vi.fn<GenerateFn>().mockResolvedValue(result);
    const ctx = testAgent({ generate });
    ctx.configure();
    ctx.appendExchange(1, 'User intent.', 'Prior work.', 40);
    const history = [...ctx.agent.context.history];

    ctx.agent.fullCompaction.begin({ source: 'manual' });
    await expect(ctx.agent.fullCompaction.waitUntilSettled()).rejects.toMatchObject({
      code: ErrorCodes.COMPACTION_FAILED,
    });
    expect(generate).toHaveBeenCalledTimes(1);
    expect(ctx.agent.context.history).toEqual(history);
  });
});
