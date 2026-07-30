import type { RawData, WebSocket } from 'ws';
import { ulid } from 'ulid';

import { WS_PROTOCOL_VERSION, type SessionCursor } from '@superliora/protocol';

import type { ILogService } from '@superliora/agent-core';
import type { ISessionClientsService } from '#/services/gateway';

import { buildServerHello } from './protocol';
import {
  DEFAULT_MAX_BUFFERED_BYTES,
  DEFAULT_MAX_EVENT_BUFFER,
  DEFAULT_PING_INTERVAL_MS,
  DEFAULT_PONG_TIMEOUT_MS,
  type AbortHandler,
  type BufferReplaySource,
  type BroadcastResyncReason,
  type FsWatchHandler,
  type FsWatchResult,
  type TerminalHandler,
  type WsConnectionHost,
  type WsConnectionOptions,
} from './connection-types';
import {
  attachSocketCloseHandler,
  logSocketError,
  onPong as clearPongOnMessage,
  startPingTimer,
} from './connection-heartbeat';
import { dispatchControlMessage } from './connection-message';
import { sendControlFrame, sendFrame, type SendContext } from './connection-send';

export type {
  AbortHandler,
  BufferReplaySource,
  BroadcastResyncReason,
  FsWatchHandler,
  FsWatchResult,
  TerminalHandler,
  WsConnectionOptions,
};

export class WsConnection implements WsConnectionHost {
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
  readonly logger: ILogService;
  private readonly sessionClients: ISessionClientsService;
  readonly wsBroadcast: BufferReplaySource;
  readonly abortHandler: AbortHandler | undefined;
  readonly fsWatchHandler: FsWatchHandler | undefined;
  readonly terminalHandler: TerminalHandler | undefined;
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
    attachSocketCloseHandler(this.socket, (code, reason) => this.onClose(code, reason));
    this.socket.on('error', (err) => logSocketError(this.logger, err));

    this.pingTimer = startPingTimer(this.sendContext(), this.pingIntervalMs, () => this.closed);
  }

  private sendContext(): SendContext {
    return {
      socket: this.socket,
      logger: this.logger,
      wsBroadcast: this.wsBroadcast,
      subscriptions: this.subscriptions,
      maxBufferedBytes: this.maxBufferedBytes,
      isClosed: () => this.closed,
      isSlowConsumer: () => this.slowConsumer,
      setSlowConsumer: (value) => {
        this.slowConsumer = value;
      },
      clearPongTimer: () => {
        if (this.pongTimer) {
          clearTimeout(this.pongTimer);
          this.pongTimer = undefined;
        }
      },
      setPongTimer: (timer) => {
        this.pongTimer = timer;
      },
      pongTimeoutMs: this.pongTimeoutMs,
    };
  }

  private onMessage(data: RawData): void {
    dispatchControlMessage(
      this,
      data,
      () => this.closed,
      () => clearPongOnMessage(() => {
        if (this.pongTimer) {
          clearTimeout(this.pongTimer);
          this.pongTimer = undefined;
        }
      }),
    );
  }

  subscribe(sid: string): void {
    if (this.subscriptions.has(sid)) return;
    this.subscriptions.add(sid);
    this.sessionClients.subscribe(this, sid);
  }

  unsubscribe(sid: string): void {
    if (!this.subscriptions.has(sid)) return;
    this.subscriptions.delete(sid);
    this.sessionClients.unsubscribe(this, sid);
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
    sendFrame(this.sendContext(), message);
  }

  sendControlFrame(message: unknown): void {
    sendControlFrame(this.sendContext(), message);
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

  markClientHelloReceived(): void {
    this.gotClientHello = true;
  }
}
