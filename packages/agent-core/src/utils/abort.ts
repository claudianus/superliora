export function abortError(message = 'Aborted'): Error {
  const error = new Error(message);
  error.name = 'AbortError';
  return error;
}

/**
 * Marks an abort the user triggered deliberately (e.g. pressing ESC to
 * interrupt the agent), as distinct from a timeout, an internal error, or any
 * other programmatic abort. It travels as the AbortSignal's `reason`, so code
 * that settles an interrupted operation can tell a user interruption apart from
 * a failure and report it to the model accordingly instead of emitting a
 * neutral "was aborted" that the model mistakes for a system problem.
 *
 * `name` stays 'AbortError' so existing `isAbortError()` checks (and
 * `AbortSignal.throwIfAborted()`) keep treating it as an abort.
 */
export class UserCancellationError extends Error {
  readonly userCancelled = true;

  constructor() {
    super('Aborted by the user');
    this.name = 'AbortError';
  }
}

export function userCancellationReason(): UserCancellationError {
  return new UserCancellationError();
}

export function isUserCancellation(value: unknown): value is UserCancellationError {
  return value instanceof UserCancellationError;
}

export function abortable<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) return Promise.reject(abortReason(signal));
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => {
      reject(abortReason(signal));
    };
    signal.addEventListener('abort', onAbort, { once: true });
    promise.then(resolve, reject).finally(() => {
      signal.removeEventListener('abort', onAbort);
    });
  });
}

export function linkAbortSignal(source: AbortSignal, target: AbortController): () => void {
  const onAbort = () => {
    target.abort(source.reason);
  };
  if (source.aborted) {
    onAbort();
    return () => {};
  }
  source.addEventListener('abort', onAbort, { once: true });
  return () => {
    source.removeEventListener('abort', onAbort);
  };
}

function abortReason(signal: AbortSignal): Error {
  if (signal.reason instanceof Error && !isDefaultAbortReason(signal.reason)) {
    return signal.reason;
  }
  return abortError();
}

function isDefaultAbortReason(reason: Error): boolean {
  return reason.name === 'AbortError' && reason.message === 'This operation was aborted';
}

export interface DeadlineAbortSignal {
  readonly signal: AbortSignal;
  readonly timedOut: () => boolean;
  readonly clear: () => void;
}

export function createDeadlineAbortSignal(
  source: AbortSignal,
  timeoutMs: number,
): DeadlineAbortSignal {
  const controller = new AbortController();
  const unlinkAbortSignal = linkAbortSignal(source, controller);
  let didTimeout = false;
  let timeout: ReturnType<typeof setTimeout> | undefined = setTimeout(() => {
    didTimeout = true;
    controller.abort(abortError());
  }, timeoutMs);

  return {
    signal: controller.signal,
    timedOut: () => didTimeout,
    clear: () => {
      if (timeout !== undefined) clearTimeout(timeout);
      timeout = undefined;
      unlinkAbortSignal();
    },
  };
}

/**
 * Combine an optional parent cancel signal with a wall-clock timeout.
 * `timeoutMs <= 0` disables the timeout and returns the parent (or a fresh
 * never-aborted signal when no parent is given).
 *
 * Used by fetch/tool helpers so hung TCP cannot outlive either the caller's
 * abort or a per-request deadline.
 */
export function signalWithTimeout(
  timeoutMs: number,
  parent?: AbortSignal,
): AbortSignal {
  if (timeoutMs <= 0) {
    return parent ?? new AbortController().signal;
  }
  const timeout = AbortSignal.timeout(timeoutMs);
  if (parent === undefined) return timeout;
  if (parent.aborted) return parent;
  return AbortSignal.any([parent, timeout]);
}
