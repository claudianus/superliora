import { describe, expect, it } from 'vitest';

import { testAgent } from './harness';

describe('scratch: second prompt hang', () => {
  it('diagnoses', async () => {
    const ctx = testAgent();
    ctx.configure();

    const turn = ctx.agent.turn as unknown as {
      activeTurn: unknown;
      turnId: number;
      steerBuffer: unknown[];
    };
    const fullCompaction = ctx.agent.fullCompaction as unknown as {
      compacting: unknown;
      isCompacting: boolean;
    };

    ctx.mockNextResponse({ type: 'text', text: 'first' });
    await ctx.rpc.prompt({ input: [{ type: 'text', text: 'first prompt' }] });
    await ctx.untilTurnEnd();

    // eslint-disable-next-line no-console
    console.log('STATE-AFTER-TURN-1', {
      activeTurn: turn.activeTurn === null ? 'null' : typeof turn.activeTurn,
      turnId: turn.turnId,
      steerBuffer: turn.steerBuffer.length,
      compacting: fullCompaction.compacting === null ? 'null' : 'set',
      isCompacting: fullCompaction.isCompacting,
    });

    ctx.mockNextResponse({ type: 'text', text: 'second' });
    const promptPromise = ctx.rpc.prompt({ input: [{ type: 'text', text: 'second prompt' }] });
    await promptPromise;
    // eslint-disable-next-line no-console
    console.log('STATE-AFTER-PROMPT-2', {
      activeTurn: turn.activeTurn === null ? 'null' : typeof turn.activeTurn,
      turnId: turn.turnId,
    });

    const endRace = await Promise.race([
      ctx.untilTurnEnd().then(() => 'ended' as const),
      new Promise<'timeout'>((resolve) => setTimeout(() => resolve('timeout'), 5000)),
    ]);
    // eslint-disable-next-line no-console
    console.log('TURN-2-RESULT', endRace);
    const recent = ctx.allEvents.slice(-12).map((e) => `${e.type}:${String((e as { event?: unknown }).event ?? '')}`);
    // eslint-disable-next-line no-console
    console.log('RECENT-EVENTS', JSON.stringify(recent));
    expect(endRace).toBe('ended');
  }, 20_000);
});
