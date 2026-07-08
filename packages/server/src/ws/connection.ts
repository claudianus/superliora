

import type { RawData, WebSocket } from 'ws';
import { ulid } from 'ulid';

import {
  ErrorCode,
  WS_PROTOCOL_VERSION,
  type AbortMessage,
  type ClientHelloMessage,
  type ClientControlMessage,
  type CursorsBySession,
  type SessionCursor,
  type SubscribeMessage,
  type TerminalAttachMessage,
  type TerminalCloseMessage,
  type TerminalDetachMessage,
  type TerminalInputMessage,
  type TerminalResizeMessage,
  type UnsubscribeMessage,
  type WatchFsAddMessage,
  type WatchFsRemoveMessage,
  getClientControlOperation,
} from '@superliora/protocol';

import type {
  ILogService,
  TerminalAttachOptions,
  TerminalAttachSink,
} from '@superliora/agent-core';
import type { ISessionClientsService } from '#/services/gateway';

import {
  buildAck,
  buildPing,
  buildResyncRequired,
  buildServerHello,
  type EventEnvelope,
} from './protocol';
import { rawDataToString } from './rawData';

export interface BufferReplaySource {
  getBufferedSince(
    sessionId: string,
    cursor: SessionCursor,
  ): Promise<{
    events: Array<{ seq: number; envelope: EventEnvelope }>;
    resyncRequired: 'buffer_overflow' | 'session_recreated' | 'epoch_changed' | false;
    currentSeq: number;
    epoch: string;
  }>;

  getCursor(sessionId: string): Promise<{ seq: number; epoch: string }>;
}

/** Reason values the broadcast layer can surface for `resync_required`. */
export type BroadcastResyncReason = 'buffer_overflow' | 'session_recreated' | 'epoch_changed';

export interface AbortHandler {
  abort(
    sessionId: string,
    promptId: string,
  ): Promise<{ aborted: boolean; at_seq?: number }>;

  currentSeq(sessionId: string): number;
}

export interface FsWatchHandler {
  add(
    sessionId: string,
    connectionId: string,
    wirePaths: readonly string[],
  ): Promise<FsWatchResult>;
  remove(
    sessionId: string,
    connectionId: string,
    wirePaths: readonly string[],
  ): Promise<FsWatchResult>;
  cleanupConnection(connectionId: string): void;
}

export type FsWatchResult =
  | { ok: true; watched_paths: string[]; current_count: number }
  | { ok: false; code: number; msg: string };

export interface TerminalHandler {
  attach(
    sessionId: string,
    terminalId: string,
    sink: TerminalAttachSink,
    options?: TerminalAttachOptions,
  ): Promise<{ replayed: number }>;
  detach(sessionId: string, terminalId: string, sinkId: string): void;
  cleanupConnection(sinkId: string): void;
  write(sessionId: string, terminalId: string, data: string): Promise<void>;
  resize(sessionId: string, terminalId: string, cols: number, rows: number): Promise<void>;
  close(sessionId: string, terminalId: string): Promise<{ closed: true }>;
}

export interface WsConnectionOptions {
  socket: WebSocket;
  logger: ILogService;

  sessionClients: ISessionClientsService;

  wsBroadcast: BufferReplaySource;

  abortHandler?: AbortHandler;

  fsWatchHandler?: FsWatchHandler;

  terminalHandler?: TerminalHandler;

  pingIntervalMs?: number;

  pongTimeoutMs?: number;

  maxEventBufferSize?: number;

  /**
   * Soft cap on the per-socket send buffer (bytes). When the underlying
   * socket's `bufferedAmount` exceeds it, volatile frames are dropped until
   * the buffer drains back below the recovery threshold.
   */
  maxBufferedBytes?: number;

  /** Peer address from the upgrade socket. Null when unavailable. */
  remoteAddress?: string | null;

  /** `User-Agent` header from the upgrade request. Null when absent. */
  userAgent?: string | null;
}

const DEFAULT_PING_INTERVAL_MS = 30_000;

const DEFAULT_PONG_TIMEOUT_MS = 10_000;

const DEFAULT_MAX_EVENT_BUFFER = 1000;

/**
 * Soft cap (bytes) on the per-socket OS send buffer. Above this we consider
 * the client a "slow consumer" and start dropping volatile frames so a single
 * lagging subscriber can't balloon server memory on a high-throughput session
 * (e.g. an UltraSwarm run fanning out many deltas). Durable frames are always
 * sent; the client re-syncs its snapshot if it missed volatiles.
 */
const DEFAULT_MAX_BUFFERED_BYTES = 1_048_576;

/**
 * Once in slow-consumer mode, the buffer must drain back below this fraction
 * of the cap before volatile frames resume. Hysteresis prevents rapid
 * flapping around the threshold.
 */
const SLOW_CONSUMER_RECOVER_RATIO = 0.5;

export class WsConnection {
  public readonly id: string;

  public readonly subscriptions = new Set<string>();

  /** Last cursor each subscribed session was synced from (client-claimed). */
  public readonly cursorsBySession = new Map<string, SessionCursor>();

  /** ISO 8601 UTC timestamp the socket was accepted at. */
  public readonly connectedAt: string;

  /** Peer address from the upgrade socket. Null when unavailable. */
  public readonly remoteAddress: string | null;

  /** `User-Agent` header from the upgrade request. Null when absent. */
  public readonly userAgent: string | null;

  private readonly socket: WebSocket;
  private readonly logger: ILogService;
  private readonly sessionClients: ISessionClientsService;
  private readonly wsBroadcast: BufferReplaySource;
  private readonly abortHandler: AbortHandler | undefined;
  private readonly fsWatchHandler: FsWatchHandler | undefined;
  private readonly terminalHandler: TerminalHandler | undefined;
  private readonly pingIntervalMs: number;
  private readonly pongTimeoutMs: number;
  private readonly maxEventBufferSize: number;
  private readonly maxBufferedBytes: number;

  private pingTimer?: NodeJS.Timeout;
  private pongTimer?: NodeJS.Timeout;
  private closed = false;
  private gotClientHello = false;

  /**
   * True while this socket is being treated as a slow consumer: volatile
   * frames are dropped and a single `resync_required(slow_consumer)` has
   * been sent so the client knows to rebuild its view from the snapshot.
   * Cleared (with hysteresis) once `bufferedAmount` drains.
   */
  private slowConsumer = false;

  constructor(opts: WsConnectionOptions) {
    this.id = `conn_${ulid()}`;
    this.connectedAt = new Date().toISOString();
    this.remoteAddress = opts.remoteAddress ?? null;
    this.userAgent = opts.userAgent ?? null;
    this.socket = opts.socket;
    this.logger = opts.logger.child({ connId: this.id });
    this.sessionClients = opts.sessionClients;
    this.wsBroadcast = opts.wsBroadcast;
    this.abortHandler = opts.abortHandler;
    this.fsWatchHandler = opts.fsWatchHandler;
    this.terminalHandler = opts.terminalHandler;
    this.pingIntervalMs = opts.pingIntervalMs ?? DEFAULT_PING_INTERVAL_MS;
    this.pongTimeoutMs = opts.pongTimeoutMs ?? DEFAULT_PONG_TIMEOUT_MS;
    this.maxEventBufferSize = opts.maxEventBufferSize ?? DEFAULT_MAX_EVENT_BUFFER;
    this.maxBufferedBytes = opts.maxBufferedBytes ?? DEFAULT_MAX_BUFFERED_BYTES;

    this.send(
      buildServerHello({
        ws_connection_id: this.id,
        protocol_version: WS_PROTOCOL_VERSION,
        heartbeat_ms: this.pingIntervalMs,
        max_event_buffer_size: this.maxEventBufferSize,
        capabilities: { event_batching: false, compression: false },
      }),
    );

    this.socket.on('message', (data) => this.onMessage(data));
    this.socket.on('close', (code, reason) => this.onClose(code, String(reason)));
    this.socket.on('error', (err) => this.logger.warn({ err: String(err) }, 'ws socket error'));

    this.startPingTimer();
  }

  private onMessage(data: RawData): void {
    if (this.closed) return;
    let parsed: unknown;
    try {
      parsed = JSON.parse(rawDataToString(data));
    } catch {
      this.logger.warn('non-json ws frame; ignoring');
      return;
    }
    const type = frameType(parsed);
    if (type === undefined) {
      this.logger.warn('invalid control message type');
      return;
    }
    const operation = getClientControlOperation(type);
    if (operation === undefined) {
      this.logger.warn({ type }, 'unknown control message type');
      return;
    }
    const result = operation.messageSchema.safeParse(parsed);
    if (!result.success) {
      this.logger.warn({ issues: result.error.issues.length }, 'invalid control message');
      return;
    }
    const msg = result.data as ClientControlMessage;
    switch (msg.type) {
      case 'client_hello':
        void this.onClientHello(msg).catch((err: unknown) => {
          this.logger.warn({ err: String(err) }, 'client_hello handler failed');
        });
        break;
      case 'pong':
        this.onPong();
        break;
      case 'subscribe':
        void this.onSubscribe(msg).catch((err: unknown) => {
          this.logger.warn({ err: String(err) }, 'subscribe handler failed');
        });
        break;
      case 'unsubscribe':
        this.onUnsubscribe(msg);
        break;
      case 'abort':
        this.onAbort(msg);
        break;
      case 'watch_fs_add':
        this.onWatchFsAdd(msg);
        break;
      case 'watch_fs_remove':
        this.onWatchFsRemove(msg);
        break;
      case 'terminal_attach':
        this.onTerminalAttach(msg);
        break;
      case 'terminal_detach':
        this.onTerminalDetach(msg);
        break;
      case 'terminal_input':
        this.onTerminalInput(msg);
        break;
      case 'terminal_resize':
        this.onTerminalResize(msg);
        break;
      case 'terminal_close':
        this.onTerminalClose(msg);
        break;
      default: {
        const exhaustive: never = msg;
        void exhaustive;
        this.logger.warn('unhandled control message type');
      }
    }
  }

  private async onClientHello(msg: ClientHelloMessage): Promise<void> {
    this.gotClientHello = true;
    const { subscriptions, cursors } = msg.payload;

    const sync = await this.syncSessions(subscriptions, cursors);

    this.logger.info(
      {
        acceptedCount: sync.accepted.length,
        resyncRequiredCount: sync.resyncRequired.length,
      },
      'client hello',
    );
    this.send(
      buildAck(msg.id, 0, 'success', {
        accepted_subscriptions: sync.accepted,
        resync_required: sync.resyncRequired,
        cursors: sync.serverCursors,
      }),
    );
  }

  /**
   * Shared client_hello/subscribe session sync:
   *   1. register the subscription FIRST (live events flow immediately;
   *      the client dedups overlap by seq),
   *   2. replay durable events past the client's cursor, or emit
   *      `resync_required` when the cursor cannot be served,
   *   3. report the server-side `{seq, epoch}` cursor for every accepted
   *      session so the client can adopt the current epoch.
   */
  private async syncSessions(
    sessionIds: readonly string[],
    cursors: CursorsBySession | undefined,
  ): Promise<{
    accepted: string[];
    resyncRequired: string[];
    serverCursors: CursorsBySession;
  }> {
    const accepted: string[] = [];
    const resyncRequired: string[] = [];
    const serverCursors: CursorsBySession = {};

    for (const sid of sessionIds) {
      if (!this.subscriptions.has(sid)) {
        this.subscribe(sid);
      }
      if (!accepted.includes(sid)) accepted.push(sid);
    }

    if (cursors) {
      for (const [sid, cursor] of Object.entries(cursors)) {
        this.cursorsBySession.set(sid, cursor);
        if (!this.subscriptions.has(sid)) {
          this.subscribe(sid);
        }
        if (!accepted.includes(sid)) accepted.push(sid);

        const result = await this.wsBroadcast.getBufferedSince(sid, cursor);
        if (result.resyncRequired !== false) {
          this.send(
            buildResyncRequired(sid, result.resyncRequired, result.currentSeq, result.epoch),
          );
          resyncRequired.push(sid);
        } else {
          for (const entry of result.events) {
            this.send(entry.envelope);
          }
        }
      }
    }

    for (const sid of accepted) {
      try {
        serverCursors[sid] = await this.wsBroadcast.getCursor(sid);
      } catch (err) {
        this.logger.warn({ sid, err: String(err) }, 'getCursor failed for ack');
      }
    }

    return { accepted, resyncRequired, serverCursors };
  }

  private async onSubscribe(msg: SubscribeMessage): Promise<void> {
    const { session_ids, cursors, watch_fs } = msg.payload;
    this.logger.info(
      { sessionIds: session_ids, cursors, hasWatchFs: !!watch_fs },
      'ws subscribe',
    );

    const sync = await this.syncSessions(session_ids, cursors);

    if (watch_fs && this.fsWatchHandler !== undefined) {
      for (const [sid, cfg] of Object.entries(watch_fs)) {
        if (cfg.paths.length === 0) continue;
        const handler = this.fsWatchHandler;
        void handler
          .add(sid, this.id, cfg.paths)
          .then((result) => {
            if (!result.ok) {
              this.logger.warn(
                { sid, code: result.code, msg: result.msg },
                'subscribe.watch_fs add failed; client should retry via watch_fs_add',
              );
            }
          })
          .catch((err: unknown) => {
            this.logger.warn(
              { sid, err: String(err) },
              'subscribe.watch_fs add threw',
            );
          });
      }
    }

    this.send(
      buildAck(msg.id, 0, 'success', {
        accepted: sync.accepted,
        not_found: [],
        resync_required: sync.resyncRequired,
        cursors: sync.serverCursors,
      }),
    );
  }

  private onUnsubscribe(msg: UnsubscribeMessage): void {
    const { session_ids } = msg.payload;
    for (const sid of session_ids) {
      this.unsubscribe(sid);
      this.cursorsBySession.delete(sid);

      if (this.fsWatchHandler !== undefined) {

        const handler = this.fsWatchHandler;
        void handler.remove(sid, this.id, []).catch((err: unknown) => {
          this.logger.warn(
            { sid, err: String(err) },
            'unsubscribe watch_fs drop threw',
          );
        });
      }
    }
    this.send(
      buildAck(msg.id, 0, 'success', {
        accepted: session_ids,
        not_found: [],
        resync_required: [],
      }),
    );
  }

  private onWatchFsAdd(msg: WatchFsAddMessage): void {
    if (this.fsWatchHandler === undefined) {
      this.send(
        buildAck(msg.id, ErrorCode.INTERNAL_ERROR, 'fs watch handler not wired', {}),
      );
      return;
    }
    const { session_id, paths } = msg.payload;
    const handler = this.fsWatchHandler;
    void handler
      .add(session_id, this.id, paths)
      .then((result) => {
        if (!result.ok) {
          this.send(buildAck(msg.id, result.code, result.msg, {}));
          return;
        }
        this.send(
          buildAck(msg.id, 0, 'success', {
            watched_paths: result.watched_paths,
            current_count: result.current_count,
          }),
        );
      })
      .catch((err: unknown) => {
        this.logger.warn({ err: String(err) }, 'watch_fs_add handler threw');
        this.send(
          buildAck(msg.id, ErrorCode.INTERNAL_ERROR, 'watch_fs_add failed', {}),
        );
      });
  }

  private onWatchFsRemove(msg: WatchFsRemoveMessage): void {
    if (this.fsWatchHandler === undefined) {
      this.send(
        buildAck(msg.id, ErrorCode.INTERNAL_ERROR, 'fs watch handler not wired', {}),
      );
      return;
    }
    const { session_id, paths } = msg.payload;
    const handler = this.fsWatchHandler;
    void handler
      .remove(session_id, this.id, paths)
      .then((result) => {
        if (!result.ok) {
          this.send(buildAck(msg.id, result.code, result.msg, {}));
          return;
        }
        this.send(
          buildAck(msg.id, 0, 'success', {
            watched_paths: result.watched_paths,
            current_count: result.current_count,
          }),
        );
      })
      .catch((err: unknown) => {
        this.logger.warn({ err: String(err) }, 'watch_fs_remove handler threw');
        this.send(
          buildAck(msg.id, ErrorCode.INTERNAL_ERROR, 'watch_fs_remove failed', {}),
        );
      });
  }

  private onAbort(msg: AbortMessage): void {
    const { session_id, prompt_id } = msg.payload;
    if (this.abortHandler === undefined) {
      this.send(
        buildAck(msg.id, ErrorCode.INTERNAL_ERROR, 'abort handler not wired', {}),
      );
      return;
    }
    void this.abortHandler
      .abort(session_id, prompt_id)
      .then((result) => {
        this.send(
          buildAck(msg.id, 0, 'success', {
            aborted: result.aborted,
            ...(result.at_seq !== undefined ? { at_seq: result.at_seq } : {}),
          }),
        );
      })
      .catch((err: unknown) => {
        if (
          typeof err === 'object' &&
          err !== null &&
          'name' in err &&
          (err as { name: string }).name === 'PromptAlreadyCompletedError'
        ) {
          const at_seq = this.abortHandler!.currentSeq(session_id);
          this.send(
            buildAck(msg.id, 0, 'success', { aborted: false, at_seq }),
          );
          return;
        }
        if (
          typeof err === 'object' &&
          err !== null &&
          'name' in err &&
          (err as { name: string }).name === 'PromptNotFoundError'
        ) {
          this.send(
            buildAck(msg.id, ErrorCode.PROMPT_NOT_FOUND, 'prompt not found', {}),
          );
          return;
        }
        if (
          typeof err === 'object' &&
          err !== null &&
          'name' in err &&
          (err as { name: string }).name === 'SessionNotFoundError'
        ) {
          this.send(
            buildAck(msg.id, ErrorCode.SESSION_NOT_FOUND, 'session not found', {}),
          );
          return;
        }
        this.logger.warn({ err: String(err) }, 'ws abort handler error');
        this.send(
          buildAck(msg.id, ErrorCode.INTERNAL_ERROR, 'abort failed', {}),
        );
      });
  }

  private onTerminalAttach(msg: TerminalAttachMessage): void {
    if (this.terminalHandler === undefined) {
      this.send(buildAck(msg.id, ErrorCode.INTERNAL_ERROR, 'terminal handler not wired', {}));
      return;
    }
    const { session_id, terminal_id, since_seq } = msg.payload;
    this.terminalHandler
      .attach(session_id, terminal_id, this, { sinceSeq: since_seq })
      .then((result) => {
        this.send(buildAck(msg.id, 0, 'success', {
          attached: true,
          replayed: result.replayed,
        }));
      })
      .catch((err: unknown) => {
        this.sendTerminalErrorAck(msg.id, err, 'terminal_attach failed');
      });
  }

  private onTerminalDetach(msg: TerminalDetachMessage): void {
    if (this.terminalHandler === undefined) {
      this.send(buildAck(msg.id, ErrorCode.INTERNAL_ERROR, 'terminal handler not wired', {}));
      return;
    }
    const { session_id, terminal_id } = msg.payload;
    try {
      this.terminalHandler.detach(session_id, terminal_id, this.id);
      this.send(buildAck(msg.id, 0, 'success', { detached: true }));
    } catch (err) {
      this.sendTerminalErrorAck(msg.id, err, 'terminal_detach failed');
    }
  }

  private onTerminalInput(msg: TerminalInputMessage): void {
    if (this.terminalHandler === undefined) {
      this.send(buildAck(msg.id, ErrorCode.INTERNAL_ERROR, 'terminal handler not wired', {}));
      return;
    }
    const { session_id, terminal_id, data } = msg.payload;
    this.terminalHandler
      .write(session_id, terminal_id, data)
      .then(() => {
        this.send(buildAck(msg.id, 0, 'success', { accepted: true }));
      })
      .catch((err: unknown) => {
        this.sendTerminalErrorAck(msg.id, err, 'terminal_input failed');
      });
  }

  private onTerminalResize(msg: TerminalResizeMessage): void {
    if (this.terminalHandler === undefined) {
      this.send(buildAck(msg.id, ErrorCode.INTERNAL_ERROR, 'terminal handler not wired', {}));
      return;
    }
    const { session_id, terminal_id, cols, rows } = msg.payload;
    this.terminalHandler
      .resize(session_id, terminal_id, cols, rows)
      .then(() => {
        this.send(buildAck(msg.id, 0, 'success', { resized: true }));
      })
      .catch((err: unknown) => {
        this.sendTerminalErrorAck(msg.id, err, 'terminal_resize failed');
      });
  }

  private onTerminalClose(msg: TerminalCloseMessage): void {
    if (this.terminalHandler === undefined) {
      this.send(buildAck(msg.id, ErrorCode.INTERNAL_ERROR, 'terminal handler not wired', {}));
      return;
    }
    const { session_id, terminal_id } = msg.payload;
    this.terminalHandler
      .close(session_id, terminal_id)
      .then((result) => {
        this.send(buildAck(msg.id, 0, 'success', result));
      })
      .catch((err: unknown) => {
        this.sendTerminalErrorAck(msg.id, err, 'terminal_close failed');
      });
  }

  private sendTerminalErrorAck(id: string, err: unknown, fallback: string): void {
    if (hasErrorName(err, 'TerminalNotFoundError')) {
      this.send(buildAck(id, ErrorCode.TERMINAL_NOT_FOUND, 'terminal not found', {}));
      return;
    }
    if (hasErrorName(err, 'SessionNotFoundError')) {
      this.send(buildAck(id, ErrorCode.SESSION_NOT_FOUND, 'session not found', {}));
      return;
    }
    this.logger.warn({ err: String(err) }, fallback);
    this.send(buildAck(id, ErrorCode.INTERNAL_ERROR, fallback, {}));
  }

  private subscribe(sid: string): void {
    if (this.subscriptions.has(sid)) return;
    this.subscriptions.add(sid);
    this.sessionClients.subscribe(this, sid);
  }

  private unsubscribe(sid: string): void {
    if (!this.subscriptions.has(sid)) return;
    this.subscriptions.delete(sid);
    this.sessionClients.unsubscribe(this, sid);
  }

  private startPingTimer(): void {
    this.pingTimer = setInterval(() => {
      if (this.closed) return;
      this.send(buildPing());

      if (this.pongTimer) clearTimeout(this.pongTimer);
      this.pongTimer = setTimeout(() => {
        if (this.closed) return;
        this.logger.warn('pong timeout — terminating socket');
        try {
          this.socket.terminate();
        } catch {

        }
      }, this.pongTimeoutMs);
      this.pongTimer.unref?.();
    }, this.pingIntervalMs);
    this.pingTimer.unref?.();
  }

  private onPong(): void {
    if (this.pongTimer) {
      clearTimeout(this.pongTimer);
      this.pongTimer = undefined;
    }
  }

  private onClose(code: number, reason: string): void {
    if (this.closed) return;
    this.closed = true;
    if (this.pingTimer) clearInterval(this.pingTimer);
    if (this.pongTimer) clearTimeout(this.pongTimer);

    this.sessionClients.forgetConnection(this);
    this.subscriptions.clear();

    if (this.fsWatchHandler !== undefined) {
      try {
        this.fsWatchHandler.cleanupConnection(this.id);
      } catch (err) {
        this.logger.warn(
          { err: String(err) },
          'fsWatchHandler.cleanupConnection threw',
        );
      }
    }
    if (this.terminalHandler !== undefined) {
      try {
        this.terminalHandler.cleanupConnection(this.id);
      } catch (err) {
        this.logger.warn(
          { err: String(err) },
          'terminalHandler.cleanupConnection threw',
        );
      }
    }
    this.logger.info({ code, reason, gotClientHello: this.gotClientHello }, 'connection closed');
  }

  public send(message: unknown): void {
    if (this.closed) return;
    if (this.socket.readyState !== this.socket.OPEN) return;

    // Backpressure defence: if the OS send buffer is already large, drop
    // volatile frames (deltas / progress) rather than letting one slow
    // subscriber balloon server memory. Durable frames, acks, and control
    // messages are always sent — a dropped durable would corrupt the seq
    // watermark contract. A slow-consumer `resync_required` is emitted once
    // on entry so the client rebuilds its view from the snapshot.
    this.updateSlowConsumer();
    if (this.slowConsumer && isVolatileEnvelope(message)) {
      return;
    }

    try {
      this.socket.send(JSON.stringify(message), (err) => {
        if (err) this.logger.warn({ err: String(err) }, 'ws send failed');
      });
    } catch (err) {
      this.logger.warn({ err: String(err) }, 'ws send threw');
    }
  }

  /**
   * Enter slow-consumer mode when `bufferedAmount` exceeds the cap, leave it
   * when it drains back below the recovery threshold (hysteresis). Entering
   * emits a single `resync_required(slow_consumer)` per subscribed session
   * so the client knows volatile frames may have been dropped and can
   * rebuild from the snapshot.
   */
  private updateSlowConsumer(): void {
    const buffered = this.socket.bufferedAmount;
    if (!this.slowConsumer) {
      if (buffered > this.maxBufferedBytes) {
        this.slowConsumer = true;
        this.logger.info(
          { bufferedAmount: buffered, cap: this.maxBufferedBytes },
          'ws slow-consumer mode entered; volatile frames will be dropped',
        );
        this.notifySlowConsumerResync();
      }
    } else if (buffered < this.maxBufferedBytes * SLOW_CONSUMER_RECOVER_RATIO) {
      this.slowConsumer = false;
      this.logger.info(
        { bufferedAmount: buffered, threshold: this.maxBufferedBytes * SLOW_CONSUMER_RECOVER_RATIO },
        'ws slow-consumer mode cleared; volatile frames resumed',
      );
    }
  }

  /**
   * Send a `resync_required(slow_consumer)` for every subscribed session so
   * the client drops its optimistic (delta-fed) state and rebuilds from the
   * durable snapshot. Sent directly (bypassing the slow-consumer drop) so it
   * is guaranteed to reach the client.
   */
  private notifySlowConsumerResync(): void {
    for (const sid of this.subscriptions) {
      this.wsBroadcast.getCursor(sid).then(
        ({ seq, epoch }) => {
          this.sendControlFrame(buildResyncRequired(sid, 'slow_consumer', seq, epoch));
        },
        (err: unknown) => {
          this.logger.warn({ sid, err: String(err) }, 'ws slow-consumer resync cursor lookup failed');
        },
      );
    }
  }

  /**
   * Send a frame that must bypass the slow-consumer volatile drop (control
   * frames, the resync notice itself). Mirrors {@link send} minus the
   * backpressure gate.
   */
  private sendControlFrame(message: unknown): void {
    if (this.closed) return;
    if (this.socket.readyState !== this.socket.OPEN) return;
    try {
      this.socket.send(JSON.stringify(message), (err) => {
        if (err) this.logger.warn({ err: String(err) }, 'ws send failed');
      });
    } catch (err) {
      this.logger.warn({ err: String(err) }, 'ws send threw');
    }
  }

  public close(code = 1000, reason?: string): void {
    if (this.closed) return;
    try {
      this.socket.close(code, reason);
    } catch {

    }

  }

  public get hasClientHello(): boolean {
    return this.gotClientHello;
  }
}

function frameType(value: unknown): string | undefined {
  if (typeof value !== 'object' || value === null || !('type' in value)) {
    return undefined;
  }
  const type = (value as { type?: unknown }).type;
  return typeof type === 'string' ? type : undefined;
}

function hasErrorName(err: unknown, name: string): boolean {
  return (
    typeof err === 'object' &&
    err !== null &&
    'name' in err &&
    (err as { name?: unknown }).name === name
  );
}

/**
 * Return true iff `message` is an outbound event envelope marked volatile
 * (deltas / progress / status). Only such frames are eligible for the
 * slow-consumer drop; durable events, acks, ping, and `resync_required`
 * itself must always be sent.
 */
function isVolatileEnvelope(message: unknown): boolean {
  return (
    typeof message === 'object' &&
    message !== null &&
    'volatile' in message &&
    (message as { volatile?: unknown }).volatile === true
  );
}
