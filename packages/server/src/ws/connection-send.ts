import type { WebSocket } from 'ws';

import type { ILogService } from '@superliora/agent-core';

import { buildResyncRequired } from './protocol';
import { isVolatileEnvelope } from './frame-guards';
import {
  SLOW_CONSUMER_RECOVER_RATIO,
  type BufferReplaySource,
} from './connection-types';

export interface SendContext {
  readonly socket: WebSocket;
  readonly logger: ILogService;
  readonly wsBroadcast: BufferReplaySource;
  readonly subscriptions: Set<string>;
  readonly maxBufferedBytes: number;
  readonly pongTimeoutMs: number;
  isClosed(): boolean;
  isSlowConsumer(): boolean;
  setSlowConsumer(value: boolean): void;
  clearPongTimer(): void;
  setPongTimer(timer: NodeJS.Timeout | undefined): void;
}

export function sendFrame(ctx: SendContext, message: unknown): void {
  if (ctx.isClosed()) return;
  if (ctx.socket.readyState !== ctx.socket.OPEN) return;

  // Backpressure defence: if the OS send buffer is already large, drop
  // volatile frames (deltas / progress) rather than letting one slow
  // subscriber balloon server memory. Durable frames, acks, and control
  // messages are always sent — a dropped durable would corrupt the seq
  // watermark contract. A slow-consumer `resync_required` is emitted once
  // on entry so the client rebuilds its view from the snapshot.
  updateSlowConsumer(ctx);
  if (ctx.isSlowConsumer() && isVolatileEnvelope(message)) {
    return;
  }

  sendControlFrame(ctx, message);
}

/**
 * Send a frame that must bypass the slow-consumer volatile drop (control
 * frames, the resync notice itself). Mirrors {@link sendFrame} minus the
 * backpressure gate.
 */
export function sendControlFrame(ctx: SendContext, message: unknown): void {
  if (ctx.isClosed()) return;
  if (ctx.socket.readyState !== ctx.socket.OPEN) return;
  try {
    ctx.socket.send(JSON.stringify(message), (err) => {
      if (err) ctx.logger.warn({ err: String(err) }, 'ws send failed');
    });
  } catch (err) {
    ctx.logger.warn({ err: String(err) }, 'ws send threw');
  }
}

/**
 * Enter slow-consumer mode when `bufferedAmount` exceeds the cap, leave it
 * when it drains back below the recovery threshold (hysteresis). Entering
 * emits a single `resync_required(slow_consumer)` per subscribed session
 * so the client knows volatile frames may have been dropped and can
 * rebuild from the snapshot.
 */
function updateSlowConsumer(ctx: SendContext): void {
  const buffered = ctx.socket.bufferedAmount;
  if (!ctx.isSlowConsumer()) {
    if (buffered > ctx.maxBufferedBytes) {
      ctx.setSlowConsumer(true);
      ctx.logger.info(
        { bufferedAmount: buffered, cap: ctx.maxBufferedBytes },
        'ws slow-consumer mode entered; volatile frames will be dropped',
      );
      notifySlowConsumerResync(ctx);
    }
  } else if (buffered < ctx.maxBufferedBytes * SLOW_CONSUMER_RECOVER_RATIO) {
    ctx.setSlowConsumer(false);
    ctx.logger.info(
      { bufferedAmount: buffered, threshold: ctx.maxBufferedBytes * SLOW_CONSUMER_RECOVER_RATIO },
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
function notifySlowConsumerResync(ctx: SendContext): void {
  for (const sid of ctx.subscriptions) {
    ctx.wsBroadcast.getCursor(sid).then(
      ({ seq, epoch }) => {
        sendControlFrame(ctx, buildResyncRequired(sid, 'slow_consumer', seq, epoch));
      },
      (err: unknown) => {
        ctx.logger.warn({ sid, err: String(err) }, 'ws slow-consumer resync cursor lookup failed');
      },
    );
  }
}
