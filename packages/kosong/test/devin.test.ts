import { gzipSync } from 'node:zlib';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { APIContextOverflowError, ChatProviderError } from '../src/errors';
import type { StreamedMessagePart } from '../src/message';
import { DevinChatProvider } from '../src/providers/devin';
import { decodeDevinUnaryMessage } from '../src/providers/devin/devin-decode';
import { devinCliMetadata, normalizeDevinSessionToken } from '../src/providers/devin/devin-identity';
import { fetchDevinModels } from '../src/providers/devin/devin-models';
import {
  AssignModelResponseSchema,
  ChatToolCallSchema,
  GetChatMessageResponseSchema,
  type GetChatMessageResponse,
  ClientModelConfigSchema,
  GetCliModelConfigsResponseSchema,
  GetUserJwtResponseSchema,
  StopReason,
} from '../src/providers/devin/devin-proto.generated';
import { create, toBinary, type MessageCodec, type ProtoMessage } from '../src/providers/devin/protobuf';

const CHAT_PATH = '/exa.api_server_pb.ApiServerService/GetChatMessage';
const AUTH_PATH = '/exa.auth_pb.AuthService/GetUserJwt';
const ASSIGN_PATH = '/exa.api_server_pb.ApiServerService/AssignModel';
const MODELS_PATH = '/exa.api_server_pb.ApiServerService/GetCliModelConfigs';

type FetchMock = (
  input: Parameters<typeof fetch>[0],
  init?: Parameters<typeof fetch>[1],
) => Promise<Response>;

function unaryResponse<T extends ProtoMessage>(schema: MessageCodec<T>, msg: Partial<T>): Response {
  return new Response(Buffer.from(toBinary(schema, create(schema, msg))), { status: 200 });
}

function connectFrame(payload: Uint8Array, flag: number): Buffer {
  const frame = Buffer.alloc(5 + payload.length);
  frame[0] = flag;
  frame.writeUInt32BE(payload.length, 1);
  frame.set(payload, 5);
  return frame;
}

function chatFrames(messages: Array<Partial<GetChatMessageResponse>>, trailer?: unknown): Buffer[] {
  const frames = messages.map((msg) =>
    connectFrame(toBinary(GetChatMessageResponseSchema, create(GetChatMessageResponseSchema, msg)), 0),
  );
  frames.push(connectFrame(Buffer.from(JSON.stringify(trailer ?? {})), 0x02));
  return frames;
}

function streamResponse(frames: Buffer[]): Response {
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const frame of frames) controller.enqueue(new Uint8Array(frame));
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

describe('devin session token normalization', () => {
  it('adds the devin-session-token$ prefix when absent', () => {
    expect(normalizeDevinSessionToken('abc.def')).toBe('devin-session-token$abc.def');
    expect(normalizeDevinSessionToken('devin-session-token$abc.def')).toBe(
      'devin-session-token$abc.def',
    );
    expect(normalizeDevinSessionToken('')).toBe('');
  });
});

describe('decodeDevinUnaryMessage', () => {
  it('decodes a bare protobuf body', () => {
    const payload = toBinary(
      GetUserJwtResponseSchema,
      create(GetUserJwtResponseSchema, { userJwt: 'jwt-1' }),
    );
    expect(decodeDevinUnaryMessage(GetUserJwtResponseSchema, payload)?.userJwt).toBe('jwt-1');
  });

  it('falls back to gzip when the direct decode fails', () => {
    const payload = gzipSync(
      toBinary(GetUserJwtResponseSchema, create(GetUserJwtResponseSchema, { userJwt: 'jwt-2' })),
    );
    expect(decodeDevinUnaryMessage(GetUserJwtResponseSchema, payload)?.userJwt).toBe('jwt-2');
  });

  it('returns null on undecodable input', () => {
    expect(decodeDevinUnaryMessage(GetUserJwtResponseSchema, new Uint8Array([0xff]))).toBeNull();
  });
});

describe('DevinChatProvider', () => {
  it('exchanges the session token, streams text/thinking/tool calls, and reads the trailer', async () => {
    const seenUrls: string[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn<FetchMock>(async (input) => {
        const url = String(input);
        seenUrls.push(url);
        if (url.endsWith(AUTH_PATH)) {
          return unaryResponse(GetUserJwtResponseSchema, { userJwt: 'user-jwt-1' });
        }
        if (url.endsWith(CHAT_PATH)) {
          return streamResponse(
            chatFrames([
              { messageId: 'm1', deltaThinking: 'plan ' },
              { deltaText: 'Hello ' },
              { deltaText: 'world' },
              {
                deltaToolCalls: [
                  create(ChatToolCallSchema, {
                    id: 'tc1',
                    name: 'read_file',
                    argumentsJson: '{"path":',
                  }),
                ],
              },
              {
                deltaToolCalls: [
                  create(ChatToolCallSchema, { id: 'tc1', name: '', argumentsJson: '"a.ts"}' }),
                ],
              },
              { stopReason: StopReason.FUNCTION_CALL },
            ]),
          );
        }
        throw new Error(`unexpected url ${url}`);
      }),
    );

    const provider = new DevinChatProvider({ model: 'swe-1-6', apiKey: 'devin-session-token$tok' });
    const stream = await provider.generate('sys', [], [
      { role: 'user', content: [{ type: 'text', text: 'hi' }], toolCalls: [] },
    ]);
    const parts = await collect(stream);
    const texts = parts.filter((p) => p.type === 'text').map((p) => p.text);
    const thinks = parts.filter((p) => p.type === 'think').map((p) => p.think);
    const calls = parts.filter((p) => p.type === 'function');
    const argParts = parts.filter((p) => p.type === 'tool_call_part');

    expect(seenUrls.some((u) => u.endsWith(AUTH_PATH))).toBe(true);
    expect(seenUrls.some((u) => u.endsWith(CHAT_PATH))).toBe(true);
    expect(texts.join('')).toBe('Hello world');
    expect(thinks.join('')).toBe('plan ');
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({ id: 'tc1', name: 'read_file' });
    expect(argParts.map((p) => p.argumentsPart).join('')).toBe('{"path":"a.ts"}');
  });

  it('routes `adaptive` through AssignModel before chatting', async () => {
    const seenUrls: string[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn<FetchMock>(async (input) => {
        const url = String(input);
        seenUrls.push(url);
        if (url.endsWith(AUTH_PATH)) {
          return unaryResponse(GetUserJwtResponseSchema, { userJwt: 'jwt' });
        }
        if (url.endsWith(ASSIGN_PATH)) {
          return unaryResponse(AssignModelResponseSchema, {
            assignment: { assignmentJwt: 'assign-jwt', modelUid: 'swe-1-6', harnessUids: [] },
          });
        }
        if (url.endsWith(CHAT_PATH)) {
          return streamResponse(chatFrames([{ deltaText: 'ok', stopReason: StopReason.STOP_PATTERN }]));
        }
        throw new Error(`unexpected url ${url}`);
      }),
    );

    const provider = new DevinChatProvider({ model: 'adaptive', apiKey: 'tok' });
    const stream = await provider.generate('sys', [], [
      { role: 'user', content: [{ type: 'text', text: 'hi' }], toolCalls: [] },
    ]);
    await collect(stream);
    const assignIdx = seenUrls.findIndex((u) => u.endsWith(ASSIGN_PATH));
    const chatIdx = seenUrls.findIndex((u) => u.endsWith(CHAT_PATH));
    expect(assignIdx).toBeGreaterThanOrEqual(0);
    expect(chatIdx).toBeGreaterThan(assignIdx);
  });

  it('maps a large-history invalid_argument trailer to context overflow', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn<FetchMock>(async (input) => {
        const url = String(input);
        if (url.endsWith(AUTH_PATH)) {
          return unaryResponse(GetUserJwtResponseSchema, { userJwt: 'jwt' });
        }
        if (url.endsWith(CHAT_PATH)) {
          return streamResponse([
            connectFrame(
              Buffer.from(
                JSON.stringify({ error: { code: 'invalid_argument', message: 'Internal error' } }),
              ),
              0x02,
            ),
          ]);
        }
        throw new Error(`unexpected url ${url}`);
      }),
    );

    const provider = new DevinChatProvider({
      model: 'swe-1-6',
      apiKey: 'tok',
      // A request body ≥512KiB triggers the overflow heuristic.
      generationKwargs: { stopSequences: ['x'.repeat(600 * 1024)] },
    });
    const stream = await provider.generate('sys', [], [
      { role: 'user', content: [{ type: 'text', text: 'hi' }], toolCalls: [] },
    ]);
    await expect(collect(stream)).rejects.toBeInstanceOf(APIContextOverflowError);
  });

  it('surfaces Connect trailer errors as ChatProviderError', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn<FetchMock>(async (input) => {
        const url = String(input);
        if (url.endsWith(AUTH_PATH)) {
          return unaryResponse(GetUserJwtResponseSchema, { userJwt: 'jwt' });
        }
        return streamResponse([
          connectFrame(
            Buffer.from(JSON.stringify({ error: { code: 'permission_denied', message: 'nope' } })),
            0x02,
          ),
        ]);
      }),
    );
    const provider = new DevinChatProvider({ model: 'swe-1-6', apiKey: 'tok' });
    const stream = await provider.generate('sys', [], [
      { role: 'user', content: [{ type: 'text', text: 'hi' }], toolCalls: [] },
    ]);
    await expect(collect(stream)).rejects.toBeInstanceOf(ChatProviderError);
  });

  it('sends the released-CLI identity metadata on auth', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn<FetchMock>(async (input) => {
        const url = String(input);
        if (url.endsWith(AUTH_PATH)) {
          return unaryResponse(GetUserJwtResponseSchema, { userJwt: 'jwt' });
        }
        return streamResponse(chatFrames([{ deltaText: 'ok', stopReason: StopReason.STOP_PATTERN }]));
      }),
    );
    const provider = new DevinChatProvider({ model: 'swe-1-6', apiKey: 'devin-session-token$tok9' });
    const stream = await provider.generate('sys', [], [
      { role: 'user', content: [{ type: 'text', text: 'hi' }], toolCalls: [] },
    ]);
    await collect(stream);
    const meta = devinCliMetadata('devin-session-token$tok9');
    expect(meta['ideName']).toBe('devin-cli');
    expect(meta['apiKey']).toBe('devin-session-token$tok9');
  });
});

describe('fetchDevinModels', () => {
  it('parses client model configs into discovered models', async () => {
    let requestUrl = '';
    vi.stubGlobal(
      'fetch',
      vi.fn<FetchMock>(async (input) => {
        requestUrl = String(input);
        return unaryResponse(GetCliModelConfigsResponseSchema, {
          clientModelConfigs: [
            create(ClientModelConfigSchema, {
              modelUid: 'swe-1-6',
              label: 'SWE-1.6',
              maxTokens: 64000,
              supportsImages: false,
              disabled: false,
              isRecommended: true,
            }),
            create(ClientModelConfigSchema, {
              modelUid: 'claude-x',
              label: 'Claude X',
              maxTokens: 128000,
              supportsImages: true,
              disabled: false,
            }),
          ],
        });
      }),
    );
    const models = await fetchDevinModels({ apiKey: 'tok', baseUrl: 'https://example.com' });
    expect(requestUrl).toContain(MODELS_PATH);
    expect(models).not.toBeNull();
    const ids = (models ?? []).map((m) => m.id);
    expect(ids).toContain('swe-1-6');
    expect(ids).toContain('claude-x');
  });
});
