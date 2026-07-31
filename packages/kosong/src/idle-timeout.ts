import { APITimeoutError } from './errors';

/**
 * Default upper bound (ms) on the silence allowed between streamed chunks
 * before the stream is treated as stalled and aborted. Two minutes catches
 * gateways that hold a connection open without forwarding SSE chunks, while
 * staying clear of ordinary inter-chunk pauses. Override per request with
 * `streamIdleTimeoutMs`, or globally with the
 * `SUPERLIORA_LLM_IDLE_TIMEOUT_MS` environment variable (set it to `0` to
 * disable the watchdog entirely).
 */
export const DEFAULT_LLM_IDLE_TIMEOUT_MS = 120_000;

/** Environment variable that overrides the default idle-gap budget. */
export const LLM_IDLE_TIMEOUT_ENV = 'SUPERLIORA_LLM_IDLE_TIMEOUT_MS';

export interface IdleTimeoutOptions {
  /**
   * Maximum time (ms) to wait for the next chunk before aborting with an
   * {@link APITimeoutError}. The timer resets on every received chunk, so a
   * healthy slow stream is never killed — only a completely silent one.
   * `0` disables the watchdog and returns the stream unchanged. When omitted,
   * falls back to `SUPERLIORA_LLM_IDLE_TIMEOUT_MS`, then to
   * {@link DEFAULT_LLM_IDLE_TIMEOUT_MS}.
   */
  readonly idleMs?: number;
  /** Human-readable stream description appended to the timeout message. */
  readonly label?: string;
  /** Aborts a pending chunk wait immediately when the caller cancels. */
  readonly signal?: AbortSignal;
}

/**
 * Resolve the effective idle-gap budget: an explicit per-request value wins
 * (including `0` = disabled); otherwise the `SUPERLIORA_LLM_IDLE_TIMEOUT_MS`
 * environment variable; otherwise {@link DEFAULT_LLM_IDLE_TIMEOUT_MS}.
 * Unparsable or negative environment values fall back to the default rather
 * than disabling the watchdog by accident.
 */
export function resolveIdleTimeoutMs(explicit?: number): number {
  if (explicit !== undefined) return explicit;
  const raw = process.env[LLM_IDLE_TIMEOUT_ENV];
  if (raw === undefined || raw.trim().length === 0) return DEFAULT_LLM_IDLE_TIMEOUT_MS;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed < 0) return DEFAULT_LLM_IDLE_TIMEOUT_MS;
  return parsed;
}

function createAbortError(): DOMException {
  return new DOMException('The operation was aborted.', 'AbortError');
}

/**
 * Wrap an async iterable so a stalled producer cannot block the consumer
 * forever: if no chunk arrives within the idle budget, iteration rejects with
 * an {@link APITimeoutError}. The timer restarts on every chunk, measuring
 * only the wait for the next chunk (not consumer processing time).
 *
 * Pure transport guard: it does not know about providers or models — callers
 * pass a `label` for actionable messages. When disabled (`idleMs <= 0`) the
 * original stream is returned untouched.
 */
export function withIdleTimeout<T>(
  stream: AsyncIterable<T>,
  options: IdleTimeoutOptions = {},
): AsyncIterable<T> {
  const idleMs = resolveIdleTimeoutMs(options.idleMs);
  if (idleMs <= 0) return stream;

  const label = options.label;
  const signal = options.signal;

  return {
    [Symbol.asyncIterator](): AsyncIterator<T> {
      const iterator = stream[Symbol.asyncIterator]();

      return {
        next(): Promise<IteratorResult<T>> {
          if (signal?.aborted === true) {
            return Promise.reject(createAbortError());
          }

          const pending = iterator.next();
          // Swallow the rejection on the pending next() when the idle
          // timeout or abort wins the race — prevents an unhandled rejection
          // after the consumer moves on.
          pending.catch(() => {});

          return new Promise<IteratorResult<T>>((resolve, reject) => {
            let timer: ReturnType<typeof setTimeout> | undefined;

            const cleanup = (): void => {
              if (timer !== undefined) clearTimeout(timer);
              if (signal !== undefined) signal.removeEventListener('abort', onAbort);
            };

            const onAbort = (): void => {
              cleanup();
              reject(createAbortError());
            };

            if (signal !== undefined) {
              signal.addEventListener('abort', onAbort, { once: true });
            }

            timer = setTimeout(() => {
              cleanup();
              reject(
                new APITimeoutError(
                  `Stream idle timeout: no data received for ${String(idleMs)}ms.` +
                    (label !== undefined && label.length > 0 ? ` ${label}` : ''),
                ),
              );
            }, idleMs);

            pending.then(
              (result) => {
                cleanup();
                resolve(result);
              },
              (error: unknown) => {
                cleanup();
                reject(error);
              },
            );
          });
        },

        async return(value?: unknown): Promise<IteratorResult<T>> {
          if (iterator.return === undefined) {
            return { done: true, value: undefined } as IteratorResult<T>;
          }
          return iterator.return(value);
        },

        async throw(error?: unknown): Promise<IteratorResult<T>> {
          if (iterator.throw === undefined) throw error;
          return iterator.throw(error);
        },
      };
    },
  };
}
