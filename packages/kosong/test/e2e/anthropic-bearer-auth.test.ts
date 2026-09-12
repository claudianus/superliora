import type { Message } from '#/message';
import { AnthropicChatProvider } from '#/providers/anthropic/index';
import { describe, expect, it } from 'vitest';

import { createFakeProviderHarness } from './fake-provider-harness';

function anthropicSseFrame(event: string, payload: unknown): string {
  return `event: ${event}\ndata: ${JSON.stringify(payload)}\n\n`;
}

function minimalStream(): string {
  return [
    anthropicSseFrame('message_start', {
      type: 'message_start',
      message: {
        id: 'msg_bearer',
        type: 'message',
        role: 'assistant',
        model: 'k25',
        content: [],
        stop_reason: null,
        stop_sequence: null,
        usage: { input_tokens: 5, output_tokens: 0 },
      },
    }),
    anthropicSseFrame('content_block_start', {
      type: 'content_block_start',
      index: 0,
      content_block: { type: 'text', text: 'ok' },
    }),
    anthropicSseFrame('content_block_stop', { type: 'content_block_stop', index: 0 }),
    anthropicSseFrame('message_delta', {
      type: 'message_delta',
      delta: { type: 'message_delta', stop_reason: 'end_turn', stop_sequence: null },
      usage: { input_tokens: 5, output_tokens: 1 },
    }),
    anthropicSseFrame('message_stop', { type: 'message_stop' }),
  ].join('');
}

const HISTORY: Message[] = [
  { role: 'user', content: [{ type: 'text', text: 'hi' }], toolCalls: [] },
];

describe('e2e: Anthropic adapter bearer-style auth', () => {
  it('suppresses x-api-key when the request auth carries an Authorization header', async () => {
    const harness = await createFakeProviderHarness();
    try {
      harness.route('POST', '/v1/messages', async (request, reply) => {
        // Bearer-style anthropic-compatible endpoints (Z.AI, GitLab Duo proxy)
        // must see exactly one credential style.
        expect(request.headers['authorization']).toBe('Bearer bearer-token-123');
        expect(request.headers['x-api-key']).toBeUndefined();
        await reply.raw(200, minimalStream(), {
          'content-type': 'text/event-stream; charset=utf-8',
          'cache-control': 'no-cache',
          connection: 'keep-alive',
        });
      });

      const provider = new AnthropicChatProvider({
        model: 'k25',
        apiKey: 'default-key',
        baseUrl: harness.baseUrl,
        defaultMaxTokens: 256,
        stream: true,
      });

      const stream = await provider.generate('You are helpful.', [], HISTORY, {
        auth: { apiKey: 'bearer-token-123', headers: { Authorization: 'Bearer bearer-token-123' } },
      });
      for await (const _part of stream) {
        // Drain the stream.
      }
      expect(harness.requests).toHaveLength(1);
    } finally {
      await harness.close();
    }
  });

  it('keeps the x-api-key credential when no request Authorization header is set', async () => {
    const harness = await createFakeProviderHarness();
    try {
      harness.route('POST', '/v1/messages', async (request, reply) => {
        expect(request.headers['x-api-key']).toBe('rotated-key');
        expect(request.headers['authorization']).toBeUndefined();
        await reply.raw(200, minimalStream(), {
          'content-type': 'text/event-stream; charset=utf-8',
          'cache-control': 'no-cache',
          connection: 'keep-alive',
        });
      });

      const provider = new AnthropicChatProvider({
        model: 'k25',
        apiKey: 'default-key',
        baseUrl: harness.baseUrl,
        defaultMaxTokens: 256,
        stream: true,
      });

      const stream = await provider.generate('You are helpful.', [], HISTORY, {
        auth: { apiKey: 'rotated-key' },
      });
      for await (const _part of stream) {
        // Drain the stream.
      }
      expect(harness.requests).toHaveLength(1);
    } finally {
      await harness.close();
    }
  });
});
