import type { Message } from '@superliora/kosong';
import { describe, expect, it } from 'vitest';

import { renderMessagesToText } from '../../../src/agent/compaction/render-messages';

function textMessage(role: Message['role'], text: string): Message {
  return {
    role,
    content: [{ type: 'text', text }],
    toolCalls: [],
  };
}

describe('render-messages.ts — renderMessagesToText', () => {
  it('joins multiple messages with a blank line', () => {
    const out = renderMessagesToText([textMessage('user', 'hi'), textMessage('assistant', 'hello')]);
    expect(out).toContain('--- message 1 role=user ---');
    expect(out).toContain('--- message 2 role=assistant ---');
    expect(out.split('\n\n').length).toBe(2);
  });

  it('uses [empty content] when a message has no parts', () => {
    const m: Message = { role: 'user', content: [], toolCalls: [] };
    const out = renderMessagesToText([m]);
    expect(out).toContain('[empty content]');
  });

  it('emits name/toolCallId/partial header attrs when present', () => {
    const m: Message = {
      role: 'tool',
      content: [{ type: 'text', text: 'ok' }],
      toolCalls: [],
      name: 'shell',
      toolCallId: 'tc-1',
      partial: true,
    };
    const out = renderMessagesToText([m]);
    expect(out).toContain('role=tool');
    expect(out).toContain('name="shell"');
    expect(out).toContain('toolCallId="tc-1"');
    expect(out).toContain('partial=true');
  });

  it('renders text parts under a text: block', () => {
    const out = renderMessagesToText([textMessage('user', 'hello world')]);
    expect(out).toMatch(/text:\n {2}hello world/);
  });

  it('renders think parts under a think: block', () => {
    const m: Message = {
      role: 'assistant',
      content: [{ type: 'think', think: 'reasoning' }],
      toolCalls: [],
    };
    expect(renderMessagesToText([m])).toMatch(/think:\n {2}reasoning/);
  });

  it('renders image_url / audio_url / video_url parts as media lines', () => {
    const m: Message = {
      role: 'user',
      content: [
        { type: 'image_url', imageUrl: { url: 'http://x/y.png' } },
        { type: 'audio_url', audioUrl: { url: 'http://x/y.mp3', id: 'a1' } },
        { type: 'video_url', videoUrl: { url: 'http://x/y.mp4' } },
      ],
      toolCalls: [],
    };
    const out = renderMessagesToText([m]);
    expect(out).toContain('image_url: http://x/y.png');
    expect(out).toContain('audio_url: http://x/y.mp3 (id=a1)');
    expect(out).toContain('video_url: http://x/y.mp4');
  });

  it('renders tool calls with parsed JSON arguments', () => {
    const m: Message = {
      role: 'assistant',
      content: [],
      toolCalls: [
        {
          id: 'tc-1',
          name: 'shell',
          arguments: JSON.stringify({ cmd: 'ls', n: 2 }),
        },
      ],
    };
    const out = renderMessagesToText([m]);
    expect(out).toContain('- tc-1: shell');
    expect(out).toMatch(/arguments:\n {2}\{\n {4}"cmd": "ls",\n {4}"n": 2\n {2}\}/);
  });

  it('passes through malformed JSON arguments verbatim', () => {
    const m: Message = {
      role: 'assistant',
      content: [],
      toolCalls: [{ id: 'tc-1', name: 'shell', arguments: 'not-json{[' }],
    };
    const out = renderMessagesToText([m]);
    expect(out).toContain('not-json{[');
  });

  it('renders null arguments as the literal "null"', () => {
    const m: Message = {
      role: 'assistant',
      content: [],
      toolCalls: [{ id: 'tc-1', name: 'shell', arguments: null }],
    };
    const out = renderMessagesToText([m]);
    expect(out).toMatch(/arguments:\n {2}null/);
  });

  it('serializes tool-call extras (and bigints) via stringifyJsonish', () => {
    const m: Message = {
      role: 'assistant',
      content: [],
      toolCalls: [
        { id: 'tc-1', name: 'shell', arguments: '{}', extras: { count: 1n, kind: 'a' } },
      ],
    };
    const out = renderMessagesToText([m]);
    expect(out).toContain('extras:');
    expect(out).toContain('"count": "1n"');
    expect(out).toContain('"kind": "a"');
  });

  it('marks circular tool-call extras as [Circular]', () => {
    const extra: Record<string, unknown> = {};
    extra.self = extra;
    const m: Message = {
      role: 'assistant',
      content: [],
      toolCalls: [{ id: 'tc-1', name: 'shell', arguments: '{}', extras: extra }],
    };
    const out = renderMessagesToText([m]);
    expect(out).toContain('[Circular]');
  });

  it('renders a content part that does not match the known cases as a JSON content block', () => {
    const m: Message = {
      role: 'user',
      // @ts-expect-error — exercise the default branch
      content: [{ type: 'unknown_kind', value: 42 }],
      toolCalls: [],
    };
    const out = renderMessagesToText([m]);
    expect(out).toMatch(/content:\n {2}\{\n {4}"type": "unknown_kind",\n {4}"value": 42\n {2}\}/);
  });
});
