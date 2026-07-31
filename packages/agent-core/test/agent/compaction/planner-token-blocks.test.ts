import { describe, expect, it } from 'vitest';

import {
  CONTEXT_COMPACTION_V2_VERSION,
  splitMessagesIntoTokenBlocks,
} from '#/agent/compaction/planner';
import type { Message } from '@superliora/kosong';

type AnyMessage = Message;

function makeMessage(text: string, toolCalls: AnyMessage['toolCalls'] = []): AnyMessage {
  return {
    role: 'user',
    content: [{ type: 'text', text }],
    toolCalls,
  } as AnyMessage;
}

function makeAssistantWithToolCall(toolCallId: string, text: string): AnyMessage {
  return {
    role: 'assistant',
    content: [{ type: 'text', text }],
    toolCalls: [
      {
        id: toolCallId,
        type: 'function',
        function: { name: 'noop', arguments: '{}' },
        name: 'noop',
      },
    ],
  } as AnyMessage;
}

function makeToolResult(toolCallId: string, text: string): AnyMessage {
  return {
    role: 'tool',
    content: [{ type: 'text', text }],
    toolCallId,
  } as AnyMessage;
}

describe('agent/compaction/planner — splitMessagesIntoTokenBlocks', () => {
  it('returns the v2 version literal', () => {
    expect(CONTEXT_COMPACTION_V2_VERSION).toBe('super_kimi_context_compaction_v2');
  });

  it('returns no blocks for an empty message list', () => {
    expect(splitMessagesIntoTokenBlocks([], 100)).toEqual([]);
  });

  it('keeps a single group under the target in a single block', () => {
    const messages = [makeMessage('short prompt')];
    const blocks = splitMessagesIntoTokenBlocks(messages, 1000);
    expect(blocks).toHaveLength(1);
    expect(blocks[0]).toEqual(messages);
  });

  it('splits messages into multiple blocks when the total exceeds the target', () => {
    const messages = [
      makeMessage('group A first message'),
      makeMessage('group A second message'),
      makeMessage('group B first message'),
      makeMessage('group B second message'),
    ];
    // With a very tight budget each group should land in its own block.
    const blocks = splitMessagesIntoTokenBlocks(messages, 1);
    expect(blocks.length).toBeGreaterThanOrEqual(2);
    // Every block must be non-empty.
    for (const block of blocks) {
      expect(block.length).toBeGreaterThan(0);
    }
    // Concatenation must preserve the original ordering without loss.
    expect(blocks.flat()).toEqual(messages);
  });

  it('keeps a single user-group under the target in a single block', () => {
    const messages = [makeMessage('please run'), makeMessage('thanks')];
    const blocks = splitMessagesIntoTokenBlocks(messages, 10000);
    expect(blocks).toHaveLength(1);
    expect(blocks[0]).toEqual(messages);
  });

  it('always emits a non-empty trailing block for trailing messages', () => {
    const messages = [makeMessage('alpha'), makeMessage('beta'), makeMessage('gamma')];
    const blocks = splitMessagesIntoTokenBlocks(messages, 2);
    expect(blocks.length).toBeGreaterThanOrEqual(2);
    expect(blocks.at(-1)?.length).toBeGreaterThan(0);
  });
});
