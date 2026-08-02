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

/**
 * Default upper bound (ms) on waiting for `provider.generate()` to return a
 * stream object. This covers hung TCP/TLS handshakes and providers that never
 * resolve create() — a gap the per-chunk idle watchdog cannot see because it
 * only starts after the stream exists. Override per request with
 * `streamOpenTimeoutMs`, or globally with `SUPERLIORA_LLM_OPEN_TIMEOUT_MS`
 * (`0` disables).
 */
export const DEFAULT_LLM_OPEN_TIMEOUT_MS = 120_000;

/** Environment variable that overrides the default stream-open budget. */
export const LLM_OPEN_TIMEOUT_ENV = 'SUPERLIORA_LLM_OPEN_TIMEOUT_MS';

export interface IdleTimeoutOptions<T = unknown> {
  /**
   * Maximum time (ms) to wait for the next chunk before aborting with an
   * {@link APITimeoutError}. The timer resets on every received chunk that
   * {@link countsAsActivity} accepts (default: all chunks), so a healthy
   * slow stream is never killed — only a completely silent one. `0` disables
   * the watchdog and returns the stream unchanged. When omitted, falls back
   * to `SUPERLIORA_LLM_IDLE_TIMEOUT_MS`, then to
   * {@link DEFAULT_LLM_IDLE_TIMEOUT_MS}.
   */
  readonly idleMs?: number;
  /** Human-readable stream description appended to the timeout message. */
  readonly label?: string;
  /** Aborts a pending chunk wait immediately when the caller cancels. */
  readonly signal?: AbortSignal;
  /**
   * When provided, only chunks for which this returns true reset the idle
   * budget. Empty keepalives (e.g. zero-length think markers) still pass
   * through to the consumer but do not extend the silence window — so a
   * gateway that pings without real tokens cannot hold the loop open forever.
   */
  readonly countsAsActivity?: (chunk: T) => boolean;
}

/**
 * Resolve the effective idle-gap budget: an explicit per-request value wins
 * (including `0` = disabled); otherwise the `SUPERLIORA_LLM_IDLE_TIMEOUT_MS`
 * environment variable; otherwise {@link DEFAULT_LLM_IDLE_TIMEOUT_MS}.
 * Unparsable or negative environment values fall back to the default rather
 * than disabling the watchdog by accident.
 */
export function resolveIdleTimeoutMs(explicit?: number): number {
  return resolveTimeoutMs(explicit, LLM_IDLE_TIMEOUT_ENV, DEFAULT_LLM_IDLE_TIMEOUT_MS);
}

/**
 * Resolve the effective stream-open budget. Same precedence rules as
 * {@link resolveIdleTimeoutMs}.
 */
export function resolveOpenTimeoutMs(explicit?: number): number {
  return resolveTimeoutMs(explicit, LLM_OPEN_TIMEOUT_ENV, DEFAULT_LLM_OPEN_TIMEOUT_MS);
}

function resolveTimeoutMs(
  explicit: number | undefined,
  envKey: string,
  fallback: number,
): number {
  if (explicit !== undefined) return explicit;
  const raw = process.env[envKey];
  if (raw === undefined || raw.trim().length === 0) return fallback;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed < 0) return fallback;
  return parsed;
}

function createAbortError(): DOMException {
  return new DOMException('The operation was aborted.', 'AbortError');
}

function formatLabel(label: string | undefined): string {
  return label !== undefined && label.length > 0 ? ` ${label}` : '';
}

/**
 * Wrap an async iterable so a stalled producer cannot block the consumer
 * forever: if no activity chunk arrives within the idle budget, iteration
 * rejects with an {@link APITimeoutError}. The timer restarts on every
 * activity chunk (see {@link IdleTimeoutOptions.countsAsActivity}), measuring
 * only the wait for the next chunk (not consumer processing time).
 *
 * Pure transport guard: it does not know about providers or models — callers
 * pass a `label` for actionable messages. When disabled (`idleMs <= 0`) the
 * original stream is returned untouched.
 */
export function withIdleTimeout<T>(
  stream: AsyncIterable<T>,
  options: IdleTimeoutOptions<T> = {},
): AsyncIterable<T> {
  const idleMs = resolveIdleTimeoutMs(options.idleMs);
  if (idleMs <= 0) return stream;

  const label = options.label;
  const signal = options.signal;
  const countsAsActivity = options.countsAsActivity;

  return {
    [Symbol.asyncIterator](): AsyncIterator<T> {
      const iterator = stream[Symbol.asyncIterator]();
      // Absolute deadline for the next *activity* chunk. Empty keepalives do
      // not push this forward when countsAsActivity is set.
      let activityDeadlineMs = Date.now() + idleMs;

      return {
        next(): Promise<IteratorResult<T>> {
          if (signal?.aborted === true) {
            return Promise.reject(createAbortError());
          }

          const remainingMs = Math.max(0, activityDeadlineMs - Date.now());
          if (remainingMs <= 0) {
            return Promise.reject(
              new APITimeoutError(
                `Stream idle timeout: no data received for ${String(idleMs)}ms.` +
                  formatLabel(label),
              ),
            );
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
                    formatLabel(label),
                ),
              );
            }, remainingMs);

            pending.then(
              (result) => {
                cleanup();
                if (!result.done) {
                  const active =
                    countsAsActivity === undefined ? true : countsAsActivity(result.value);
                  if (active) {
                    activityDeadlineMs = Date.now() + idleMs;
                  }
                }
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

/**
 * Linked abort controller used for one generate call: caller cancel and the
 * stream-open deadline both abort the same signal, which is passed to
 * `provider.generate()` so hung HTTP create() can be cancelled.
 */
export interface GenerateAbortScope {
  readonly signal: AbortSignal;
  /** True when the stream-open deadline fired (not a user cancel). */
  readonly openTimedOut: () => boolean;
  /** Clear only the open-phase timer after the stream object is returned. */
  readonly clearOpenTimer: () => void;
  /** Drop the caller-signal listener after generate finishes. */
  readonly dispose: () => void;
}

export interface GenerateAbortScopeOptions {
  readonly openMs?: number;
  readonly signal?: AbortSignal;
  readonly label?: string;
}

/**
 * Build an abort scope for one {@link generate} call. The open timer starts
 * immediately; call {@link GenerateAbortScope.clearOpenTimer} once
 * `provider.generate()` resolves so a long healthy stream is not cut short.
 */
export function createGenerateAbortScope(
  options: GenerateAbortScopeOptions = {},
): GenerateAbortScope {
  const openMs = resolveOpenTimeoutMs(options.openMs);
  const controller = new AbortController();
  let openTimedOut = false;
  let openTimer: ReturnType<typeof setTimeout> | undefined;
  let unlink: (() => void) | undefined;

  const source = options.signal;
  if (source !== undefined) {
    if (source.aborted) {
      controller.abort(source.reason);
    } else {
      const onAbort = (): void => {
        controller.abort(source.reason);
      };
      source.addEventListener('abort', onAbort);
      unlink = () => source.removeEventListener('abort', onAbort);
    }
  }

  if (openMs > 0 && !controller.signal.aborted) {
    openTimer = setTimeout(() => {
      openTimedOut = true;
      controller.abort(
        new APITimeoutError(
          `Stream open timeout: no stream established for ${String(openMs)}ms.` +
            formatLabel(options.label),
        ),
      );
    }, openMs);
  }

  return {
    signal: controller.signal,
    openTimedOut: () => openTimedOut,
    clearOpenTimer: () => {
      if (openTimer !== undefined) {
        clearTimeout(openTimer);
        openTimer = undefined;
      }
    },
    dispose: () => {
      if (openTimer !== undefined) {
        clearTimeout(openTimer);
        openTimer = undefined;
      }
      unlink?.();
      unlink = undefined;
    },
  };
}

/** Re-export helper for tests / callers that need the abort error shape. */
export function isAbortErrorLike(error: unknown): boolean {
  return (
    (error instanceof DOMException && error.name === 'AbortError') ||
    (error instanceof Error && error.name === 'AbortError')
  );
}

export function openTimeoutError(openMs: number, label?: string): APITimeoutError {
  return new APITimeoutError(
    `Stream open timeout: no stream established for ${String(openMs)}ms.` + formatLabel(label),
  );
}
