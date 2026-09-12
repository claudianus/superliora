import { describe, expect, it } from 'vitest';

import {
  crc32,
  decodeEventStreamMessage,
  decodeAmazonEventStream,
} from '../src/providers/kiro/kiro-eventstream';
import {
  KiroCodeWhispererChatProvider,
  toKiroModelId,
} from '../src/providers/kiro/codewhisperer';

type HeaderValue =
  | { type: 'string'; value: string }
  | { type: 'true' }
  | { type: 'false' };

/** Builds a single eventstream frame (the inverse of the decoder under test). */
function encodeEventStreamMessage(headers: Record<string, HeaderValue>, payload: string): Uint8Array {
  const encoder = new TextEncoder();
  const headerBytes: number[] = [];
  const appendU16 = (value: number): void => {
    headerBytes.push((value >> 8) & 0xff, value & 0xff);
  };
  for (const [name, header] of Object.entries(headers)) {
    const nameBytes = encoder.encode(name);
    headerBytes.push(nameBytes.length, ...nameBytes);
    if (header.type === 'true') {
      headerBytes.push(0);
    } else if (header.type === 'false') {
      headerBytes.push(1);
    } else {
      headerBytes.push(7);
      const valueBytes = encoder.encode(header.value);
      appendU16(valueBytes.length);
      headerBytes.push(...valueBytes);
    }
  }
  const payloadBytes = encoder.encode(payload);
  const headersLen = headerBytes.length;
  const total = 8 + 4 + headersLen + payloadBytes.length + 4;

  const frame = new Uint8Array(total);
  const view = new DataView(frame.buffer);
  view.setUint32(0, total, false);
  view.setUint32(4, headersLen, false);
  frame.set(headerBytes, 12);
  frame.set(payloadBytes, 12 + headersLen);
  const preludeCrc = crc32(frame.subarray(0, 8));
  view.setUint32(8, preludeCrc, false);
  const msgCrc = crc32(frame.subarray(0, total - 4));
  view.setUint32(total - 4, msgCrc, false);
  return frame;
}

function streamResponse(frames: Uint8Array[]): Response {
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const frame of frames) controller.enqueue(frame);
      controller.close();
    },
  });
  return new Response(stream, { status: 200 });
}

describe('kiro eventstream decoder', () => {
  it('round-trips a string-header frame with CRC validation', () => {
    const frame = encodeEventStreamMessage(
      { ':event-type': { type: 'string', value: 'assistantResponseEvent' }, ':message-type': { type: 'string', value: 'event' } },
      JSON.stringify({ assistantResponseEvent: { content: 'hello' } }),
    );
    const message = decodeEventStreamMessage(frame);
    expect(message.headers[':event-type']).toBe('assistantResponseEvent');
    expect(message.headers[':message-type']).toBe('event');
  });

  it('rejects a frame with a corrupted payload CRC', () => {
    const frame = encodeEventStreamMessage(
      { ':event-type': { type: 'string', value: 'assistantResponseEvent' } },
      '{}',
    );
    const crcIndex = frame.length - 2;
    frame[crcIndex] = (frame[crcIndex] ?? 0) ^ 0xff;
    expect(() => decodeEventStreamMessage(frame)).toThrow(/message CRC mismatch/);
  });

  it('streams text deltas, tool calls, and exceptions across chunk boundaries', async () => {
    const frames = [
      encodeEventStreamMessage({ ':message-type': { type: 'string', value: 'event' }, ':event-type': { type: 'string', value: 'assistantResponseEvent' } },
        JSON.stringify({ assistantResponseEvent: { content: 'Hel' } })),
      encodeEventStreamMessage({ ':message-type': { type: 'string', value: 'event' }, ':event-type': { type: 'string', value: 'assistantResponseEvent' } },
        JSON.stringify({ assistantResponseEvent: { content: 'lo' } })),
      encodeEventStreamMessage({ ':message-type': { type: 'string', value: 'event' }, ':event-type': { type: 'string', value: 'toolUseEvent' } },
        JSON.stringify({ toolUseEvent: { toolUseId: 'tu1', name: 'read_file', input: { path: 'a.ts' } } })),
      encodeEventStreamMessage({ ':message-type': { type: 'string', value: 'event' }, ':event-type': { type: 'string', value: 'toolUseEvent' } },
        JSON.stringify({ toolUseEvent: { stop: { stopReason: 'tool_use' } } })),
    ];
    // Split the frame stream at an arbitrary boundary to exercise reassembly.
    const all = Buffer.concat(frames);
    const split = 37;
    const chunks = [all.subarray(0, split), all.subarray(split)];
    let chunkIndex = 0;
    const body = new ReadableStream<Uint8Array>({
      pull(controller) {
        const next = chunks[chunkIndex];
        if (chunkIndex < chunks.length && next !== undefined) {
          controller.enqueue(next);
          chunkIndex += 1;
        } else {
          controller.close();
        }
      },
    });

    const provider = new KiroCodeWhispererChatProvider({
      model: 'claude-sonnet-4-6',
      clientFactory: () => ({
        url: 'https://codewhisperer.us-east-1.amazonaws.com/',
        fetch: (async () => streamResponse(chunks)) as typeof fetch,
      }),
    });
    const streamed = await provider.generate('sys', [], [
      { role: 'user', content: [{ type: 'text', text: 'hi' }], toolCalls: [] },
    ], { auth: { apiKey: 'tok' } });

    const parts = [];
    for await (const part of streamed) parts.push(part);
    expect(parts).toHaveLength(3);
    expect(parts[0]).toMatchObject({ type: 'text', text: 'Hel' });
    expect(parts[1]).toMatchObject({ type: 'text', text: 'lo' });
    expect(parts[2]).toMatchObject({ type: 'function', id: 'tu1', name: 'read_file' });
    const toolCall = parts[2] as { arguments: string | null };
    expect(JSON.parse(String(toolCall.arguments))).toEqual({ path: 'a.ts' });
    expect(streamed.finishReason).toBe('tool_calls');
  });

  it('throws a descriptive error for exception frames', async () => {
    const frames = [
      encodeEventStreamMessage(
        { ':message-type': { type: 'string', value: 'exception' }, ':exception-type': { type: 'string', value: 'ValidationException' } },
        JSON.stringify({ message: 'bad request' }),
      ),
    ];
    const provider = new KiroCodeWhispererChatProvider({
      model: 'claude-sonnet-4-6',
      clientFactory: () => ({
        url: 'https://codewhisperer.us-east-1.amazonaws.com/',
        fetch: (async () => streamResponse(frames)) as typeof fetch,
      }),
    });
    const streamed = await provider.generate('sys', [], [
      { role: 'user', content: [{ type: 'text', text: 'hi' }], toolCalls: [] },
    ], { auth: { apiKey: 'tok' } });
    await expect(async () => {
      for await (const _part of streamed) {
        // drain
      }
    }).rejects.toThrow('ValidationException: bad request');
  });

  it('maps hyphenated model ids to the wire naming', () => {
    expect(toKiroModelId('claude-sonnet-4-6')).toBe('claude-sonnet-4.6');
  });

  it('sends the CodeWhisperer target header and bearer token', async () => {
    let captured: RequestInit | undefined;
    const provider = new KiroCodeWhispererChatProvider({
      model: 'claude-sonnet-4-6',
      clientFactory: () => ({
        url: 'https://codewhisperer.us-east-1.amazonaws.com/',
        fetch: (async (_url: string, init?: RequestInit) => {
          captured = init;
          return streamResponse([
            encodeEventStreamMessage({ ':message-type': { type: 'string', value: 'event' }, ':event-type': { type: 'string', value: 'assistantResponseEvent' } },
              JSON.stringify({ assistantResponseEvent: { content: 'ok' } })),
          ]);
        }) as typeof fetch,
      }),
    });
    const streamed = await provider.generate('sys', [], [
      { role: 'user', content: [{ type: 'text', text: 'hi' }], toolCalls: [] },
    ], { auth: { apiKey: 'tok' } });
    for await (const _part of streamed) {
      // drain
    }
    const headers = captured?.headers as Record<string, string>;
    expect(headers['amzn-X-amz-target']).toBe('AmazonCodeWhispererService.GenerateAssistantResponse');
    expect(headers['authorization']).toBe('Bearer tok');
    expect(headers['accept']).toBe('application/vnd.amazon.eventstream');
    const body = JSON.parse(String(captured?.body)) as { conversationState: { currentMessage: { userInputMessage: { content: string; modelId: string } } } };
    expect(body.conversationState.currentMessage.userInputMessage.modelId).toBe('claude-sonnet-4.6');
    expect(body.conversationState.currentMessage.userInputMessage.content).toContain('sys');
    void decodeAmazonEventStream;
  });
});
