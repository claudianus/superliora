/**
 * Unit tests for {@link WsConnection}'s slow-consumer backpressure defence.
 *
 * A real `ws.WebSocket` is hard to drive deterministically from a unit test
 * (network timing, OS buffer behaviour), so we inject a minimal stub socket
 * whose `bufferedAmount` we control directly and assert which outbound
 * frames are sent vs. dropped.
 */
import { EventEmitter } from 'node:events';

import { describe, expect, it } from 'vitest';

import type { ILogService } from '@superliora/agent-core';

import { WsConnection, type BufferReplaySource } from '../src/ws/connection';

/** Sentinel matching the `ws` library's `OPEN` readyState constant. */
const OPEN = 1;

class StubSocket extends EventEmitter {
  readyState = OPEN;
  readonly OPEN = OPEN;
  bufferedAmount: number;
  private readonly sent: string[];

  constructor(sent: string[], startBuffered = 0) {
    super();
    this.sent = sent;
    this.bufferedAmount = startBuffered;
  }

  send(data: string, cb?: (err?: Error) => void): void {
    this.sent.push(data);
    cb?.();
  }

  ping(): void {}
  terminate(): void {
    this.readyState = 3;
  }
  close(): void {
    this.readyState = 3;
  }
}

function makeSocket(startBuffered = 0): { socket: StubSocket; sent: string[] } {
  const sent: string[] = [];
  const socket = new StubSocket(sent, startBuffered);
  return { socket, sent };
}

function noopLogger(): ILogService {
  return {
    _serviceBrand: undefined,
    info(): void {},
    warn(): void {},
    error(): void {},
    debug(): void {},
    child(): ILogService {
      return this;
    },
  };
}

const stubBroadcast: BufferReplaySource = {
  async getBufferedSince() {
    return { events: [], resyncRequired: false, currentSeq: 0, epoch: 'e1' };
  },
  async getCursor() {
    return { seq: 0, epoch: 'e1' };
  },
};

function makeConnection(socket: StubSocket, opts: { maxBufferedBytes?: number } = {}): WsConnection {
  return new WsConnection({
    socket: socket as never,
    logger: noopLogger(),
    sessionClients: {
      _serviceBrand: undefined,
      subscribe(): void {},
      unsubscribe(): void {},
      getConnections(): Iterable<WsConnection> {
        return [];
      },
      forgetConnection(): void {},
      subscriberCount(): number {
        return 0;
      },
    } as never,
    wsBroadcast: stubBroadcast,
    maxBufferedBytes: opts.maxBufferedBytes,
    // Suppress the constructor's ping/pong heartbeat timers so the test
    // process can exit cleanly.
    pingIntervalMs: 3_600_000,
    pongTimeoutMs: 3_600_000,
  });
}

function parseFrames(sent: string[]): Array<{ type: string; payload?: { reason?: string } }> {
  return sent.map((raw) => JSON.parse(raw) as { type: string; payload?: { reason?: string } });
}

describe('WsConnection backpressure', () => {
  it('drops volatile frames but sends durable frames when the buffer exceeds the cap', () => {
    const { socket, sent } = makeSocket();
    const conn = makeConnection(socket, { maxBufferedBytes: 100 });
    // Discard the constructor's server_hello.
    sent.length = 0;

    // Over the cap → slow-consumer mode.
    socket.bufferedAmount = 200;

    conn.send({ type: 'assistant.delta', seq: 1, volatile: true, payload: {} });
    conn.send({ type: 'turn.started', seq: 2, payload: {} });

    const frames = parseFrames(sent);
    // The volatile delta is dropped; the durable turn.started is sent.
    expect(frames.some((f) => f.type === 'assistant.delta')).toBe(false);
    expect(frames.some((f) => f.type === 'turn.started')).toBe(true);
  });

  it('resumes volatile frames once the buffer drains below the recovery threshold', () => {
    const { socket, sent } = makeSocket();
    const conn = makeConnection(socket, { maxBufferedBytes: 100 });
    sent.length = 0;

    socket.bufferedAmount = 200;
    conn.send({ type: 'assistant.delta', seq: 1, volatile: true, payload: {} });
    expect(parseFrames(sent).some((f) => f.type === 'assistant.delta')).toBe(false);

    // Drain below 50% of the cap (hysteresis) → slow-consumer mode clears.
    socket.bufferedAmount = 40;
    conn.send({ type: 'assistant.delta', seq: 2, volatile: true, payload: {} });
    expect(parseFrames(sent).some((f) => f.type === 'assistant.delta')).toBe(true);
  });

  it('does not enter slow-consumer mode under the cap (sends volatile frames normally)', () => {
    const { socket, sent } = makeSocket();
    const conn = makeConnection(socket, { maxBufferedBytes: 100 });
    sent.length = 0;

    socket.bufferedAmount = 50;
    conn.send({ type: 'assistant.delta', seq: 1, volatile: true, payload: {} });
    expect(parseFrames(sent).some((f) => f.type === 'assistant.delta')).toBe(true);
  });
});
