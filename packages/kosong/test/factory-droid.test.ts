import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  FACTORY_DROID_MODELS,
  FactoryDroidChatProvider,
  factoryDroidApiHost,
  resolveFactoryDroidRoute,
} from '../src/providers/factory-droid';
import type { StreamedMessagePart } from '../src/message';

type FetchMock = (
  input: Parameters<typeof fetch>[0],
  init?: Parameters<typeof fetch>[1],
) => Promise<Response>;

function sseResponse(events: string[]): Response {
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const enc = new TextEncoder();
      for (const event of events) controller.enqueue(enc.encode(`data: ${event}\n\n`));
      controller.enqueue(enc.encode('data: [DONE]\n\n'));
      controller.close();
    },
  });
  return new Response(stream, { status: 200 });
}

function anthropicSseResponse(): Response {
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const enc = new TextEncoder();
      controller.enqueue(
        enc.encode(
          'event: message_start\n' +
            'data: {"type":"message_start","message":{"id":"m1","model":"claude","usage":{"input_tokens":1,"output_tokens":0}}}\n\n' +
            'event: content_block_start\n' +
            'data: {"type":"content_block_start","index":0,"content_block":{"type":"text","text":""}}\n\n' +
            'event: content_block_delta\n' +
            'data: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"hi"}}\n\n' +
            'event: content_block_stop\ndata: {"type":"content_block_stop","index":0}\n\n' +
            'event: message_delta\n' +
            'data: {"type":"message_delta","delta":{"stop_reason":"end_turn"},"usage":{"output_tokens":1}}\n\n' +
            'event: message_stop\ndata: {"type":"message_stop"}\n\n',
        ),
      );
      controller.close();
    },
  });
  return new Response(stream, { status: 200 });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

async function collect(stream: AsyncIterable<StreamedMessagePart>): Promise<StreamedMessagePart[]> {
  const parts: StreamedMessagePart[] = [];
  for await (const part of stream) parts.push(part);
  return parts;
}

const USER_MSG = { role: 'user' as const, content: [{ type: 'text' as const, text: 'hi' }], toolCalls: [] };

describe('factory-droid model registry', () => {
  it('routes every roster model to its captured wire and default upstream', () => {
    expect(resolveFactoryDroidRoute('claude-opus-5-5')).toMatchObject({
      wire: 'anthropic-messages',
      upstream: 'anthropic',
    });
    expect(resolveFactoryDroidRoute('gpt-5.5')).toMatchObject({
      wire: 'openai-responses',
      upstream: 'openai',
    });
    expect(resolveFactoryDroidRoute('gemini-3.8-flash')).toMatchObject({
      wire: 'google-generate',
      upstream: 'google',
    });
    expect(resolveFactoryDroidRoute('kimi-k3')).toMatchObject({
      wire: 'openai-completions',
      upstream: 'fireworks',
    });
    expect(resolveFactoryDroidRoute('minimax-m2.7')).toMatchObject({
      wire: 'anthropic-messages',
      upstream: 'fireworks',
    });
    // Family fallbacks cover roster misses.
    expect(resolveFactoryDroidRoute('claude-sonnet-9')).toMatchObject({
      wire: 'anthropic-messages',
    });
    expect(resolveFactoryDroidRoute('gpt-9-x')).toMatchObject({ wire: 'openai-responses' });
    expect(resolveFactoryDroidRoute('gemini-9')).toMatchObject({ wire: 'google-generate' });
    // Unknown families default to the completions route.
    expect(resolveFactoryDroidRoute('mystery-1')).toMatchObject({ wire: 'openai-completions' });
    expect(Object.keys(FACTORY_DROID_MODELS).length).toBeGreaterThanOrEqual(50);
  });

  it('selects the EU host only for eu residency', () => {
    expect(factoryDroidApiHost('eu')).toBe('https://api.eu.factory.ai');
    expect(factoryDroidApiHost('global')).toBe('https://api.factory.ai');
    expect(factoryDroidApiHost('us')).toBe('https://api.factory.ai');
    expect(factoryDroidApiHost(undefined)).toBe('https://api.factory.ai');
  });
});

describe('FactoryDroidChatProvider', () => {
  it('sends Factory identity + routing headers on the anthropic wire', async () => {
    let seen: { url: string; headers: Headers } | undefined;
    vi.stubGlobal(
      'fetch',
      vi.fn<FetchMock>(async (input, init) => {
        seen = { url: String(input), headers: new Headers(init?.headers) };
        return anthropicSseResponse();
      }),
    );
    const provider = new FactoryDroidChatProvider({
      model: 'claude-opus-5-5',
      apiKey: 'workos-token',
      orgId: 'org-1',
    });
    const stream = await provider.generate('sys', [], [USER_MSG]);
    await collect(stream);
    expect(seen?.url).toBe('https://api.factory.ai/api/llm/a/v1/messages');
    expect(seen?.headers.get('authorization')).toBe('Bearer workos-token');
    expect(seen?.headers.get('x-api-provider')).toBe('anthropic');
    expect(seen?.headers.get('x-factory-org-id')).toBe('org-1');
    expect(seen?.headers.get('x-factory-client')).toBe('cli');
    expect(seen?.headers.get('x-client-version')).toBeTruthy();
    expect(seen?.headers.get('x-session-id')).toBeTruthy();
    expect(seen?.headers.get('x-assistant-message-id')).toBeTruthy();
  });

  it('hits the completions endpoint for fireworks-routed models', async () => {
    let seen: { url: string; headers: Headers; body: string } | undefined;
    vi.stubGlobal(
      'fetch',
      vi.fn<FetchMock>(async (input, init) => {
        seen = {
          url: String(input),
          headers: new Headers(init?.headers),
          body: String(init?.body),
        };
        return sseResponse([
          JSON.stringify({
            id: 'c1',
            choices: [{ index: 0, delta: { content: 'hi' }, finish_reason: 'stop' }],
          }),
        ]);
      }),
    );
    const provider = new FactoryDroidChatProvider({
      model: 'kimi-k3',
      apiKey: 'workos-token',
      region: 'eu',
    });
    const stream = await provider.generate('sys', [], [USER_MSG]);
    const parts = await collect(stream);
    expect(seen?.url).toBe('https://api.eu.factory.ai/api/llm/o/v1/chat/completions');
    expect(seen?.headers.get('authorization')).toBe('Bearer workos-token');
    expect(seen?.headers.get('x-api-provider')).toBe('fireworks');
    expect(seen?.headers.get('x-provider-routing-source')).toBe('registry_default');
    expect(parts.filter((p) => p.type === 'text').map((p) => p.text).join('')).toBe('hi');
  });

  it('requires a WorkOS token', async () => {
    const provider = new FactoryDroidChatProvider({ model: 'kimi-k3' });
    await expect(provider.generate('sys', [], [USER_MSG])).rejects.toThrow(/apiKey is required/);
  });

  it('honours a per-request auth token override', async () => {
    let seen: { headers: Headers } | undefined;
    vi.stubGlobal(
      'fetch',
      vi.fn<FetchMock>(async (input, init) => {
        seen = { headers: new Headers(init?.headers) };
        return sseResponse([
          JSON.stringify({
            id: 'c1',
            choices: [{ index: 0, delta: { content: 'hi' }, finish_reason: 'stop' }],
          }),
        ]);
      }),
    );
    const provider = new FactoryDroidChatProvider({ model: 'kimi-k3' });
    const stream = await provider.generate('sys', [], [USER_MSG], {
      auth: { apiKey: 'fresh-token' },
    });
    await collect(stream);
    expect(seen?.headers.get('authorization')).toBe('Bearer fresh-token');
  });
});
