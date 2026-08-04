/**
 * HTTP/2 Connect client for Cursor `agent.v1.AgentService/Run`.
 *
 * The agent host rejects HTTP/1.1 (AWS ALB 464), so this uses `node:http2`.
 * The request stream stays open with paced frames + heartbeats while the
 * response is read — half-closing early yields Cursor's "No exec result".
 *
 * Cursor also blocks mid-turn on `requestContextArgs`, `interactionQuery`, and
 * native-exec messages. Those must be answered on the open request stream or
 * the idle close surfaces as `Premature close` with leaked tool-call text.
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
import {
  extractAnswerText,
  extractExecMessage,
  extractInteractionQuery,
  extractKvMessage,
  extractReasoningText,
  extractToolCall,
  isCursorProgressPayload,
} from './extract';
import { buildRunFrames, heartbeatFrame, type CursorAgentTool, type CursorRunParams } from './frames';
import {
  encodeInteractionQueryReply,
  encodeKvReply,
  encodeNativeExecReject,
  encodeRequestContextReply,
} from './replies';

const AGENT_PATH = '/agent.v1.AgentService/Run';
const HEARTBEAT_INTERVAL_MS = 5_000;
const FIRST_BYTE_TIMEOUT_MS = 60_000;
/** Align with kosong LLM idle default — must survive long tool-assembly gaps. */
const IDLE_TIMEOUT_MS = 180_000;
/** Wait for sibling parallel tool calls before ending the Cursor turn. */
const TOOL_FINALIZE_GRACE_MS = 400;

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
      throw cursorAbortedError();
    }
    const onAbort = (): void => {
      closeSession();
    };
    options.signal?.addEventListener('abort', onAbort, { once: true });
    // Session RST/close after connect must not become an unhandled 'error'.
    session.on('error', () => {
      /* run() observes abort / stream end */
    });

    try {
      await new Promise<void>((resolve, reject) => {
        const onConnect = (): void => {
          session.off('error', onError);
          resolve();
        };
        const onError = (error: Error): void => {
          session.off('connect', onConnect);
          reject(error);
        };
        session.once('connect', onConnect);
        session.once('error', onError);
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
      // Closing the session on abort can RST the request; swallow so it cannot
      // surface as an unhandled 'error' on the HTTP/2 stream.
      req.on('error', () => {
        /* handled via abort / generator exit */
      });
      const paced = createPacedBody(frames, options.signal);
      paced.stream.pipe(req);

      try {
        if (options.signal?.aborted) throw cursorAbortedError();
        const status = await waitForResponseHeaders(req, options.signal);
        if (options.signal?.aborted) throw cursorAbortedError();
        if (status !== undefined && status >= 400) {
          const errBody = await readAll(req);
          throw new Error(
            `Cursor AgentService/Run failed (HTTP ${status}): ${Buffer.from(errBody).toString('utf8').slice(0, 500)}`,
          );
        }

        yield* decodeResponseStream(req, {
          signal: options.signal,
          writeFrame: paced.write,
          tools: params.tools,
        });
      } finally {
        paced.stop();
      }
    } finally {
      options.signal?.removeEventListener('abort', onAbort);
      closeSession();
    }
  }
}

/** @internal Exported for abort / stream lifecycle tests. */
export function createPacedBody(
  frames: Uint8Array[],
  signal?: AbortSignal,
): {
  readonly stream: Readable;
  readonly write: (frame: Uint8Array) => void;
  readonly stop: () => void;
} {
  let heartbeat: ReturnType<typeof setInterval> | undefined;
  let closed = false;

  const stream = new Readable({
    read() {
      // Push-driven from the async pace loop.
    },
  });
  // destroy(error) without a listener becomes an unhandled 'error' and kills the
  // process — always attach before any abort path can run.
  stream.on('error', () => {
    /* abort / pipe teardown */
  });

  const pushFrame = (frame: Uint8Array): boolean => {
    if (closed) return false;
    return stream.push(Buffer.from(frame));
  };

  const write = (frame: Uint8Array): void => {
    pushFrame(frame);
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
          // Clean end — do not destroy(error); abort is observed by run().
          stop();
          return;
        }
        pushFrame(frames[index]!);
        const paceMs = index === 0 ? 1500 : index === 1 ? 800 : 400;
        await sleep(paceMs, signal);
      }
      if (closed) return;
      heartbeat = setInterval(() => {
        if (signal?.aborted) {
          stop();
          return;
        }
        pushFrame(heartbeatFrame());
      }, HEARTBEAT_INTERVAL_MS);
    } catch (error) {
      if (signal?.aborted || isCursorAbortedError(error)) {
        stop();
        return;
      }
      fail(error instanceof Error ? error : new Error(String(error)));
    }
  })();

  signal?.addEventListener(
    'abort',
    () => {
      stop();
    },
    { once: true },
  );

  return { stream, write, stop };
}

function cursorAbortedError(): Error {
  return new Error('Cursor request aborted.');
}

function isCursorAbortedError(error: unknown): boolean {
  return error instanceof Error && error.message === 'Cursor request aborted.';
}

async function* decodeResponseStream(
  stream: http2.ClientHttp2Stream,
  options: {
    readonly signal?: AbortSignal;
    readonly writeFrame: (frame: Uint8Array) => void;
    readonly tools: readonly CursorAgentTool[];
  },
): AsyncGenerator<CursorStreamEvent> {
  const decoder = new ConnectFrameDecoder();
  let gotOutput = false;
  let idleTimer: ReturnType<typeof setTimeout> | undefined;
  let firstByteTimer: ReturnType<typeof setTimeout> | undefined;
  let timedOut = false;
  let idleTimedOut = false;
  const pendingTools: Array<Extract<CursorStreamEvent, { type: 'tool_call' }>> = [];
  const iterator = (stream as AsyncIterable<Buffer>)[Symbol.asyncIterator]();
  let nextChunk: Promise<IteratorResult<Buffer>> | undefined;

  const resetIdle = (): void => {
    if (idleTimer !== undefined) clearTimeout(idleTimer);
    idleTimer = setTimeout(() => {
      idleTimedOut = true;
      timedOut = true;
      try {
        stream.close();
      } catch {
        // ignore
      }
    }, IDLE_TIMEOUT_MS);
  };

  const flushToolsAndEnd = function* (): Generator<CursorStreamEvent> {
    for (const tool of pendingTools) yield tool;
    pendingTools.length = 0;
    yield { type: 'end' };
  };

  firstByteTimer = setTimeout(() => {
    if (!gotOutput) {
      timedOut = true;
      try {
        stream.close();
      } catch {
        // ignore
      }
    }
  }, FIRST_BYTE_TIMEOUT_MS);

  try {
    for (;;) {
      if (options.signal?.aborted) throw cursorAbortedError();

      nextChunk ??= iterator.next();
      let result: IteratorResult<Buffer>;
      if (pendingTools.length > 0) {
        const raced = await Promise.race([
          nextChunk.then((value) => ({ kind: 'chunk' as const, value })),
          sleep(TOOL_FINALIZE_GRACE_MS, options.signal).then(() => ({ kind: 'grace' as const })),
        ]);
        if (raced.kind === 'grace') {
          yield* flushToolsAndEnd();
          return;
        }
        result = raced.value;
        nextChunk = undefined;
      } else {
        result = await nextChunk;
        nextChunk = undefined;
      }

      if (result.done) break;

      const frames = decoder.push(new Uint8Array(result.value));
      for (const frame of frames) {
        // Any server frame (progress, requestContext, KV, …) proves liveness.
        // Previously only yielded text/think/tool events reset idle, so long
        // tool-assembly gaps of tokenDelta/heartbeat frames hit Premature close.
        gotOutput = true;
        if (firstByteTimer !== undefined) {
          clearTimeout(firstByteTimer);
          firstByteTimer = undefined;
        }
        resetIdle();

        for (const event of handleFrame(frame, options.writeFrame, options.tools)) {
          if (event.type === 'end') {
            yield* flushToolsAndEnd();
            return;
          }
          if (event.type === 'tool_call') {
            pendingTools.push(event);
            continue;
          }
          if (event.type === 'text' || event.type === 'think') {
            yield event;
          }
        }
      }
    }

    if (pendingTools.length > 0) {
      yield* flushToolsAndEnd();
      return;
    }

    if (options.signal?.aborted) throw cursorAbortedError();
    if (timedOut && !gotOutput) {
      throw new Error('Cursor upstream timed out before sending any output.');
    }
    if (idleTimedOut) {
      throw new Error('Cursor upstream went idle with no frames; retry the turn.');
    }
    yield { type: 'end' };
  } catch (error) {
    if (options.signal?.aborted || isCursorAbortedError(error)) throw cursorAbortedError();
    if (idleTimedOut) {
      throw new Error('Cursor upstream went idle with no frames; retry the turn.');
    }
    if (isPrematureClose(error)) {
      throw new Error('Cursor upstream closed the stream early; retry the turn.');
    }
    throw error;
  } finally {
    if (idleTimer !== undefined) clearTimeout(idleTimer);
    if (firstByteTimer !== undefined) clearTimeout(firstByteTimer);
  }
}

function* handleFrame(
  frame: ConnectFrame,
  writeFrame: (frame: Uint8Array) => void,
  tools: readonly CursorAgentTool[],
): Generator<CursorStreamEvent> {
  if ((frame.flags & CONNECT_FLAG_END) !== 0) {
    const error = parseConnectEndError(frame.payload);
    if (error !== undefined) {
      throw new Error(`${error.message}: ${error.detail}`);
    }
    yield { type: 'end' };
    return;
  }
  const payload = decodeFramePayload(frame);

  // 1) Answer interaction queries immediately (server blocks until matched id).
  const query = extractInteractionQuery(payload);
  if (query !== undefined) {
    writeFrame(encodeInteractionQueryReply(query.id, query.queryField));
    return;
  }

  // 2) KV get/set — ack empty so blob round-trips cannot stall the turn.
  const kv = extractKvMessage(payload);
  if (kv !== undefined) {
    writeFrame(encodeKvReply(kv.id, kv.caseField));
    return;
  }

  // 3) Exec channel: request context, client MCP tools, or reject native exec.
  const exec = extractExecMessage(payload);
  if (exec !== undefined) {
    if (exec.caseField === 10) {
      // requestContextArgs — advertise tools so Cursor can call mcp_superliora_*.
      writeFrame(encodeRequestContextReply(exec.id, exec.execId, tools));
      return;
    }
    if (exec.caseField === 11) {
      const tool = extractToolCall(payload);
      if (tool !== undefined) {
        // Client-tool bridge: surface the call; grace timer ends the Cursor turn (no mcpResult).
        yield {
          type: 'tool_call',
          name: tool.name,
          inputJson: tool.inputJson,
          ...(tool.toolCallId === undefined ? {} : { toolCallId: tool.toolCallId }),
        };
        return;
      }
      // Non-superliora MCP — reject so the stream does not hang.
      for (const frameOut of encodeNativeExecReject(exec.id, exec.execId, exec.caseField, exec.caseData)) {
        writeFrame(frameOut);
      }
      return;
    }
    for (const frameOut of encodeNativeExecReject(exec.id, exec.execId, exec.caseField, exec.caseData)) {
      writeFrame(frameOut);
    }
    return;
  }

  // 4) InteractionUpdate toolCallCompleted for SuperLiora MCP tools.
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

  // Progress frames (tokenDelta / heartbeat / toolCallStarted) only refresh idle.
  if (isCursorProgressPayload(payload)) {
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

function isPrematureClose(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  const msg = error.message.toLowerCase();
  return msg.includes('premature close') || (error as NodeJS.ErrnoException).code === 'ERR_STREAM_PREMATURE_CLOSE';
}

function waitForResponseHeaders(
  req: http2.ClientHttp2Stream,
  signal?: AbortSignal,
): Promise<number | undefined> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(cursorAbortedError());
      return;
    }
    let settled = false;
    const settle = (fn: () => void): void => {
      if (settled) return;
      settled = true;
      signal?.removeEventListener('abort', onAbort);
      fn();
    };
    const onAbort = (): void => {
      settle(() => reject(cursorAbortedError()));
    };
    signal?.addEventListener('abort', onAbort, { once: true });
    req.once('response', (headers) => {
      settle(() => {
        const status = headers[':status'];
        resolve(typeof status === 'number' ? status : undefined);
      });
    });
    req.once('error', (error) => {
      settle(() => {
        if (signal?.aborted) reject(cursorAbortedError());
        else reject(error);
      });
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
      reject(cursorAbortedError());
      return;
    }
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    const onAbort = (): void => {
      clearTimeout(timer);
      reject(cursorAbortedError());
    };
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}
