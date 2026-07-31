import { describe, expect, it } from 'vitest';

import {
  abortAckMessageSchema,
  abortMessageSchema,
  clientHelloAckMessageSchema,
  clientHelloMessageSchema,
  cursorsBySessionSchema,
  pingMessageSchema,
  pongMessageSchema,
  resyncRequiredMessageSchema,
  serverHelloMessageSchema,
  sessionCursorSchema,
  subscribeMessageSchema,
  terminalAttachMessageSchema,
  terminalCloseMessageSchema,
  terminalDetachMessageSchema,
  terminalExitMessageSchema,
  terminalInputMessageSchema,
  terminalOutputMessageSchema,
  terminalResizeMessageSchema,
  unsubscribeMessageSchema,
  watchFsAckMessageSchema,
  watchFsAddMessageSchema,
  watchFsRemoveMessageSchema,
  wsErrorMessageSchema,
  WS_PROTOCOL_VERSION,
} from '../ws-control';

describe('protocol/ws-control — wire protocol constants and cursors', () => {
  it('WS_PROTOCOL_VERSION is a positive integer', () => {
    expect(typeof WS_PROTOCOL_VERSION).toBe('number');
    expect(WS_PROTOCOL_VERSION).toBeGreaterThan(0);
  });

  it('sessionCursorSchema requires non-negative seq', () => {
    expect(() => sessionCursorSchema.parse({ seq: -1 })).toThrow();
    expect(sessionCursorSchema.parse({ seq: 0, epoch: 'e-1' }).epoch).toBe('e-1');
  });

  it('cursorsBySessionSchema wraps a record of cursors', () => {
    const c = cursorsBySessionSchema.parse({
      's-1': { seq: 0, epoch: 'e-1' },
    });
    expect(c['s-1']?.epoch).toBe('e-1');
  });
});

describe('protocol/ws-control — handshake messages', () => {
  it('serverHelloMessageSchema requires literal type + protocol_version', () => {
    const m = serverHelloMessageSchema.parse({
      type: 'server_hello',
      timestamp: '2026-01-01T00:00:00Z',
      payload: {
        ws_connection_id: 'conn-1',
        protocol_version: WS_PROTOCOL_VERSION,
        heartbeat_ms: 5000,
        max_event_buffer_size: 1000,
        capabilities: { event_batching: true, compression: false },
      },
    });
    expect(m.payload.protocol_version).toBe(WS_PROTOCOL_VERSION);
  });

  it('clientHelloMessageSchema requires id and client_id', () => {
    const m = clientHelloMessageSchema.parse({
      type: 'client_hello',
      id: 'c-1',
      payload: {
        client_id: 'cli-1',
        subscriptions: [],
      },
    });
    expect(m.id).toBe('c-1');
  });

  it('clientHelloAckMessageSchema requires literal ack + integer code + accepted_subscriptions', () => {
    const m = clientHelloAckMessageSchema.parse({
      type: 'ack',
      id: 'c-1',
      code: 0,
      msg: 'ok',
      payload: { accepted_subscriptions: [], resync_required: [] },
    });
    expect(m.code).toBe(0);
  });
});

describe('protocol/ws-control — subscribe/unsubscribe', () => {
  it('subscribeMessageSchema accepts a single session id', () => {
    const m = subscribeMessageSchema.parse({
      type: 'subscribe',
      id: 's-1',
      payload: { session_ids: ['s-1'] },
    });
    expect(m.type).toBe('subscribe');
  });

  it('unsubscribeMessageSchema accepts an array of session ids', () => {
    const m = unsubscribeMessageSchema.parse({
      type: 'unsubscribe',
      id: 'u-1',
      payload: { session_ids: ['s-1'] },
    });
    expect(m.payload.session_ids).toEqual(['s-1']);
  });
});

describe('protocol/ws-control — fs watch + abort', () => {
  it('watchFsAddMessageSchema requires session_id and paths', () => {
    const m = watchFsAddMessageSchema.parse({
      type: 'watch_fs_add',
      id: 'w-1',
      payload: { session_id: 's-1', paths: ['/a'] },
    });
    expect(m.payload.session_id).toBe('s-1');
  });

  it('watchFsRemoveMessageSchema requires session_id and paths', () => {
    const m = watchFsRemoveMessageSchema.parse({
      type: 'watch_fs_remove',
      id: 'w-1',
      payload: { session_id: 's-1', paths: ['/a'] },
    });
    expect(m.type).toBe('watch_fs_remove');
  });

  it('watchFsAckMessageSchema accepts empty payload', () => {
    const m = watchFsAckMessageSchema.parse({
      type: 'ack',
      id: 'w-1',
      code: 0,
      msg: 'ok',
      payload: {},
    });
    expect(m.code).toBe(0);
  });

  it('abortMessageSchema requires session_id and prompt_id', () => {
    const m = abortMessageSchema.parse({
      type: 'abort',
      id: 'a-1',
      payload: { session_id: 's-1', prompt_id: 'p-1' },
    });
    expect(m.payload.prompt_id).toBe('p-1');
  });

  it('abortAckMessageSchema accepts aborted + at_seq', () => {
    const m = abortAckMessageSchema.parse({
      type: 'ack',
      id: 'a-1',
      code: 0,
      msg: 'ok',
      payload: { aborted: true, at_seq: 5 },
    });
    expect(m.payload.aborted).toBe(true);
  });
});

describe('protocol/ws-control — terminal messages', () => {
  it('terminalAttachMessageSchema requires session_id and terminal_id', () => {
    const m = terminalAttachMessageSchema.parse({
      type: 'terminal_attach',
      id: 't-1',
      payload: { session_id: 's-1', terminal_id: 'term-1' },
    });
    expect(m.payload.terminal_id).toBe('term-1');
  });

  it('terminalDetachMessageSchema requires session_id and terminal_id', () => {
    const m = terminalDetachMessageSchema.parse({
      type: 'terminal_detach',
      id: 't-1',
      payload: { session_id: 's-1', terminal_id: 'term-1' },
    });
    expect(m.payload.terminal_id).toBe('term-1');
  });

  it('terminalInputMessageSchema requires session_id, terminal_id, and data', () => {
    const m = terminalInputMessageSchema.parse({
      type: 'terminal_input',
      id: 't-1',
      payload: { session_id: 's-1', terminal_id: 'term-1', data: 'a' },
    });
    expect(m.payload.data).toBe('a');
  });

  it('terminalResizeMessageSchema requires positive cols/rows', () => {
    expect(() =>
      terminalResizeMessageSchema.parse({
        type: 'terminal_resize',
        id: 't-1',
        payload: { session_id: 's-1', terminal_id: 'term-1', cols: 0, rows: 0 },
      }),
    ).toThrow();
    const m = terminalResizeMessageSchema.parse({
      type: 'terminal_resize',
      id: 't-1',
      payload: { session_id: 's-1', terminal_id: 'term-1', cols: 80, rows: 24 },
    });
    expect(m.payload.cols).toBe(80);
  });

  it('terminalCloseMessageSchema requires session_id and terminal_id', () => {
    const m = terminalCloseMessageSchema.parse({
      type: 'terminal_close',
      id: 't-1',
      payload: { session_id: 's-1', terminal_id: 'term-1' },
    });
    expect(m.type).toBe('terminal_close');
  });

  it('terminalOutputMessageSchema accepts a base64 data string', () => {
    const m = terminalOutputMessageSchema.parse({
      type: 'terminal_output',
      seq: 1,
      session_id: 's-1',
      terminal_id: 'term-1',
      timestamp: '2026-01-01T00:00:00Z',
      payload: { data: 'aGk=' },
    });
    expect(m.payload.data).toBe('aGk=');
  });

  it('terminalExitMessageSchema accepts a numeric exit code', () => {
    const m = terminalExitMessageSchema.parse({
      type: 'terminal_exit',
      session_id: 's-1',
      terminal_id: 'term-1',
      timestamp: '2026-01-01T00:00:00Z',
      payload: { exit_code: 0 },
    });
    expect(m.payload.exit_code).toBe(0);
  });
});

describe('protocol/ws-control — system messages', () => {
  it('pingMessageSchema requires nonce', () => {
    const m = pingMessageSchema.parse({
      type: 'ping',
      timestamp: '2026-01-01T00:00:00Z',
      payload: { nonce: 'n-1' },
    });
    expect(m.payload.nonce).toBe('n-1');
  });

  it('pongMessageSchema requires nonce', () => {
    const m = pongMessageSchema.parse({
      type: 'pong',
      payload: { nonce: 'n-1' },
    });
    expect(m.payload.nonce).toBe('n-1');
  });

  it('resyncRequiredMessageSchema requires reason and session_id', () => {
    const m = resyncRequiredMessageSchema.parse({
      type: 'resync_required',
      timestamp: '2026-01-01T00:00:00Z',
      payload: {
        session_id: 's-1',
        reason: 'buffer_overflow',
        current_seq: 0,
      },
    });
    expect(m.payload.reason).toBe('buffer_overflow');
  });

  it('wsErrorMessageSchema requires integer code and message and fatal', () => {
    const m = wsErrorMessageSchema.parse({
      type: 'error',
      timestamp: '2026-01-01T00:00:00Z',
      payload: { code: 40001, msg: 'validation.failed', fatal: false },
    });
    expect(m.payload.code).toBe(40001);
  });
});
