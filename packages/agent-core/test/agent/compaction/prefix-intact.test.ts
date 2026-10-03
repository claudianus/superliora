import type { GenerateResult } from '@superliora/kosong';
import { describe, expect, it } from 'vitest';

import type { AgentOptions } from '../../../src/agent';
import { ErrorCodes } from '../../../src/errors';
import { testAgent } from '../harness/agent';

type GenerateFn = NonNullable<AgentOptions['generate']>;

function summaryResult(): GenerateResult {
  return {
    id: 'summary',
    message: { role: 'assistant', content: [{ type: 'text', text: 'A stale summary.' }], toolCalls: [] },
    usage: null,
    finishReason: 'completed',
    rawFinishReason: 'stop',
  };
}

describe('compaction prefix safety', () => {
  it.each(['clear', 'undo', 'edit'] as const)('rejects a stale summary after a prefix %s without discarding the current conversation', async (change) => {
    const started = Promise.withResolvers<void>();
    const response = Promise.withResolvers<GenerateResult>();
    const generate: GenerateFn = async () => {
      started.resolve();
      return response.promise;
    };
    const ctx = testAgent({ generate });
    ctx.configure();
    ctx.appendExchange(1, 'Original user intent.', 'Original assistant state.', 40);
    ctx.agent.fullCompaction.begin({ source: 'manual' });
    await started.promise;

    if (change === 'clear') {
      ctx.agent.context.clear();
      ctx.appendExchange(2, 'Replacement intent.', 'Replacement state.', 40);
    } else if (change === 'undo') {
      ctx.agent.context.undo(1);
    } else {
      ctx.agent.context.history[1]!.content.push({ type: 'text', text: 'Corrected state after the request began.' });
      ctx.agent.context.markContextChanged();
    }
    const current = structuredClone(ctx.agent.context.history);
    const rejected = expect(ctx.agent.fullCompaction.waitUntilSettled()).rejects.toMatchObject({
      code: ErrorCodes.COMPACTION_UNABLE,
    });
    response.resolve(summaryResult());
    await rejected;

    expect(ctx.agent.context.history).toEqual(current);
    expect(ctx.agent.context.history.some((message) => message.origin?.kind === 'compaction_summary')).toBe(false);
    expect(ctx.allEvents.some((event) => event.event === 'compaction.completed')).toBe(false);
    expect(ctx.agent.fullCompaction.isCompacting).toBe(false);
  });
});
