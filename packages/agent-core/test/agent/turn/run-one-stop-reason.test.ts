import { describe, expect, it } from 'vitest';

import { testAgent } from '../harness/agent';

describe('Agent provider stop boundaries', () => {
  it('exposes provider truncation without replaying or synthesizing a continuation', async () => {
    const ctx = testAgent();
    ctx.configure();
    ctx.mockNextProviderResponse({
      parts: [{ type: 'text', text: 'The provider stopped partway through' }],
      finishReason: 'max_tokens', rawFinishReason: 'length',
    });
    ctx.agent.turn.prompt([{ type: 'text', text: 'Write the answer' }]);
    const result = await ctx.agent.turn.waitForCurrentTurn();
    expect(result.event).toMatchObject({ reason: 'completed', stopReason: 'max_tokens' });
    expect(ctx.llmCalls).toHaveLength(1);
    expect(ctx.agent.context.messages.at(-1)?.content).toEqual([
      { type: 'text', text: 'The provider stopped partway through' },
    ]);
    expect(ctx.agent.turn.hasActiveTurn).toBe(false);
  });

  it('reports provider filtering without adding a substitute assistant answer', async () => {
    const ctx = testAgent();
    ctx.configure();
    ctx.mockNextProviderResponse({ parts: [], finishReason: 'filtered', rawFinishReason: 'content_filter' });
    ctx.agent.turn.prompt([{ type: 'text', text: 'Filtered request' }]);
    const result = await ctx.agent.turn.waitForCurrentTurn();
    expect(result.event.reason).toBe('filtered');
    expect(ctx.llmCalls).toHaveLength(1);
    expect(ctx.agent.context.messages.filter((message) => message.role === 'assistant').flatMap((message) => message.content)).toEqual([]);
  });
});
