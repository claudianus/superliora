/**
 * HTTP/2 Connect client for Cursor `agent.v1.AgentService/Run`.
 *
 * The agent host rejects HTTP/1.1 (AWS ALB 464), so this uses `node:http2`.
 * The request stream stays open with paced frames + heartbeats while the
 * response is read — half-closing early yields Cursor's "No exec result".
 */

import { randomUUID } from 'node:crypto';
import http2 from 'node:http2';
import { Readable } from 'node:stream';

import {
  CONNECT_FLAG_END,
  ConnectFrameDecoder,
  decodeFramePayload,
  parseConnectEndError,
  type ConnectFrame,
} from './connect';
import { extractAnswerText, extractReasoningText, extractToolCall } from './extract';
import { buildRunFrames, heartbeatFrame, type CursorRunParams } from './frames';

const AGENT_PATH = '/agent.v1.AgentService/Run';
const HEARTBEAT_INTERVAL_MS = 5_000;
const FIRST_BYTE_TIMEOUT_MS = 60_000;
const IDLE_TIMEOUT_MS = 8_000;

export type CursorStreamEvent =
  | { readonly type: 'text'; readonly text: string }
  | { readonly type: 'think'; readonly text: string }
  | {
      readonly type: 'tool_call';
      readonly name: string;
      readonly inputJson: string;
      readonly toolCallId?: string;
    }
  | { readonly type: 'end' };

export interface CursorClientOptions {
  readonly baseUrl: string;
  readonly clientVersion: string;
  readonly clientType?: string;
  readonly defaultHeaders?: Readonly<Record<string, string>>;
}

export class CursorAgentClient {
  private readonly baseUrl: string;
  private readonly clientVersion: string;
  private readonly clientType: string;
  private readonly defaultHeaders: Readonly<Record<string, string>>;

  constructor(options: CursorClientOptions) {
    this.baseUrl = options.baseUrl.replace(/\/$/, '');
    this.clientVersion = options.clientVersion;
    this.clientType = options.clientType ?? 'cli';
    this.defaultHeaders = options.defaultHeaders ?? {};
  }

  async *run(
    token: string,
    params: CursorRunParams,
    options: {
      readonly signal?: AbortSignal;
      readonly requestHeaders?: Readonly<Record<string, string>>;
    } = {},
  ): AsyncGenerator<CursorStreamEvent> {
    const frames = buildRunFrames(params);
    const requestId = randomUUID();
    const url = new URL(this.baseUrl);
    const authority = url.host;
    const session = http2.connect(this.baseUrl, {
      // Cursor agent hosts require HTTP/2 ALPN.
      rejectUnauthorized: true,
    });

    const closeSession = (): void => {
      try {
        session.close();
      } catch {
        // ignore
      }
    };

    if (options.signal?.aborted) {
      closeSession();
      throw new Error('Cursor request aborted.');
    }
    const onAbort = (): void => {
      closeSession();
    };
    options.signal?.addEventListener('abort', onAbort, { once: true });

    try {
      await new Promise<void>((resolve, reject) => {
        session.once('connect', () => resolve());
        session.once('error', reject);
      });

      const headers: http2.OutgoingHttpHeaders = {
        ':method': 'POST',
        ':path': AGENT_PATH,
        ':authority': authority,
        ':scheme': 'https',
        authorization: `Bearer ${token}`,
        'content-type': 'application/connect+proto',
        'connect-protocol-version': '1',
        'connect-accept-encoding': 'gzip',
        'user-agent': 'connect-es/1.6.1',
        'x-cursor-client-type': this.clientType,
        'x-cursor-client-version': this.clientVersion,
        'x-ghost-mode': 'true',
        'x-request-id': requestId,
        'x-original-request-id': requestId,
        'x-cursor-streaming': 'true',
        te: 'trailers',
        ...this.defaultHeaders,
        ...options.requestHeaders,
      };

      const req = session.request(headers, { endStream: false });
      const paced = createPacedBody(frames, options.signal);
      paced.stream.pipe(req);

      try {
        const status = await waitForResponseHeaders(req, options.signal);
        if (status !== undefined && status >= 400) {
          const errBody = await readAll(req);
          throw new Error(
            `Cursor AgentService/Run failed (HTTP ${status}): ${Buffer.from(errBody).toString('utf8').slice(0, 500)}`,
          );
        }

        yield* decodeResponseStream(req, options.signal);
      } finally {
        paced.stop();
      }
    } finally {
      options.signal?.removeEventListener('abort', onAbort);
      closeSession();
    }
  }
}

function createPacedBody(
  frames: Uint8Array[],
  signal?: AbortSignal,
): { readonly stream: Readable; readonly stop: () => void } {
  let heartbeat: ReturnType<typeof setInterval> | undefined;
  let closed = false;

  const stream = new Readable({
    read() {
      // Push-driven from the async pace loop.
    },
  });

  const pushFrame = (frame: Uint8Array): boolean => {
    if (closed) return false;
    return stream.push(Buffer.from(frame));
  };

  const stop = (): void => {
    if (closed) return;
    closed = true;
    if (heartbeat !== undefined) clearInterval(heartbeat);
    stream.push(null);
  };

  const fail = (error: Error): void => {
    if (closed) return;
    closed = true;
    if (heartbeat !== undefined) clearInterval(heartbeat);
    stream.destroy(error);
  };

  void (async () => {
    try {
      for (let index = 0; index < frames.length; index++) {
        if (signal?.aborted) {
          fail(new Error('Cursor request aborted.'));
          return;
        }
        pushFrame(frames[index]!);
        const paceMs = index === 0 ? 1500 : index === 1 ? 800 : 400;
        await sleep(paceMs, signal);
      }
      if (closed) return;
      heartbeat = setInterval(() => {
        if (signal?.aborted) {
          fail(new Error('Cursor request aborted.'));
          return;
        }
        pushFrame(heartbeatFrame());
      }, HEARTBEAT_INTERVAL_MS);
    } catch (error) {
      fail(error instanceof Error ? error : new Error(String(error)));
    }
  })();

  signal?.addEventListener(
    'abort',
    () => {
      fail(new Error('Cursor request aborted.'));
    },
    { once: true },
  );

  return { stream, stop };
}

async function* decodeResponseStream(
  stream: http2.ClientHttp2Stream,
  signal?: AbortSignal,
): AsyncGenerator<CursorStreamEvent> {
  const decoder = new ConnectFrameDecoder();
  let gotOutput = false;
  let idleTimer: ReturnType<typeof setTimeout> | undefined;
  let firstByteTimer: ReturnType<typeof setTimeout> | undefined;
  let timedOut = false;

  const resetIdle = (): void => {
    if (idleTimer !== undefined) clearTimeout(idleTimer);
    idleTimer = setTimeout(() => {
      timedOut = true;
      stream.close();
    }, IDLE_TIMEOUT_MS);
  };

  firstByteTimer = setTimeout(() => {
    if (!gotOutput) {
      timedOut = true;
      stream.close();
    }
  }, FIRST_BYTE_TIMEOUT_MS);

  try {
    for await (const chunk of stream as AsyncIterable<Buffer>) {
      if (signal?.aborted) throw new Error('Cursor request aborted.');
      const frames = decoder.push(new Uint8Array(chunk));
      for (const frame of frames) {
        for (const event of frameToEvents(frame)) {
          if (event.type === 'end') {
            yield event;
            return;
          }
          gotOutput = true;
          if (firstByteTimer !== undefined) {
            clearTimeout(firstByteTimer);
            firstByteTimer = undefined;
          }
          resetIdle();
          yield event;
          if (event.type === 'tool_call') {
            yield { type: 'end' };
            return;
          }
        }
      }
    }
    if (timedOut && !gotOutput) {
      throw new Error('Cursor upstream timed out before sending any output.');
    }
    yield { type: 'end' };
  } finally {
    if (idleTimer !== undefined) clearTimeout(idleTimer);
    if (firstByteTimer !== undefined) clearTimeout(firstByteTimer);
  }
}

function* frameToEvents(frame: ConnectFrame): Generator<CursorStreamEvent> {
  if ((frame.flags & CONNECT_FLAG_END) !== 0) {
    const error = parseConnectEndError(frame.payload);
    if (error !== undefined) {
      throw new Error(`${error.message}: ${error.detail}`);
    }
    yield { type: 'end' };
    return;
  }
  const payload = decodeFramePayload(frame);
  const tool = extractToolCall(payload);
  if (tool !== undefined) {
    yield {
      type: 'tool_call',
      name: tool.name,
      inputJson: tool.inputJson,
      ...(tool.toolCallId === undefined ? {} : { toolCallId: tool.toolCallId }),
    };
    return;
  }
  const think = extractReasoningText(payload);
  if (think !== undefined) {
    yield { type: 'think', text: think };
  }
  const text = extractAnswerText(payload);
  if (text !== undefined) {
    yield { type: 'text', text };
  }
}

function waitForResponseHeaders(
  req: http2.ClientHttp2Stream,
  signal?: AbortSignal,
): Promise<number | undefined> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new Error('Cursor request aborted.'));
      return;
    }
    const onAbort = (): void => {
      reject(new Error('Cursor request aborted.'));
    };
    signal?.addEventListener('abort', onAbort, { once: true });
    req.once('response', (headers) => {
      signal?.removeEventListener('abort', onAbort);
      const status = headers[':status'];
      resolve(typeof status === 'number' ? status : undefined);
    });
    req.once('error', (error) => {
      signal?.removeEventListener('abort', onAbort);
      reject(error);
    });
  });
}

async function readAll(stream: http2.ClientHttp2Stream): Promise<Uint8Array> {
  const chunks: Buffer[] = [];
  for await (const chunk of stream as AsyncIterable<Buffer>) {
    chunks.push(chunk);
  }
  return new Uint8Array(Buffer.concat(chunks));
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new Error('Cursor request aborted.'));
      return;
    }
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    const onAbort = (): void => {
      clearTimeout(timer);
      reject(new Error('Cursor request aborted.'));
    };
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}
