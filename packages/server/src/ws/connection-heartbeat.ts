import type { WebSocket } from 'ws';

import type { ILogService } from '@superliora/agent-core';

import { buildPing } from './protocol';
import { sendControlFrame, type SendContext } from './connection-send';

export function startPingTimer(
  ctx: SendContext,
  pingIntervalMs: number,
  isClosed: () => boolean,
): NodeJS.Timeout {
  const pingTimer = setInterval(() => {
    if (isClosed()) return;
    sendControlFrame(ctx, buildPing());

    ctx.clearPongTimer();
    const pongTimer = setTimeout(() => {
      if (isClosed()) return;
      ctx.logger.warn('pong timeout — terminating socket');
      try {
        ctx.socket.terminate();
      } catch {

      }
    }, ctx.pongTimeoutMs);
    pongTimer.unref?.();
    ctx.setPongTimer(pongTimer);
  }, pingIntervalMs);
  pingTimer.unref?.();
  return pingTimer;
}

export function onPong(clearPongTimer: () => void): void {
  clearPongTimer();
}

export function logSocketError(logger: ILogService, err: unknown): void {
  logger.warn({ err: String(err) }, 'ws socket error');
}

export function attachSocketCloseHandler(
  socket: WebSocket,
  onClose: (code: number, reason: string) => void,
): void {
  socket.on('close', (code, reason) => onClose(code, String(reason)));
}
