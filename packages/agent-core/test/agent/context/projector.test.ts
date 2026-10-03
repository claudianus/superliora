import type { Message } from '@superliora/kosong';
import { describe, expect, it } from 'vitest';

import { trimTrailingOpenToolExchange } from '#/agent/context/projector';

function userMessage(text: string): Message {
  return { role: 'user', content: [{ type: 'text', text }], toolCalls: [] };
}

function assistantWithToolCalls(...ids: string[]): Message {
  return {
    role: 'assistant',
    content: [],
    toolCalls: ids.map((id) => ({
      id,
      type: 'function',
      name: 'Bash',
      arguments: '{"command":"pwd"}',
    })),
  };
}

function toolResult(toolCallId: string, text: string): Message {
  return { role: 'tool', content: [{ type: 'text', text }], toolCallId, toolCalls: [] };
}

describe('trimTrailingOpenToolExchange', () => {
  it('returns no messages when no non-tool turn is available', () => {
    expect(trimTrailingOpenToolExchange([])).toEqual([]);
    expect(trimTrailingOpenToolExchange([toolResult('orphan', 'output')])).toEqual([]);
  });

  it('preserves settled exchanges and returns an independent array', () => {
    const history = [
      userMessage('run both commands'),
      assistantWithToolCalls('one', 'two'),
      toolResult('two', 'second finished first'),
      toolResult('one', 'first finished second'),
    ];
    const trimmed = trimTrailingOpenToolExchange(history);
    expect(trimmed).toEqual(history);
    expect(trimmed).not.toBe(history);
    expect(trimmed[0]).toBe(history[0]);
  });

  it('does not trim a trailing user or assistant text turn', () => {
    const history = [
      userMessage('hello'),
      { role: 'assistant', content: [{ type: 'text', text: 'answer' }], toolCalls: [] } satisfies Message,
    ];
    expect(trimTrailingOpenToolExchange(history)).toEqual(history);
    expect(trimTrailingOpenToolExchange([...history, userMessage('next')])).toEqual([
      ...history,
      userMessage('next'),
    ]);
  });

  it('removes the entire trailing exchange when even one parallel result is missing', () => {
    const settled = [userMessage('first'), assistantWithToolCalls('closed'), toolResult('closed', 'ok')];
    const latestUser = userMessage('run two more');
    const history = [
      ...settled,
      latestUser,
      assistantWithToolCalls('one', 'two'),
      toolResult('two', 'done'),
    ];
    expect(trimTrailingOpenToolExchange(history)).toEqual([...settled, latestUser]);
    expect(history).toHaveLength(6);
  });

  it('does not treat an unrelated result as closing the pending call', () => {
    const user = userMessage('run command');
    expect(
      trimTrailingOpenToolExchange([user, assistantWithToolCalls('pending'), toolResult('other', 'ok')]),
    ).toEqual([user]);
  });
});
