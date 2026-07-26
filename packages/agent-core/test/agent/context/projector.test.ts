import { describe, expect, it } from 'vitest';

import { trimTrailingOpenToolExchange } from '#/agent/context/projector';
import type { Message } from '@superliora/kosong';

type AnyMessage = Message;

function userMessage(text: string): AnyMessage {
  return { role: 'user', content: [{ type: 'text', text }] } as AnyMessage;
}

function assistantWithToolCall(toolCallId: string, id: string): AnyMessage {
  return {
    role: 'assistant',
    content: [],
    toolCalls: [
      {
        id,
        type: 'function',
        function: { name: 'noop', arguments: '{}' },
      },
    ],
  } as AnyMessage;
}

function toolResult(toolCallId: string, text: string): AnyMessage {
  return {
    role: 'tool',
    content: [{ type: 'text', text }],
    toolCallId,
  } as AnyMessage;
}

describe('agent/context/projector — trimTrailingOpenToolExchange', () => {
  it('returns an empty array for an empty history', () => {
    expect(trimTrailingOpenToolExchange([])).toEqual([]);
  });

  it('returns an empty array when history contains only tool messages', () => {
    expect(trimTrailingOpenToolExchange([toolResult('a', 'r1')])).toEqual([]);
  });

  it('returns a copy of the history when the tail is a user message', () => {
    const history = [assistantWithToolCall('a', '1'), toolResult('a', 'r'), userMessage('hi')];
    const trimmed = trimTrailingOpenToolExchange(history);
    expect(trimmed).toEqual(history);
  });

  it('returns a copy of the history when the assistant has no tool calls', () => {
    const history = [
      { role: 'assistant', content: [{ type: 'text', text: 'just text' }], toolCalls: [] } as AnyMessage,
    ];
    const trimmed = trimTrailingOpenToolExchange(history);
    expect(trimmed).toEqual(history);
  });

  it('returns a copy of the history when the trailing assistant tool calls are all closed', () => {
    const history = [
      userMessage('hi'),
      assistantWithToolCall('a', 'a'),
      toolResult('a', 'result'),
    ];
    const trimmed = trimTrailingOpenToolExchange(history);
    expect(trimmed).toEqual(history);
  });

  it('trims the trailing assistant + open tool results back to the last user turn', () => {
    const user = userMessage('hi');
    const assistant = assistantWithToolCall('a', '1');
    const open = toolResult('a', 'partial');
    const history = [user, assistant, open];
    const trimmed = trimTrailingOpenToolExchange(history);
    expect(trimmed).toEqual([user]);
  });

  it('trims only when at least one tool call id is missing from the trailing tool results', () => {
    const user = userMessage('hi');
    const assistant = {
      role: 'assistant',
      content: [],
      toolCalls: [
        { id: '1', type: 'function', function: { name: 'a', arguments: '{}' } },
        { id: '2', type: 'function', function: { name: 'b', arguments: '{}' } },
      ],
    } as AnyMessage;
    const onlyOneClosed = toolResult('1', 'r1');
    const history = [user, assistant, onlyOneClosed];
    const trimmed = trimTrailingOpenToolExchange(history);
    expect(trimmed).toEqual([user]);
  });
});
