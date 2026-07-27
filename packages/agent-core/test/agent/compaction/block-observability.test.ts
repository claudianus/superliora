import type { Message } from '@superliora/kosong';
import { describe, expect, it } from 'vitest';

import type { AgentOptions } from '../../../src/agent';
import type { CompactionStrategy } from '../../../src/agent/compaction';
import { testAgent } from '../harness/agent';

type GenerateFn = NonNullable<AgentOptions['generate']>;

const CATALOGUED_PROVIDER = {
  type: 'kimi',
  apiKey: 'test-key',
  model: 'kimi-code',
} as const;
const CATALOGUED_MODEL_CAPABILITIES = {
  image_in: true,
  video_in: true,
  audio_in: false,
  thinking: true,
  tool_use: true,
  max_context_tokens: 256_000,
} as const;

/**
 * Mirror of full.test.ts's `parallelCompactAll`: compact everything in one
 * round and force the parallel-block path (threshold/target of 1 token).
 */
const parallelCompactAll: CompactionStrategy = {
  shouldCompact: () => true,
  shouldBlock: () => true,
  shouldAsyncCompact: () => false,
  computeCompactCount: (messages: readonly Message[]) => messages.length,
  reduceCompactOnOverflow: (messages: readonly Message[]) => messages.length,
  checkAfterStep: true,
  maxCompactionPerTurn: 1,
  maxOverflowCompactionAttempts: 3,
  asyncTriggerRatio: 0.5,
  frozenZoneSize: 2,
  parallelBlockThreshold: 1,
  parallelBlockTarget: 1,
};

interface BlockTokensShape {
  readonly inputOther: number;
  readonly output: number;
  readonly inputCacheRead: number;
  readonly inputCacheCreation: number;
}

interface CompactionProgressArgs {
  readonly phase?: string;
  readonly streamKind?: string;
  readonly blockIndex?: number;
  readonly blockCount?: number;
  readonly blocksCompleted?: number;
  readonly fraction?: number;
  readonly delta?: string;
  readonly blockDurationMs?: number;
  readonly blockTokens?: BlockTokensShape;
}

function textResult(text: string, usage: BlockTokensShape): Awaited<ReturnType<GenerateFn>> {
  return {
    id: 'mock-block-observability',
    message: {
      role: 'assistant',
      content: [{ type: 'text', text }],
      toolCalls: [],
    },
    usage,
    finishReason: 'completed',
    rawFinishReason: 'stop',
  };
}

function lastPromptText(history: readonly Message[]): string {
  const last = history.at(-1);
  if (last === undefined) return '';
  return last.content
    .flatMap((part) => (part.type === 'text' ? [part.text] : []))
    .join('\n');
}

describe('parallel block compaction observability', () => {
  it('emits per-block duration and token usage on block-completion progress ticks', async () => {
    let blockCalls = 0;
    const generate: GenerateFn = async (_provider, _system, _tools, history) => {
      const prompt = lastPromptText(history);
      if (prompt.includes('Merge these block-level compaction summaries')) {
        return textResult('Merged block summary with the final next action.', {
          inputOther: 100,
          output: 50,
          inputCacheRead: 0,
          inputCacheCreation: 0,
        });
      }
      blockCalls += 1;
      return textResult(`Block ${String(blockCalls)} summary.`, {
        inputOther: 10 + blockCalls,
        output: 20 + blockCalls,
        inputCacheRead: 0,
        inputCacheCreation: 0,
      });
    };
    const ctx = testAgent({ generate, compactionStrategy: parallelCompactAll });
    ctx.configure({
      provider: CATALOGUED_PROVIDER,
      modelCapabilities: CATALOGUED_MODEL_CAPABILITIES,
    });
    ctx.appendExchange(1, 'old user one', 'old assistant one', 20);
    ctx.appendExchange(2, 'old user two', 'old assistant two', 20);
    ctx.appendExchange(3, 'old user three', 'old assistant three', 20);
    const compacted = ctx.once('context.apply_compaction');
    const completed = ctx.once('compaction.completed');

    await ctx.rpc.beginCompaction({});
    await compacted;
    await completed;

    // The parallel path ran with at least two blocks.
    expect(blockCalls).toBeGreaterThanOrEqual(2);

    const events = ctx.newEvents() as ReadonlyArray<{
      readonly event: string;
      readonly args: unknown;
    }>;
    const progress = events
      .filter((entry) => entry.event === 'compaction.progress')
      .map((entry) => entry.args as CompactionProgressArgs);

    const completions = progress.filter(
      (args) => args.streamKind === 'block' && args.blockDurationMs !== undefined,
    );
    expect(completions).toHaveLength(blockCalls);
    for (const tick of completions) {
      expect(tick.blockDurationMs).toBeGreaterThanOrEqual(0);
      expect(tick.blockTokens).toBeDefined();
      expect(tick.blockTokens?.inputOther).toBeGreaterThan(0);
      expect(tick.blockTokens?.output).toBeGreaterThan(0);
      expect(tick.blocksCompleted).toBeGreaterThanOrEqual(1);
      expect(tick.blocksCompleted).toBeLessThanOrEqual(blockCalls);
    }

    // Each completion tick carries its own block's usage: the distinct
    // per-block output counters (21, 22, …) must appear exactly once each.
    const outputs = completions
      .map((tick) => tick.blockTokens?.output ?? Number.NaN)
      .sort((a, b) => a - b);
    expect(outputs).toEqual(Array.from({ length: blockCalls }, (_, index) => 21 + index));

    // The live blocksCompleted counter reaches the total block count.
    const completedCounts = completions.map((tick) => tick.blocksCompleted ?? 0);
    expect(Math.max(...completedCounts)).toBe(blockCalls);

    // Merge tick and completion event still fire unchanged.
    expect(progress.some((args) => args.streamKind === 'merge')).toBe(true);
    expect(events).toContainEqual(
      expect.objectContaining({
        event: 'compaction.completed',
        args: expect.objectContaining({
          result: expect.objectContaining({
            parallelBlockCount: blockCalls,
          }),
        }),
      }),
    );
  });
});
