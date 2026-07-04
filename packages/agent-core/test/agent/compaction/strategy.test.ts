
import type { Message } from '@superliora/kosong';
import { describe, expect, it } from 'vitest';

import { DefaultCompactionStrategy, splitMessagesIntoTokenBlocks } from '../../../src/agent/compaction';
import { estimateTokensForMessages } from '../../../src/utils/tokens';

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

  it('reserves response context by default before the ratio threshold is reached', () => {
    const strategy = new DefaultCompactionStrategy(() => 256_000);

    expect(strategy.shouldCompact(210_000)).toBe(true);
    expect(strategy.shouldBlock(210_000)).toBe(true);
  });

  it('ignores reserved context when the reserve is not smaller than the model window', () => {
    const strategy = new DefaultCompactionStrategy(() => 32_000, {
      triggerRatio: 0.85,
      blockRatio: 0.85,
      reservedContextSize: 50_000,
      maxCompactionPerTurn: 3,
      maxOverflowCompactionAttempts: 3,
      maxRecentMessages: 3,
      maxRecentUserMessages: Infinity,
      maxRecentSizeRatio: 0.2,
      minOverflowReductionRatio: 0.05,
      absoluteTriggerTokens: 200_000,
      parallelBlockThreshold: 30_000,
      parallelBlockTarget: 15_000,
    });

    expect(strategy.shouldCompact(1)).toBe(false);
    expect(strategy.shouldBlock(1)).toBe(false);
    expect(strategy.shouldCompact(28_000)).toBe(true);
    expect(strategy.shouldBlock(28_000)).toBe(true);
  });

  it('triggers at absolute token threshold for large-context models', () => {
    const strategy = new DefaultCompactionStrategy(() => 1_000_000, {
      triggerRatio: 0.85,
      blockRatio: 0.85,
      reservedContextSize: 50_000,
      maxCompactionPerTurn: 3,
      maxOverflowCompactionAttempts: 3,
      maxRecentMessages: 3,
      maxRecentUserMessages: Infinity,
      maxRecentSizeRatio: 0.2,
      minOverflowReductionRatio: 0.05,
      absoluteTriggerTokens: 200_000,
      parallelBlockThreshold: 30_000,
      parallelBlockTarget: 15_000,
    });

    expect(strategy.shouldCompact(199_000)).toBe(false);
    expect(strategy.shouldBlock(199_000)).toBe(false);

    expect(strategy.shouldCompact(200_000)).toBe(true);
    expect(strategy.shouldBlock(200_000)).toBe(true);
  });

  it('treats the absolute threshold as a soft trigger when v2 separates hard blocking', () => {
    const strategy = new DefaultCompactionStrategy(() => 1_000_000, {
      triggerRatio: 0.85,
      blockRatio: 0.85,
      reservedContextSize: 50_000,
      maxCompactionPerTurn: 3,
      maxOverflowCompactionAttempts: 3,
      maxRecentMessages: 3,
      maxRecentUserMessages: Infinity,
      maxRecentSizeRatio: 0.2,
      minOverflowReductionRatio: 0.05,
      absoluteTriggerTokens: 200_000,
      parallelBlockThreshold: 30_000,
      parallelBlockTarget: 15_000,
      absoluteTriggerBlocks: false,
    });

    expect(strategy.shouldCompact(199_999)).toBe(false);
    expect(strategy.shouldCompact(200_000)).toBe(true);
    expect(strategy.shouldBlock(200_000)).toBe(false);
    expect(strategy.shouldBlock(850_000)).toBe(true);
  });

  it('falls back to ratio trigger when the model window is below the large-context threshold', () => {
    const strategy = new DefaultCompactionStrategy(() => 240_000, {
      triggerRatio: 0.85,
      blockRatio: 0.85,
      reservedContextSize: 0,
      maxCompactionPerTurn: 3,
      maxOverflowCompactionAttempts: 3,
      maxRecentMessages: 3,
      maxRecentUserMessages: Infinity,
      maxRecentSizeRatio: 0.2,
      minOverflowReductionRatio: 0.05,
      absoluteTriggerTokens: 200_000,
      parallelBlockThreshold: 30_000,
      parallelBlockTarget: 15_000,
    });

    expect(strategy.shouldCompact(200_000)).toBe(false);
    expect(strategy.shouldCompact(204_000)).toBe(true);
  });
});

function testCompactionStrategy(maxSize: number = 1_000): DefaultCompactionStrategy {
  return new DefaultCompactionStrategy(() => maxSize, {
    triggerRatio: 0.85,
    blockRatio: 0.85,
    reservedContextSize: 0,
    maxCompactionPerTurn: 3,
    maxOverflowCompactionAttempts: 3,
    maxRecentMessages: 10,
    maxRecentUserMessages: Infinity,
    maxRecentSizeRatio: 0.2,
    minOverflowReductionRatio: 0.05,
    absoluteTriggerTokens: 200_000,
    parallelBlockThreshold: 30_000,
    parallelBlockTarget: 15_000,
  });
}

function overflowOnlyCompactionStrategy(maxSize: number = 14): DefaultCompactionStrategy {
  return new DefaultCompactionStrategy(() => maxSize, {
    triggerRatio: Infinity,
    blockRatio: Infinity,
    reservedContextSize: 0,
    maxCompactionPerTurn: 3,
    maxOverflowCompactionAttempts: 3,
    maxRecentMessages: 3,
    maxRecentUserMessages: Infinity,
    maxRecentSizeRatio: 0.2,
    minOverflowReductionRatio: 0.05,
    absoluteTriggerTokens: 200_000,
    parallelBlockThreshold: 30_000,
    parallelBlockTarget: 15_000,
  });
}

function textMessage(role: 'user' | 'assistant', text: string): Message {
  return {
    role,
    content: [{ type: 'text', text }],
    toolCalls: [],
  };
}
