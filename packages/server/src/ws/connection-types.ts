import type { WebSocket } from 'ws';

import type { SessionCursor } from '@superliora/protocol';

import type {
  ILogService,
  TerminalAttachOptions,
  TerminalAttachSink,
} from '@superliora/agent-core';
import type { ISessionClientsService } from '#/services/gateway';

import type { EventEnvelope } from './protocol';

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

export const DEFAULT_PING_INTERVAL_MS = 30_000;

export const DEFAULT_PONG_TIMEOUT_MS = 10_000;

export const DEFAULT_MAX_EVENT_BUFFER = 1000;

/**
 * Soft cap (bytes) on the per-socket OS send buffer. Above this we consider
 * the client a "slow consumer" and start dropping volatile frames so a single
 * lagging subscriber can't balloon server memory on a high-throughput session
 * (e.g. a wide fan-out run producing many deltas). Durable frames are always
 * sent; the client re-syncs its snapshot if it missed volatiles.
 */
export const DEFAULT_MAX_BUFFERED_BYTES = 1_048_576;

/**
 * Once in slow-consumer mode, the buffer must drain back below this fraction
 * of the cap before volatile frames resume. Hysteresis prevents rapid
 * flapping around the threshold.
 */
export const SLOW_CONSUMER_RECOVER_RATIO = 0.5;

/** Minimal surface handlers delegate to on a live {@link WsConnection}. */
export interface WsConnectionHost {
  readonly id: string;
  readonly subscriptions: Set<string>;
  readonly cursorsBySession: Map<string, SessionCursor>;
  readonly logger: ILogService;
  readonly wsBroadcast: BufferReplaySource;
  readonly fsWatchHandler: FsWatchHandler | undefined;
  readonly terminalHandler: TerminalHandler | undefined;
  readonly abortHandler: AbortHandler | undefined;
  send(message: unknown): void;
  sendControlFrame(message: unknown): void;
  subscribe(sid: string): void;
  unsubscribe(sid: string): void;
  markClientHelloReceived(): void;
}
