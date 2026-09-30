/**
 * One event is fanned out to every subscriber of its session. The envelope was
 * serialized inside each connection's send, so N subscribers paid N identical
 * JSON passes for the same bytes; the fan-out now prepares the frame once and
 * each connection writes it.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { ILogService } from '@superliora/agent-core';

import {
  prepareFrame,
  sendControlFrame,
  sendFrame,
  type SendContext,
} from '../src/ws/connection-send';

const OPEN = 1;

function makeContext(sent: string[], bufferedAmount = 0): SendContext {
  const socket = {
    readyState: OPEN,
    OPEN,
    bufferedAmount,
    send: (data: string, cb?: (err?: Error) => void) => {
      sent.push(data);
      cb?.();
    },
  };
  const logger = {
    _serviceBrand: undefined,
    info: () => {},
    warn: () => {},
    error: () => {},
    debug: () => {},
    child() {
      return logger;
    },
  } as unknown as ILogService;
  let slowConsumer = false;
  return {
    socket: socket as never,
    logger,
    wsBroadcast: { getCursor: async () => ({ seq: 0, epoch: 'e' }) } as never,
    subscriptions: new Set<string>(),
    maxBufferedBytes: 1_000_000,
    pongTimeoutMs: 30_000,
    isClosed: () => false,
    isSlowConsumer: () => slowConsumer,
    setSlowConsumer: (value) => {
      slowConsumer = value;
    },
    clearPongTimer: () => {},
    setPongTimer: () => {},
  };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('prepared frame fan-out', () => {
  it('writes one serialization to every subscriber instead of re-serializing', () => {
    const sent: string[] = [];
    const ctx = makeContext(sent);
    const envelope = { type: 'agent.text.delta', seq: 7, volatile: true, payload: { text: 'hi' } };
    const frame = prepareFrame(envelope);

    const stringify = vi.spyOn(JSON, 'stringify');
    try {
      // Three subscribers of the same session, each handed the same prepared
      // frame (the connection keeps the envelope as its first argument).
      sendFrame(ctx, envelope, frame);
      sendFrame(ctx, envelope, frame);
      sendFrame(ctx, envelope, frame);
    } finally {
      stringify.mockRestore();
    }

    expect(sent).toEqual([frame.json, frame.json, frame.json]);
    expect(stringify).not.toHaveBeenCalled();
  });

  it('still drops a prepared volatile frame for a slow consumer', () => {
    const sent: string[] = [];
    const ctx = makeContext(sent, 10_000_000);
    const delta = { type: 'agent.text.delta' };
    const snapshot = { type: 'event.snapshot' };

    sendFrame(ctx, delta, prepareFrame({ ...delta, volatile: true }));

    expect(sent).toEqual([]);
    // A durable frame rides the same gate and is still written.
    sendControlFrame(ctx, snapshot, prepareFrame(snapshot));
    expect(sent).toHaveLength(1);
  });
});