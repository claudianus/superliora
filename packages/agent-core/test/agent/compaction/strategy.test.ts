
import type { Message } from '@superliora/kosong';
import { describe, expect, it } from 'vitest';

import {
  DEFAULT_COMPACTION_CONFIG,
  DefaultCompactionStrategy,
  PipelineStrategy,
  ToolCollapseStrategy,
  resolveCompactionBlockRatio,
  splitMessagesIntoTokenBlocks,
} from '../../../src/agent/compaction';
import { CompactionQualityTracker } from '../../../src/agent/compaction/quality';
import { estimateTokensForMessages } from '../../../src/utils/tokens';
import {
  handoffThresholdTokens,
  relaxObservedMaxContextTokens,
  resolveEffectiveMaxContextTokens,
  shouldDeferAutoCompaction,
  shouldRecoverFromOverflowStatus,
  shouldSkipRecompactUntilGrowth,
  shouldUseParallelSummarize,
} from '../../../src/agent/compaction/full-policy';

describe('DefaultCompactionStrategy', () => {
  it('keeps an oversized trailing user message as recent', () => {
    const strategy = testCompactionStrategy();
    const messages = [
      textMessage('user', 'old user'),
      textMessage('assistant', 'old assistant'),
      textMessage('user', `pending user ${'x'.repeat(1_200)}`),
    ];

    expect(strategy.computeCompactCount(messages, 'auto')).toBe(2);
  });

  it('keeps consecutive trailing user messages as recent', () => {
    const strategy = testCompactionStrategy();
    const messages = [
      textMessage('user', 'old user'),
      textMessage('assistant', 'old assistant'),
      textMessage('user', `pending user one ${'x'.repeat(1_200)}`),
      textMessage('user', `pending user two ${'x'.repeat(1_200)}`),
    ];

    expect(strategy.computeCompactCount(messages, 'auto')).toBe(2);
  });

  it('compacts the prefix when the trailing exchange itself is oversized', () => {
    const strategy = testCompactionStrategy();
    const messages = [
      textMessage('user', 'old user'),
      textMessage('assistant', 'old assistant'),
      textMessage('user', 'recent user'),
      textMessage('assistant', `recent assistant ${'x'.repeat(1_200)}`),
    ];

    expect(strategy.computeCompactCount(messages, 'auto')).toBe(2);
  });

  it('returns 0 when there is nothing to compact', () => {
    const strategy = testCompactionStrategy();
    expect(strategy.computeCompactCount([], 'auto')).toBe(0);
    expect(strategy.computeCompactCount([textMessage('user', 'only pending')], 'auto')).toBe(0);
    expect(
      strategy.computeCompactCount(
        [
          textMessage('user', 'a'),
          textMessage('user', 'b'),
          textMessage('user', 'c'),
        ],
        'auto',
      ),
    ).toBe(0);
  });

  it('returns 0 when no intermediate split exists and the last message is also unsplittable', () => {
    const strategy = testCompactionStrategy();
    const messages: Message[] = [
      textMessage('user', 'inspect'),
      {
        role: 'assistant',
        content: [],
        toolCalls: [{ type: 'function', id: 'call_a', name: 'Lookup', arguments: '{}' }],
      },
    ];

    expect(strategy.computeCompactCount(messages, 'auto')).toBe(0);
  });

  it('does not split inside a parallel tool exchange', () => {
    const strategy = testCompactionStrategy();
    const messages: Message[] = [
      textMessage('user', 'old user'),
      textMessage('assistant', 'old assistant'),
      textMessage('user', 'run both tools'),
      {
        role: 'assistant',
        content: [],
        toolCalls: [
          { type: 'function', id: 'call_a', name: 'Lookup', arguments: '{}' },
          { type: 'function', id: 'call_b', name: 'Lookup', arguments: '{}' },
        ],
      },
      { role: 'tool', content: [{ type: 'text', text: 'a' }], toolCalls: [], toolCallId: 'call_a' },
      { role: 'tool', content: [{ type: 'text', text: 'b' }], toolCalls: [], toolCallId: 'call_b' },
      textMessage('user', 'next prompt'),
    ];

    // The only valid split is before the parallel exchange (after 'old assistant'),
    // never between tool_a and tool_b — that would leave tool_b as an orphan.
    expect(strategy.computeCompactCount(messages, 'auto')).toBe(2);
  });

  it('splits v2 parallel summary blocks only at tool-call group boundaries', () => {
    const messages: Message[] = [
      textMessage('user', 'old user'),
      {
        role: 'assistant',
        content: [],
        toolCalls: [
          { type: 'function', id: 'call_a', name: 'Lookup', arguments: '{}' },
          { type: 'function', id: 'call_b', name: 'Lookup', arguments: '{}' },
        ],
      },
      { role: 'tool', content: [{ type: 'text', text: 'a'.repeat(2_000) }], toolCalls: [], toolCallId: 'call_a' },
      { role: 'tool', content: [{ type: 'text', text: 'b'.repeat(2_000) }], toolCalls: [], toolCallId: 'call_b' },
      textMessage('user', 'next prompt'),
    ];

    const blocks = splitMessagesIntoTokenBlocks(messages, 10);
    const toolBlock = blocks.find((block) => block.some((message) => message.role === 'tool'));

    expect(toolBlock?.map((message) => message.role)).toEqual(['assistant', 'tool', 'tool']);
  });

  it('shrinks auto compaction input to fit the model window', () => {
    const maxSize = 1_000;
    const strategy = testCompactionStrategy(maxSize);
    const messages = Array.from({ length: 30 }, (_, i) =>
      textMessage('assistant', `message ${i} ${'x'.repeat(400)}`),
    );

    const count = strategy.computeCompactCount(messages, 'auto');

    expect(count).toBeGreaterThan(0);
    expect(count).toBeLessThan(messages.length);
    expect(estimateTokensForMessages(messages.slice(0, count))).toBeLessThanOrEqual(maxSize);
    expect(estimateTokensForMessages(messages.slice(0, count + 1))).toBeGreaterThan(maxSize);
  });

  it('shrinks manual compaction input to fit the model window', () => {
    const maxSize = 1_000;
    const strategy = testCompactionStrategy(maxSize);
    const messages = Array.from({ length: 30 }, (_, i) =>
      textMessage('assistant', `message ${i} ${'x'.repeat(400)}`),
    );

    const count = strategy.computeCompactCount(messages, 'manual');

    expect(count).toBeGreaterThan(0);
    expect(count).toBeLessThan(messages.length);
    expect(estimateTokensForMessages(messages.slice(0, count))).toBeLessThanOrEqual(maxSize);
    expect(estimateTokensForMessages(messages.slice(0, count + 1))).toBeGreaterThan(maxSize);
  });

  it('reserves response context for blocking but not for the soft trigger', () => {
    const strategy = new DefaultCompactionStrategy(() => 256_000);

    expect(strategy.shouldCompact(210_000)).toBe(true);
    expect(strategy.shouldBlock(210_000)).toBe(true);
  });

  it('uses reserved context only for hard blocking on smaller windows', () => {
    const strategy = new DefaultCompactionStrategy(() => 100_000, {
      ...DEFAULT_COMPACTION_CONFIG,
      // Keep hard ratio above the reserved threshold so this fixture isolates
      // reserved-size blocking after densify ladders.
      blockRatio: 0.90,
      reservedContextSize: 50_000,
    });

    expect(strategy.shouldCompact(1_099)).toBe(false);
    // reserved 50k + hard90 → max(50k, floor(100k*0.90)=90k) = 90k
    expect(strategy.shouldBlock(49_999)).toBe(false);
    expect(strategy.shouldCompact(81_000)).toBe(true);
    expect(strategy.shouldBlock(90_000)).toBe(true);
  });

  it('starts async compaction between the async threshold and soft trigger', () => {
    const strategy = new DefaultCompactionStrategy(() => 100_000);

    // asyncTriggerRatio=0.01 → 1k; soft trigger=0.011 → 1.1k
    expect(strategy.shouldAsyncCompact(999)).toBe(false);
    expect(strategy.shouldAsyncCompact(1_000)).toBe(true);
    expect(strategy.shouldCompact(1_000)).toBe(false);
    // Once the soft trigger fires, async path yields to blocking compact.
    expect(strategy.shouldAsyncCompact(80_000)).toBe(false);
    expect(strategy.shouldCompact(80_000)).toBe(true);
  });

  it('ignores reserved context when the reserve is not smaller than the model window', () => {
    const strategy = new DefaultCompactionStrategy(() => 32_000, {
      ...DEFAULT_COMPACTION_CONFIG,
      triggerRatio: 0.85,
      blockRatio: 0.85,
      reservedContextSize: 50_000,
    });

    expect(strategy.shouldCompact(1)).toBe(false);
    expect(strategy.shouldBlock(1)).toBe(false);
    // trigger/block 0.85 on 32k → 27_200
    expect(strategy.shouldCompact(27_199)).toBe(false);
    expect(strategy.shouldCompact(27_200)).toBe(true);
    expect(strategy.shouldBlock(27_200)).toBe(true);
  });

  it('triggers at absolute token threshold for large-context models', () => {
    const strategy = new DefaultCompactionStrategy(() => 500_000, {
      ...DEFAULT_COMPACTION_CONFIG,
      triggerRatio: 0.4,
      blockRatio: 0.92,
      reservedContextSize: 50_000,
      maxRecentMessages: 3,
      absoluteTriggerTokens: 251_000,
    });

    expect(strategy.shouldCompact(250_999)).toBe(false);
    expect(strategy.shouldBlock(250_999)).toBe(false);

    expect(strategy.shouldCompact(251_000)).toBe(true);
    expect(strategy.shouldBlock(251_000)).toBe(true);
  });

  it('defers to the ratio floor when absolute threshold is below it on large windows', () => {
    const strategy = new DefaultCompactionStrategy(() => 1_000_000, {
      ...DEFAULT_COMPACTION_CONFIG,
      triggerRatio: 0.85,
      blockRatio: 0.92,
      reservedContextSize: 50_000,
      maxRecentMessages: 3,
      absoluteTriggerTokens: 200_000,
    });

    expect(strategy.shouldCompact(849_999)).toBe(false);
    expect(strategy.shouldCompact(850_000)).toBe(true);
  });

  it('treats the absolute threshold as a soft trigger when v2 separates hard blocking', () => {
    const strategy = new DefaultCompactionStrategy(() => 1_000_000, {
      ...DEFAULT_COMPACTION_CONFIG,
      triggerRatio: 0.85,
      blockRatio: 0.92,
      reservedContextSize: 50_000,
      maxRecentMessages: 3,
      absoluteTriggerTokens: 200_000,
      absoluteTriggerBlocks: false,
    });

    expect(strategy.shouldCompact(849_999)).toBe(false);
    expect(strategy.shouldCompact(850_000)).toBe(true);
    expect(strategy.shouldBlock(850_000)).toBe(false);
    expect(strategy.shouldBlock(920_000)).toBe(true);
  });

  it('falls back to ratio trigger when the model window is below the large-context threshold', () => {
    const strategy = new DefaultCompactionStrategy(() => 240_000, {
      ...DEFAULT_COMPACTION_CONFIG,
      triggerRatio: 0.85,
      blockRatio: 0.85,
      reservedContextSize: 0,
      maxRecentMessages: 3,
      absoluteTriggerTokens: 200_000,
    });

    expect(strategy.shouldCompact(200_000)).toBe(false);
    expect(strategy.shouldCompact(204_000)).toBe(true);
  });

  it('uses decoupled default trigger and block ratios', () => {
    const strategy = new DefaultCompactionStrategy(() => 100_000, {
      ...DEFAULT_COMPACTION_CONFIG,
      reservedContextSize: 0,
    });
    expect(strategy.effectiveTriggerRatio).toBe(0.011);
    expect(strategy.shouldCompact(1_099)).toBe(false);
    expect(strategy.shouldCompact(1_100)).toBe(true);
    expect(strategy.shouldBlock(38_999)).toBe(false);
    expect(strategy.shouldBlock(39_000)).toBe(true);
    expect(strategy.checkAfterStep).toBe(true);
  });

  it('resolves block ratio above trigger when only trigger is configured', () => {
    expect(resolveCompactionBlockRatio(0.7)).toBe(0.75);
    expect(resolveCompactionBlockRatio(0.9)).toBeCloseTo(0.95);
    expect(resolveCompactionBlockRatio(0.8, 0.88)).toBe(0.88);
  });

  it('speculatively compacts only when projected usage crosses the soft trigger', () => {
    const strategy = new DefaultCompactionStrategy(() => 100_000, {
      ...DEFAULT_COMPACTION_CONFIG,
      reservedContextSize: 0,
    });
    expect(strategy.shouldSpeculativelyCompact(1_099)).toBe(false);
    expect(strategy.shouldSpeculativelyCompact(1_100)).toBe(true);

    const lateTrigger = new DefaultCompactionStrategy(() => 100_000, {
      ...DEFAULT_COMPACTION_CONFIG,
      triggerRatio: 0.95,
      blockRatio: 0.92,
      reservedContextSize: 0,
      absoluteTriggerTokens: 0,
    });
    expect(lateTrigger.shouldCompact(93_000)).toBe(false);
    expect(lateTrigger.shouldSpeculativelyCompact(93_000)).toBe(false);
  });

  it('tightens the trigger threshold only after emergency backstop compactions', () => {
    const strategy = new DefaultCompactionStrategy(() => 100_000, {
      ...DEFAULT_COMPACTION_CONFIG,
      reservedContextSize: 0,
    });
    strategy.applyQualityFeedback({ recallEvalScore: 0.5, usedEmergencyBackstop: false });
    expect(strategy.effectiveTriggerRatio).toBe(0.011);
    strategy.applyQualityFeedback({ usedEmergencyBackstop: true });
    expect(strategy.effectiveTriggerRatio).toBeLessThan(0.011);
    expect(strategy.shouldCompact(73_000)).toBe(true);
  });
});

describe('CompactionQualityTracker', () => {
  it('tracks rolling averages and low-quality streaks', () => {
    const tracker = new CompactionQualityTracker();
    tracker.record({ recallEvalScore: 0.9, usedEmergencyBackstop: false });
    const afterLow = tracker.record({ recallEvalScore: 0.4, usedEmergencyBackstop: false });
    expect(afterLow.sampleCount).toBe(2);
    expect(afterLow.rollingAverage).toBe(0.65);
    expect(afterLow.lowQualityStreak).toBe(1);
    const afterBackstop = tracker.record({ usedEmergencyBackstop: true });
    expect(afterBackstop.emergencyBackstopCount).toBe(1);
    expect(afterBackstop.lowQualityStreak).toBe(2);
  });
});

function testCompactionStrategy(maxSize: number = 1_000): DefaultCompactionStrategy {
  return new DefaultCompactionStrategy(() => maxSize, {
    ...DEFAULT_COMPACTION_CONFIG,
    reservedContextSize: 0,
    maxRecentMessages: 10,
  });
}

function overflowOnlyCompactionStrategy(maxSize: number = 14): DefaultCompactionStrategy {
  return new DefaultCompactionStrategy(() => maxSize, {
    ...DEFAULT_COMPACTION_CONFIG,
    triggerRatio: Infinity,
    blockRatio: Infinity,
    reservedContextSize: 0,
    maxRecentMessages: 3,
    absoluteTriggerTokens: 200_000,
  });
}

function textMessage(role: 'user' | 'assistant', text: string): Message {
  return {
    role,
    content: [{ type: 'text', text }],
    toolCalls: [],
  };
}

describe('ToolCollapseStrategy', () => {
  it('defaults to keeping the last two tool-call groups', () => {
    const strategy = new ToolCollapseStrategy();
    // Construct history: 3 tool exchanges (user/asst+tool) so collapse can fire.
    const messages = [
      { role: 'user' as const, content: [{ type: 'text' as const, text: 'u0' }], toolCalls: [] },
      { role: 'assistant' as const, content: [{ type: 'text' as const, text: 'a0' }], toolCalls: [{ id: 'c0', name: 'Read', arguments: '{}' }] },
      { role: 'tool' as const, content: [{ type: 'text' as const, text: 'r0' }], toolCallId: 'c0', toolCalls: [] },
      { role: 'assistant' as const, content: [{ type: 'text' as const, text: 'a1' }], toolCalls: [{ id: 'c1', name: 'Read', arguments: '{}' }] },
      { role: 'tool' as const, content: [{ type: 'text' as const, text: 'r1' }], toolCallId: 'c1', toolCalls: [] },
      { role: 'assistant' as const, content: [{ type: 'text' as const, text: 'a2' }], toolCalls: [{ id: 'c2', name: 'Read', arguments: '{}' }] },
      { role: 'tool' as const, content: [{ type: 'text' as const, text: 'r2' }], toolCallId: 'c2', toolCalls: [] },
    ];
    // With keep=2, the oldest exchange is collapsible → compact count ends after first tool group.
    const count = strategy.computeCompactCount(messages as never, 'auto');
    expect(count).toBeGreaterThan(0);
    // keep=1 would collapse more aggressively (higher compact count or same).
    const aggressive = new ToolCollapseStrategy(1).computeCompactCount(messages as never, 'auto');
    expect(aggressive).toBeGreaterThanOrEqual(count);
  });
});

describe('PipelineStrategy', () => {
  it('treats secondary computeCompactCount 0 as no constraint', () => {
    const trigger = new DefaultCompactionStrategy(() => 100_000, {
      ...DEFAULT_COMPACTION_CONFIG,
      reservedContextSize: 0,
      maxRecentMessages: 2,
    });
    const pipeline = new PipelineStrategy([new ToolCollapseStrategy(2)], trigger);
    const messages = [
      textMessage('user', 'u0'),
      textMessage('assistant', 'a0'),
      textMessage('user', 'u1'),
      textMessage('assistant', 'a1'),
      textMessage('user', 'u2'),
    ];
    const base = trigger.computeCompactCount(messages, 'auto');
    const piped = pipeline.computeCompactCount(messages, 'auto');
    expect(piped).toBe(base);
    expect(piped).toBeGreaterThan(0);
  });

  it('can tighten compact count when ToolCollapse finds older tool groups', () => {
    const trigger = new DefaultCompactionStrategy(() => 100_000, {
      ...DEFAULT_COMPACTION_CONFIG,
      reservedContextSize: 0,
      maxRecentMessages: 20,
    });
    const pipeline = new PipelineStrategy([new ToolCollapseStrategy(2)], trigger);
    const messages = [
      { role: 'user' as const, content: [{ type: 'text' as const, text: 'u0' }], toolCalls: [] },
      { role: 'assistant' as const, content: [{ type: 'text' as const, text: 'a0' }], toolCalls: [{ id: 'c0', name: 'Read', arguments: '{}' }] },
      { role: 'tool' as const, content: [{ type: 'text' as const, text: 'r0' }], toolCallId: 'c0', toolCalls: [] },
      { role: 'assistant' as const, content: [{ type: 'text' as const, text: 'a1' }], toolCalls: [{ id: 'c1', name: 'Read', arguments: '{}' }] },
      { role: 'tool' as const, content: [{ type: 'text' as const, text: 'r1' }], toolCallId: 'c1', toolCalls: [] },
      { role: 'assistant' as const, content: [{ type: 'text' as const, text: 'a2' }], toolCalls: [{ id: 'c2', name: 'Read', arguments: '{}' }] },
      { role: 'tool' as const, content: [{ type: 'text' as const, text: 'r2' }], toolCallId: 'c2', toolCalls: [] },
      textMessage('user', 'recent'),
    ] as Message[];
    const base = trigger.computeCompactCount(messages, 'auto');
    const collapse = new ToolCollapseStrategy(2).computeCompactCount(messages, 'auto');
    const piped = pipeline.computeCompactCount(messages, 'auto');
    expect(collapse).toBeGreaterThan(0);
    expect(piped).toBe(Math.min(base, collapse));
  });
});

describe('PipelineStrategy quality controls', () => {
  it('forwards applyQualityFeedback to the DefaultCompactionStrategy trigger', () => {
    const trigger = new DefaultCompactionStrategy(() => 100_000, {
      ...DEFAULT_COMPACTION_CONFIG,
      reservedContextSize: 0,
    });
    const pipeline = new PipelineStrategy([new ToolCollapseStrategy(2)], trigger);
    const before = trigger.effectiveTriggerRatio;
    expect(before).toBe(0.011);
    const bias = pipeline.applyQualityFeedback({ usedEmergencyBackstop: true });
    expect(bias).toBeGreaterThan(0);
    expect(trigger.effectiveTriggerRatio).toBeLessThan(before);
    expect(pipeline.speculativeStepBufferTokens).toBe(trigger.speculativeStepBufferTokens);
  });
});


describe('full compaction pure policy', () => {
  it('shouldSkipRecompactUntilGrowth requires min growth after a compact', () => {
    expect(
      shouldSkipRecompactUntilGrowth({
        lastCompactedTokenCount: null,
        tokenCountWithPending: 1000,
        minGrowthRatio: 0.05,
        maxContextTokens: 10_000,
      }),
    ).toBe(false);

    expect(
      shouldSkipRecompactUntilGrowth({
        lastCompactedTokenCount: 1000,
        tokenCountWithPending: 1000,
        minGrowthRatio: 0.05,
        maxContextTokens: 10_000,
      }),
    ).toBe(true);

    expect(
      shouldSkipRecompactUntilGrowth({
        lastCompactedTokenCount: 1000,
        tokenCountWithPending: 1200,
        minGrowthRatio: 0.05,
        maxContextTokens: 10_000,
      }),
    ).toBe(true);

    expect(
      shouldSkipRecompactUntilGrowth({
        lastCompactedTokenCount: 1000,
        tokenCountWithPending: 1600,
        minGrowthRatio: 0.05,
        maxContextTokens: 10_000,
      }),
    ).toBe(false);
  });

  it('shouldDeferAutoCompaction defers under swarm unless blocked', () => {
    expect(
      shouldDeferAutoCompaction({
        ultraSwarmActive: true,
        shouldBlock: false,
        hasActiveForegroundChildren: false,
      }),
    ).toBe(true);
    expect(
      shouldDeferAutoCompaction({
        ultraSwarmActive: true,
        shouldBlock: true,
        hasActiveForegroundChildren: false,
      }),
    ).toBe(false);
    expect(
      shouldDeferAutoCompaction({
        ultraSwarmActive: false,
        shouldBlock: false,
        hasActiveForegroundChildren: true,
      }),
    ).toBe(true);
  });

  it('handoffThresholdTokens and relaxObservedMaxContextTokens are pure', () => {
    expect(handoffThresholdTokens({ maxTokens: undefined, triggerRatio: 0.72 })).toBeUndefined();
    expect(handoffThresholdTokens({ maxTokens: 1000, triggerRatio: 0.72 })).toBe(720);
    expect(
      relaxObservedMaxContextTokens({
        observed: 1000,
        configured: 2000,
        decayPerTurn: 0.25,
      }),
    ).toBe(1250);
    expect(
      relaxObservedMaxContextTokens({
        observed: 2000,
        configured: 2000,
        decayPerTurn: 0.25,
      }),
    ).toBe(2000);
  });

  it('resolveEffectiveMaxContextTokens and overflow recovery thresholds', () => {
    expect(resolveEffectiveMaxContextTokens({ configured: 1000, observed: undefined })).toBe(1000);
    expect(resolveEffectiveMaxContextTokens({ configured: 1000, observed: 800 })).toBe(800);
    expect(resolveEffectiveMaxContextTokens({ configured: 0, observed: 800 })).toBe(800);
    expect(
      shouldRecoverFromOverflowStatus({
        isContextOverflowError: true,
        isStatus413: false,
        estimatedRequestTokens: 1,
        maxContextTokens: 1000,
        recoveryRatio: 0.9,
      }),
    ).toBe(true);
    expect(
      shouldRecoverFromOverflowStatus({
        isContextOverflowError: false,
        isStatus413: true,
        estimatedRequestTokens: 950,
        maxContextTokens: 1000,
        recoveryRatio: 0.9,
      }),
    ).toBe(true);
    expect(
      shouldRecoverFromOverflowStatus({
        isContextOverflowError: false,
        isStatus413: true,
        estimatedRequestTokens: 100,
        maxContextTokens: 1000,
        recoveryRatio: 0.9,
      }),
    ).toBe(false);
  });

  it('shouldUseParallelSummarize chooses parallel only for large prefixes', () => {
    expect(
      shouldUseParallelSummarize({
        compactedTokens: 100,
        messageCount: 10,
        parallelThreshold: 1000,
      }),
    ).toBe(false);
    expect(
      shouldUseParallelSummarize({
        compactedTokens: 5000,
        messageCount: 2,
        parallelThreshold: 1000,
      }),
    ).toBe(false);
    expect(
      shouldUseParallelSummarize({
        compactedTokens: 5000,
        messageCount: 8,
        parallelThreshold: 1000,
      }),
    ).toBe(true);
  });
});
