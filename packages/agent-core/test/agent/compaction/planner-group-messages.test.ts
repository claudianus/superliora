import { describe, expect, it } from 'vitest';

import { groupMessages } from '#/agent/compaction/planner';
import type { Message } from '@superliora/kosong';

const text = (s: string): Message => ({
  role: 'assistant',
  content: [{ type: 'text', text: s }],
  toolCalls: [],
} as unknown as Message);

const toolCall = (id: string, name: string, args: string): Message => ({
  role: 'assistant',
  content: [],
  toolCalls: [{ id, name, arguments: args }],
} as unknown as Message);

const toolResult = (id: string, output: string): Message => ({
  role: 'tool',
  content: [{ type: 'text', text: output }],
  toolCallId: id,
  toolCalls: [],
} as unknown as Message);

const user = (s: string): Message => ({
  role: 'user',
  content: s,
  toolCalls: [],
} as unknown as Message);

const system = (s: string): Message => ({
  role: 'system',
  content: s,
  toolCalls: [],
} as unknown as Message);

describe('compaction/planner — groupMessages', () => {
  it('returns no groups for an empty message list', () => {
    expect(groupMessages([])).toEqual([]);
  });

  it('groups consecutive system messages into a single "system" group', () => {
    const out = groupMessages([system('a'), system('b'), system('c')]);
    expect(out).toHaveLength(1);
    expect(out[0]!.kind).toBe('system');
    expect(out[0]!.start).toBe(0);
    expect(out[0]!.end).toBe(2);
  });

  it('splits system groups when interrupted by a non-system role', () => {
    const out = groupMessages([system('a'), user('hi'), system('b')]);
    expect(out).toHaveLength(3);
    expect(out.map((g) => g.kind)).toEqual(['system', 'user', 'system']);
  });

  it('groups an assistant tool call with its matching tool results into one "tool_exchange"', () => {
    const out = groupMessages([
      toolCall('t1', 'read', '{"path":"x.ts"}'),
      toolResult('t1', 'file contents'),
      toolResult('t1', 'more'),
    ]);
    expect(out).toHaveLength(1);
    expect(out[0]!.kind).toBe('tool_exchange');
    expect(out[0]!.toolCallIds).toEqual(['t1']);
    expect(out[0]!.toolNames).toEqual(['read']);
  });

  it('does not consume tool results whose toolCallId does not match the assistant tool call', () => {
    const out = groupMessages([
      toolCall('t1', 'read', '{}'),
      toolResult('t2', 'different id'),
    ]);
    // tool_exchange (assistant only) + tool_result (unmatched)
    expect(out).toHaveLength(2);
    expect(out[0]!.kind).toBe('tool_exchange');
    expect(out[0]!.end).toBe(0);
    expect(out[1]!.kind).toBe('tool_result');
  });

  it('emits a standalone "tool_result" group for a tool message without a prior assistant', () => {
    const out = groupMessages([toolResult('t1', 'orphan')]);
    expect(out).toHaveLength(1);
    expect(out[0]!.kind).toBe('tool_result');
  });

  it('emits a single-message "user" or "assistant" group for plain messages', () => {
    const out = groupMessages([user('hi'), text('reply')]);
    expect(out).toHaveLength(2);
    expect(out[0]!.kind).toBe('user');
    expect(out[1]!.kind).toBe('assistant');
  });

  it('preserves start/end indices and the message slice', () => {
    const messages = [user('hi'), toolCall('t1', 'read', '{}'), toolResult('t1', 'ok'), text('done')];
    const out = groupMessages(messages);
    expect(out).toHaveLength(3);
    expect(out[0]!.start).toBe(0);
    expect(out[0]!.end).toBe(0);
    expect(out[1]!.start).toBe(1);
    expect(out[1]!.end).toBe(2);
    expect(out[2]!.start).toBe(3);
    expect(out[2]!.end).toBe(3);
    expect(out[1]!.messages).toHaveLength(2);
  });
});
