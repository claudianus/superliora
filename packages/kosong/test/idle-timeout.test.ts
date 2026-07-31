import { APITimeoutError } from '#/errors';
import {
  DEFAULT_LLM_IDLE_TIMEOUT_MS,
  LLM_IDLE_TIMEOUT_ENV,
  resolveIdleTimeoutMs,
  withIdleTimeout,
} from '#/idle-timeout';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

async function* chunksWithGaps(values: ReadonlyArray<{ value: number; delayMs: number }>): AsyncGenerator<number> {
  for (const { value, delayMs } of values) {
    await sleep(delayMs);
    yield value;
  }
}

function stalledStream(): AsyncIterable<number> {
  return {
    async *[Symbol.asyncIterator](): AsyncGenerator<number> {
      yield 1;
      // Simulate a gateway that holds the connection open but stops sending.
      await new Promise<void>(() => {});
    },
  };
}

async function collect<T>(stream: AsyncIterable<T>): Promise<T[]> {
  const out: T[] = [];
  for await (const value of stream) out.push(value);
  return out;
}

describe('resolveIdleTimeoutMs', () => {
  const originalEnv = process.env[LLM_IDLE_TIMEOUT_ENV];

  beforeEach(() => {
    delete process.env[LLM_IDLE_TIMEOUT_ENV];
  });

  afterEach(() => {
    if (originalEnv === undefined) delete process.env[LLM_IDLE_TIMEOUT_ENV];
    else process.env[LLM_IDLE_TIMEOUT_ENV] = originalEnv;
  });

  it('prefers the explicit per-request value, including 0 (disabled)', () => {
    process.env[LLM_IDLE_TIMEOUT_ENV] = '5000';
    expect(resolveIdleTimeoutMs(42)).toBe(42);
    expect(resolveIdleTimeoutMs(0)).toBe(0);
  });

  it('falls back to the environment variable', () => {
    process.env[LLM_IDLE_TIMEOUT_ENV] = '750';
    expect(resolveIdleTimeoutMs(undefined)).toBe(750);
    process.env[LLM_IDLE_TIMEOUT_ENV] = '0';
    expect(resolveIdleTimeoutMs(undefined)).toBe(0);
  });

  it('falls back to the default when the env var is unset, blank, or unparsable', () => {
    expect(resolveIdleTimeoutMs(undefined)).toBe(DEFAULT_LLM_IDLE_TIMEOUT_MS);
    process.env[LLM_IDLE_TIMEOUT_ENV] = '   ';
    expect(resolveIdleTimeoutMs(undefined)).toBe(DEFAULT_LLM_IDLE_TIMEOUT_MS);
    process.env[LLM_IDLE_TIMEOUT_ENV] = 'not-a-number';
    expect(resolveIdleTimeoutMs(undefined)).toBe(DEFAULT_LLM_IDLE_TIMEOUT_MS);
    process.env[LLM_IDLE_TIMEOUT_ENV] = '-100';
    expect(resolveIdleTimeoutMs(undefined)).toBe(DEFAULT_LLM_IDLE_TIMEOUT_MS);
  });

  it('defaults to 120 seconds', () => {
    expect(DEFAULT_LLM_IDLE_TIMEOUT_MS).toBe(120_000);
  });
});

describe('withIdleTimeout', () => {
  const originalEnv = process.env[LLM_IDLE_TIMEOUT_ENV];

  beforeEach(() => {
    delete process.env[LLM_IDLE_TIMEOUT_ENV];
  });

  afterEach(() => {
    if (originalEnv === undefined) delete process.env[LLM_IDLE_TIMEOUT_ENV];
    else process.env[LLM_IDLE_TIMEOUT_ENV] = originalEnv;
  });

  it('passes a fast stream through unchanged', async () => {
    const stream = chunksWithGaps([
      { value: 1, delayMs: 5 },
      { value: 2, delayMs: 5 },
      { value: 3, delayMs: 5 },
    ]);
    await expect(collect(withIdleTimeout(stream, { idleMs: 1000 }))).resolves.toEqual([1, 2, 3]);
  });

  it('resets the idle timer on every chunk', async () => {
    // Each gap (20ms) stays under the budget (60ms); total runtime exceeds it.
    const stream = chunksWithGaps([
      { value: 1, delayMs: 20 },
      { value: 2, delayMs: 20 },
      { value: 3, delayMs: 20 },
      { value: 4, delayMs: 20 },
    ]);
    await expect(collect(withIdleTimeout(stream, { idleMs: 60 }))).resolves.toEqual([1, 2, 3, 4]);
  });

  it('throws APITimeoutError when the stream stalls beyond idleMs', async () => {
    const started = Date.now();
    const error = await collect(withIdleTimeout(stalledStream(), { idleMs: 30, label: 'test stream' })).catch(
      (error: unknown) => error,
    );
    expect(error).toBeInstanceOf(APITimeoutError);
    expect((error as Error).message).toContain('no data received for 30ms');
    expect((error as Error).message).toContain('test stream');
    expect(Date.now() - started).toBeGreaterThanOrEqual(25);
  });

  it('returns the original stream untouched when disabled with idleMs 0', async () => {
    const stream = chunksWithGaps([{ value: 7, delayMs: 20 }]);
    const wrapped = withIdleTimeout(stream, { idleMs: 0 });
    expect(wrapped).toBe(stream);
    await expect(collect(wrapped)).resolves.toEqual([7]);
  });

  it('honors the SUPERLIORA_LLM_IDLE_TIMEOUT_MS env default', async () => {
    process.env[LLM_IDLE_TIMEOUT_ENV] = '25';
    const error = await collect(withIdleTimeout(stalledStream())).catch((error: unknown) => error);
    expect(error).toBeInstanceOf(APITimeoutError);
    expect((error as Error).message).toContain('no data received for 25ms');
  });

  it('treats env 0 as disabled', async () => {
    process.env[LLM_IDLE_TIMEOUT_ENV] = '0';
    const stream = stalledStream();
    expect(withIdleTimeout(stream)).toBe(stream);
  });

  it('lets an explicit idleMs win over the env default', async () => {
    process.env[LLM_IDLE_TIMEOUT_ENV] = '5';
    const stream = chunksWithGaps([{ value: 9, delayMs: 30 }]);
    await expect(collect(withIdleTimeout(stream, { idleMs: 1000 }))).resolves.toEqual([9]);
  });

  it('rejects a pending chunk wait immediately when the signal aborts', async () => {
    const controller = new AbortController();
    const pending = collect(withIdleTimeout(stalledStream(), { idleMs: 5000, signal: controller.signal }));
    pending.catch(() => {});
    await sleep(10);
    controller.abort();
    const error = await pending.catch((error: unknown) => error);
    expect(error).toBeInstanceOf(DOMException);
    expect((error as DOMException).name).toBe('AbortError');
  });

  it('rejects immediately when the signal is already aborted', async () => {
    const controller = new AbortController();
    controller.abort();
    const error = await collect(
      withIdleTimeout(chunksWithGaps([{ value: 1, delayMs: 5 }]), { idleMs: 1000, signal: controller.signal }),
    ).catch((error: unknown) => error);
    expect((error as DOMException).name).toBe('AbortError');
  });

  it('propagates underlying stream errors', async () => {
    async function* failing(): AsyncGenerator<number> {
      yield 1;
      throw new Error('upstream exploded');
    }
    const error = await collect(withIdleTimeout(failing(), { idleMs: 1000 })).catch((error: unknown) => error);
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toBe('upstream exploded');
  });

  it('propagates return() to the underlying iterator for cleanup', async () => {
    let finalized = false;
    async function* tracked(): AsyncGenerator<number> {
      try {
        yield 1;
        yield 2;
      } finally {
        finalized = true;
      }
    }
    const iterator = withIdleTimeout(tracked(), { idleMs: 1000 })[Symbol.asyncIterator]();
    const first = await iterator.next();
    expect(first.value).toBe(1);
    await iterator.return?.(undefined);
    expect(finalized).toBe(true);
  });
});
