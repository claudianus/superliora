import { APITimeoutError } from '#/errors';
import { generate } from '#/generate';
import { createStreamLivenessGuard } from '#/idle-timeout';
import type { StreamedMessagePart } from '#/message';
import type { ChatProvider, StreamedMessage } from '#/provider';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
function fixture(parts: StreamedMessagePart[]) {
  let signal: AbortSignal | undefined;
  let pulls = 0;
  let released = false;
  const cancel = vi.fn();
  const stream: StreamedMessage & { cancel: typeof cancel } = {
    id: null, usage: null, finishReason: null, rawFinishReason: null, cancel,
    async *[Symbol.asyncIterator]() {
      try {
        for (const part of parts) { pulls++; yield part; }
      } finally { released = true; }
    },
  };
  const provider: ChatProvider = {
    name: 'request-lifetime-test', modelName: 'example-model', thinkingEffort: null,
    generate: async (_system, _tools, _history, options) => { signal = options?.signal; return stream; },
    withThinking() { return this; },
  };
  return { provider, stream, cancel, get signal() { return signal; }, get pulls() { return pulls; }, get released() { return released; } };
}
const budgetsOff = { streamOpenTimeoutMs: 0, streamIdleTimeoutMs: 0, firstTokenTimeoutMs: 0, streamMaxDurationMs: 0 };

beforeEach(() => { vi.useFakeTimers(); });
afterEach(() => { vi.useRealTimers(); });

describe('generate request-lifetime stream deadlines', () => {
  it('aborts transport and rejects idle timeout while a consumer is blocked, without pulling ahead', async () => {
    const f = fixture([{ type: 'text', text: 'first' }, { type: 'text', text: 'second' }]);
    const entered = deferred<void>();
    const consumer = deferred<void>();
    const onMessagePart = vi.fn(() => { entered.resolve(); return consumer.promise; });
    const outcome = generate(f.provider, '', [], [], { onMessagePart }, {
      ...budgetsOff, streamIdleTimeoutMs: 40, firstTokenTimeoutMs: 10,
    }).catch((error: unknown) => error);
    await entered.promise;
    await vi.advanceTimersByTimeAsync(20);
    expect(f.pulls).toBe(1);
    expect(f.signal?.aborted).toBe(false);
    await vi.advanceTimersByTimeAsync(20);
    const error = await outcome;
    expect(error).toBeInstanceOf(APITimeoutError);
    expect((error as Error).message).toContain('idle timeout');
    expect((error as Error).message).toContain('Provider: request-lifetime-test, model: example-model');
    expect(f.signal?.reason).toBe(error);
    expect(f.cancel).toHaveBeenCalledTimes(1);
    expect(f.released).toBe(true);
    expect(f.pulls).toBe(1);
    // The consumer's late rejection is handled and cannot restart the loop.
    consumer.reject(new Error('late consumer failure'));
    await vi.advanceTimersByTimeAsync(100);
    expect(onMessagePart).toHaveBeenCalledTimes(1);
    expect(f.cancel).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('preserves caller cancellation reason and releases the suspended iterator even with all budgets disabled', async () => {
    const f = fixture([{ type: 'text', text: 'first' }, { type: 'text', text: 'second' }]);
    const entered = deferred<void>();
    const consumer = deferred<void>();
    const controller = new AbortController();
    const outcome = generate(f.provider, '', [], [], {
      onMessagePart: () => { entered.resolve(); return consumer.promise; },
    }, { ...budgetsOff, signal: controller.signal }).catch((error: unknown) => error);
    await entered.promise;
    const reason = new DOMException('operator stop', 'AbortError');
    controller.abort(reason);
    expect(await outcome).toBe(reason);
    expect(f.signal?.reason).toBe(reason);
    expect(f.released).toBe(true);
    expect(f.cancel).toHaveBeenCalledTimes(1);
    consumer.resolve();
    await vi.advanceTimersByTimeAsync(1000);
    expect(f.pulls).toBe(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('waits for transport cancellation with a custom caller reason rather than a blocked callback', async () => {
    const f = fixture([{ type: 'text', text: 'first' }]);
    const entered = deferred<void>();
    const consumer = deferred<void>();
    const teardown = deferred<void>();
    f.cancel.mockImplementation(() => teardown.promise);
    const controller = new AbortController();
    let settled = false;
    const outcome = generate(f.provider, '', [], [], {
      onMessagePart: () => { entered.resolve(); return consumer.promise; },
    }, { ...budgetsOff, signal: controller.signal }).catch((error: unknown) => { settled = true; return error; });
    await entered.promise;
    const reason = new Error('session closed');
    controller.abort(reason);
    await vi.advanceTimersByTimeAsync(0);
    expect(f.cancel).toHaveBeenCalledTimes(1);
    expect(settled).toBe(false);
    teardown.resolve();
    expect(await outcome).toBe(reason);
    expect(f.released).toBe(true);
    consumer.resolve();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('cancels a pending next() even when timeouts are disabled and the producer ignores its signal', async () => {
    const f = fixture([]);
    const entered = deferred<void>();
    const chunk = deferred<IteratorResult<StreamedMessagePart>>();
    const returned = vi.fn(async () => ({ done: true as const, value: undefined }));
    f.stream[Symbol.asyncIterator] = () => ({
      next: () => { entered.resolve(); return chunk.promise; }, return: returned,
    });
    const controller = new AbortController();
    const outcome = generate(f.provider, '', [], [], undefined, { ...budgetsOff, signal: controller.signal })
      .catch((error: unknown) => error);
    await entered.promise;
    const reason = new Error('cancel pending read');
    controller.abort(reason);
    expect(await outcome).toBe(reason);
    expect(f.cancel).toHaveBeenCalledTimes(1);
    expect(returned).toHaveBeenCalledTimes(1);
    chunk.reject(new Error('late provider failure'));
    await vi.advanceTimersByTimeAsync(0);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('does not let a keepalive callback hide the first substantive-token deadline', async () => {
    const f = fixture([{ type: 'think', think: '' }, { type: 'text', text: 'later' }]);
    const entered = deferred<void>();
    const consumer = deferred<void>();
    const outcome = generate(f.provider, '', [], [], {
      onMessagePart: () => { entered.resolve(); return consumer.promise; },
    }, { ...budgetsOff, streamIdleTimeoutMs: 100, firstTokenTimeoutMs: 20 }).catch((error: unknown) => error);
    await entered.promise;
    await vi.advanceTimersByTimeAsync(20);
    const error = await outcome;
    expect(error).toBeInstanceOf(APITimeoutError);
    expect((error as Error).message).toContain('first-token timeout');
    expect(f.signal?.reason).toBe(error);
    expect(f.released).toBe(true);
    expect(f.pulls).toBe(1);
    consumer.resolve();
  });

  it('enforces the total-stream deadline across blocked consumers when silence budgets are disabled', async () => {
    const f = fixture([{ type: 'text', text: 'first' }]);
    const entered = deferred<void>();
    const consumer = deferred<void>();
    const outcome = generate(f.provider, '', [], [], {
      onMessagePart: () => { entered.resolve(); return consumer.promise; },
    }, { ...budgetsOff, streamMaxDurationMs: 30 }).catch((error: unknown) => error);
    await entered.promise;
    await vi.advanceTimersByTimeAsync(30);
    const error = await outcome;
    expect(error).toBeInstanceOf(APITimeoutError);
    expect((error as Error).message).toContain('duration timeout');
    expect(f.signal?.reason).toBe(error);
    expect(f.cancel).toHaveBeenCalledTimes(1);
    expect(f.released).toBe(true);
    consumer.resolve();
  });

  it('ends stream budgets before deferred tool-call callbacks while keeping caller cancellation live', async () => {
    const f = fixture([{ type: 'function', id: 'tool-1', name: 'example', arguments: '{}' }]);
    const entered = deferred<void>();
    const consumer = deferred<void>();
    const controller = new AbortController();
    const outcome = generate(f.provider, '', [], [], {
      onToolCall: () => { entered.resolve(); return consumer.promise; },
    }, { ...budgetsOff, streamIdleTimeoutMs: 5, firstTokenTimeoutMs: 5, streamMaxDurationMs: 10,
      signal: controller.signal }).catch((error: unknown) => error);
    await entered.promise;
    await vi.advanceTimersByTimeAsync(100);
    expect(f.signal?.aborted).toBe(false);
    expect(f.cancel).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
    const reason = new Error('stop deferred callback');
    controller.abort(reason);
    expect(await outcome).toBe(reason);
    consumer.resolve();
  });

  it('preserves callback backpressure and stops stream deadlines once the stream drains', async () => {
    const f = fixture([{ type: 'text', text: 'a' }, { type: 'text', text: 'b' }]);
    const entered = deferred<void>();
    const consumer = deferred<void>();
    const onMessagePart = vi.fn(() => { entered.resolve(); return consumer.promise; });
    const result = generate(f.provider, '', [], [], { onMessagePart }, { ...budgetsOff, streamIdleTimeoutMs: 40 });
    await entered.promise;
    await vi.advanceTimersByTimeAsync(20);
    expect(f.pulls).toBe(1);
    consumer.resolve();
    expect((await result).message.content).toEqual([{ type: 'text', text: 'ab' }]);
    expect(f.pulls).toBe(2);
    await vi.advanceTimersByTimeAsync(1000);
    expect(f.signal?.aborted).toBe(false);
    expect(f.cancel).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });
});

describe('request-lifetime deadline accounting', () => {
  it('resets silence on activity without extending the fixed total-stream cap', async () => {
    const onTimeout = vi.fn();
    const guard = createStreamLivenessGuard({ idleMs: 20, firstTokenMs: 5, maxDurationMs: 30, onTimeout });
    await vi.advanceTimersByTimeAsync(4);
    guard.activity();
    await vi.advanceTimersByTimeAsync(15);
    guard.activity();
    await vi.advanceTimersByTimeAsync(11);
    expect(onTimeout).toHaveBeenCalledTimes(1);
    expect((onTimeout.mock.calls[0]?.[0] as Error).message).toContain('duration timeout');
    guard.activity();
    await vi.advanceTimersByTimeAsync(1000);
    expect(onTimeout).toHaveBeenCalledTimes(1);
  });

  it('retains the tighter idle budget before the first token and disposes without firing', async () => {
    const onTimeout = vi.fn();
    const guard = createStreamLivenessGuard({ idleMs: 10, firstTokenMs: 100, maxDurationMs: 0, onTimeout });
    await vi.advanceTimersByTimeAsync(9);
    expect(onTimeout).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(onTimeout).toHaveBeenCalledTimes(1);
    guard.dispose();
    const disposed = createStreamLivenessGuard({ idleMs: 10, firstTokenMs: 10, maxDurationMs: 20, onTimeout });
    disposed.dispose();
    await vi.advanceTimersByTimeAsync(1000);
    expect(onTimeout).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });
});
