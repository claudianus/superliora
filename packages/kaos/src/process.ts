import type { Readable, Writable } from 'node:stream';

/**
 * A running process spawned by a {@link Kaos} environment.
 *
 * Provides access to standard I/O streams, the process ID, and lifecycle
 * management (wait / kill). The interface is intentionally minimal so it
 * can be backed by local child processes, SSH sessions, or container runtimes.
 */
export interface KaosProcess {
  /** Writable stream connected to the process's standard input. */
  readonly stdin: Writable;
  /** Readable stream for the process's standard output. */
  readonly stdout: Readable;
  /** Readable stream for the process's standard error. */
  readonly stderr: Readable;
  /** Operating-system process ID, when exposed by the execution environment. */
  readonly pid: number | undefined;
  /** Exit code if the process has already terminated, otherwise `null`. */
  readonly exitCode: number | null;
  /** Editor terminal identity, when execution is owned by an ACP client. */
  readonly terminalId?: string;
  /** Whether the execution environment reported truncation of captured output. */
  readonly outputTruncated?: boolean;
  /** Environment-owned resources: unknown while active, false when unconfirmed,
   * true only after confirmed physical exit and successful resource release. */
  readonly resourcesSettled?: boolean;
  /** Wait for confirmed native exit; a signal-only exit has no numeric code. */
  wait(): Promise<number | null>;
  /** Send a signal to the process (defaults to `SIGTERM`). */
  kill(signal?: NodeJS.Signals): Promise<void>;
  /** Release stdin/stdout/stderr resources owned by this process wrapper. */
  dispose(): Promise<void> | void;
}

/** Close every owned stream before reporting disposal or a stream failure. */
export async function disposeProcessStreams(streams: readonly (Readable | Writable)[]): Promise<void> {
  const results = await Promise.allSettled(streams.map((stream) => {
    if (stream.closed) return Promise.resolve();
    const completion = Promise.withResolvers<void>();
    let failure: Error | undefined;
    const onError = (error: Error): void => { failure = error; };
    const onClose = (): void => {
      stream.removeListener('error', onError);
      if (failure === undefined) completion.resolve();
      else completion.reject(failure);
    };
    stream.on('error', onError);
    stream.once('close', onClose);
    try {
      stream.destroy();
    } catch (error) {
      stream.removeListener('error', onError);
      stream.removeListener('close', onClose);
      completion.reject(error);
    }
    return completion.promise;
  }));
  const errors = results.filter((result) => result.status === 'rejected').map((result) => result.reason);
  if (errors.length > 0) throw new AggregateError(errors, 'Process stream disposal failed.');
}
