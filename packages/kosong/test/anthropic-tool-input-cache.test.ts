/**
 * Anthropic request building converts the whole history on every request, so a
 * recorded tool call's argument JSON was parsed again on every step — on
 * Write/Edit calls those strings are the largest content in the conversation.
 * The parse is memoized per call object, keyed by the argument string itself so
 * a replaced string re-parses instead of going stale.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { Message } from '#/message';
import { convertMessage } from '#/providers/anthropic/anthropic-messages';

function toolCallMessage(args: string): Message {
  return {
    role: 'assistant',
    content: [{ type: 'text', text: 'writing the file' }],
    toolCalls: [{ id: 'call_1', name: 'Write', arguments: args }],
  } as Message;
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('anthropic tool-call argument parsing', () => {
  it('parses a recorded call once across repeated conversions', () => {
    const message = toolCallMessage(JSON.stringify({ path: '/repo/a.ts', content: 'x'.repeat(2000) }));

    const first = convertMessage(message, 'claude-test');
    const parse = vi.spyOn(JSON, 'parse');
    try {
      const second = convertMessage(message, 'claude-test');
      expect(parse).not.toHaveBeenCalled();
      expect(second).toEqual(first);
    } finally {
      parse.mockRestore();
    }
  });

  it('re-parses when the recorded arguments are replaced', () => {
    const message = toolCallMessage(JSON.stringify({ path: '/repo/a.ts' }));
    const first = convertMessage(message, 'claude-test');
    expect(first.content).toContainEqual(
      expect.objectContaining({ type: 'tool_use', input: { path: '/repo/a.ts' } }),
    );

    message.toolCalls[0]!.arguments = JSON.stringify({ path: '/repo/b.ts' });

    expect(convertMessage(message, 'claude-test').content).toContainEqual(
      expect.objectContaining({ type: 'tool_use', input: { path: '/repo/b.ts' } }),
    );
  });
});