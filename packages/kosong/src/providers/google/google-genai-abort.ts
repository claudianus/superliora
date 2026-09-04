export function createAbortError(): DOMException {
  return new DOMException('The operation was aborted.', 'AbortError');
}

export async function abortPromise(signal: AbortSignal | undefined): Promise<never> {
  if (signal === undefined) {
    return new Promise(() => {
      // Intentionally never settles when no signal is provided.
    });
  }
  if (signal.aborted) {
    throw createAbortError();
  }
  return new Promise((_, reject) => {
    signal.addEventListener(
      'abort',
      () => {
        reject(createAbortError());
      },
      { once: true },
    );
  });
}

/**
 * Races `task` against `signal`, removing the abort listener when `task`
 * settles first. Prefer this over `Promise.race([task, abortPromise(signal)])`:
 * the loser of that race keeps its listener registered on the (often
 * session-scoped, long-lived) signal forever, leaking a closure per request.
 */
export async function raceWithAbort<T>(
  task: Promise<T>,
  signal: AbortSignal | undefined,
): Promise<T> {
  if (signal === undefined) return task;
  if (signal.aborted) throw createAbortError();
  let onAbort: (() => void) | undefined;
  try {
    return await Promise.race([
      task,
      new Promise<never>((_, reject) => {
        onAbort = () => {
          reject(createAbortError());
        };
        signal.addEventListener('abort', onAbort, { once: true });
      }),
    ]);
  } finally {
    if (onAbort !== undefined) signal.removeEventListener('abort', onAbort);
  }
}
