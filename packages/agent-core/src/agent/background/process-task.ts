import type { KaosProcess } from '@superliora/kaos';
import type { Readable } from 'node:stream';

import { errorMessage } from '../../loop/errors';
import { NativeProcessCleanupError } from '../../session/job/git';
import { registerSessionWorktreeOwnershipGuard, sessionWorktreeContainsPath } from '../../session/worktree';
import type {
  BackgroundTask,
  BackgroundTaskInfoBase,
  BackgroundTaskSink,
  BackgroundTaskSettlement,
} from './task';

export interface ProcessBackgroundTaskInfo extends BackgroundTaskInfoBase {
  readonly kind: 'process';
  /** Present for accepted-before-start execution. */
  readonly executionPhase?: 'accepted' | 'preparing' | 'running';
  readonly command: string;
  readonly pid?: number;
  readonly exitCode: number | null;
  readonly cwd?: string;
  readonly outputTruncated?: boolean;
}

export type ProcessBackgroundTaskOutputKind = 'stdout' | 'stderr';

export type ProcessBackgroundTaskOutputCallback = (
  kind: ProcessBackgroundTaskOutputKind,
  text: string,
) => void;

const STREAM_DRAIN_GRACE_MS = 250;

export class ProcessBackgroundTask implements BackgroundTask {
  readonly kind = 'process' as const;
  readonly idPrefix = 'bash';
  private exitCode: number | null = null;
  private exitConfirmed = false;
  private resourceSettlement: boolean | undefined;
  private captureIncomplete = false;
  private cleanupError: NativeProcessCleanupError | undefined;
  private readonly releaseOwnership: () => void;

  get outputTruncated(): boolean {
    return this.captureIncomplete || this.proc.outputTruncated === true;
  }

  get resourcesSettled(): boolean | undefined {
    return this.proc.resourcesSettled ?? this.cleanupError?.resourcesSettled ?? this.resourceSettlement;
  }

  constructor(
    readonly proc: KaosProcess,
    readonly command: string,
    readonly description: string,
    readonly cwd: string,
    private readonly onOutput?: ProcessBackgroundTaskOutputCallback,
  ) {
    this.releaseOwnership = registerSessionWorktreeOwnershipGuard((path) =>
      this.resourcesSettled !== true && sessionWorktreeContainsPath(path, this.cwd));
  }

  async start(sink: BackgroundTaskSink): Promise<void> {
    if (this.cleanupError !== undefined) {
      await sink.settle({ status: 'failed', stopReason: errorMessage(this.cleanupError) });
      return;
    }
    const streamDrained = Promise.all([
      observeProcessStream(this.proc.stdout, 'stdout', sink, this.onOutput),
      observeProcessStream(this.proc.stderr, 'stderr', sink, this.onOutput),
    ]).then(() => undefined);
    // Attach a rejection handler immediately; start() still awaits the same
    // promise after proc.wait() so stream errors keep failing the task.
    void streamDrained.catch(() => {});

    const requestStop = (): void => {
      void this.proc.kill('SIGTERM').catch(() => {});
    };
    if (sink.signal.aborted) {
      requestStop();
    } else {
      sink.signal.addEventListener('abort', requestStop, { once: true });
    }

    let settlement: BackgroundTaskSettlement;
    let executionError: unknown;
    try {
      const exitCode = await this.proc.wait();
      this.exitConfirmed = true;
      if (!(await waitForStreamDrain(streamDrained))) this.captureIncomplete = true;
      this.exitCode = exitCode;
      settlement = {
        status: sink.signal.aborted ? 'killed' : exitCode === 0 ? 'completed' : 'failed',
      };
    } catch (error: unknown) {
      executionError = error;
      if (!(await waitForStreamDrainSettled(streamDrained))) this.captureIncomplete = true;
      this.exitCode = this.proc.exitCode;
      settlement = {
        status: sink.signal.aborted ? 'killed' : 'failed',
        stopReason: sink.signal.aborted ? undefined : errorMessage(error),
      };
    } finally {
      sink.signal.removeEventListener('abort', requestStop);
      await this.disposeProcess(executionError);
    }
    await sink.settle(settlement);
  }

  async forceStop(): Promise<void> {
    if (this.cleanupError !== undefined) {
      try {
        await this.cleanupError.settleResources();
      } finally {
        if (this.resourcesSettled === true) this.releaseOwnership();
      }
      return;
    }
    await this.proc.kill('SIGKILL');
  }

  async settleAbandonedProcess(cause: unknown): Promise<void> {
    this.captureIncomplete = true;
    this.cleanupError = new NativeProcessCleanupError(this.proc, this.exitConfirmed, cause);
    try {
      await this.cleanupError.settleResources();
    } finally {
      if (this.resourcesSettled === true) this.releaseOwnership();
    }
  }

  toInfo(base: BackgroundTaskInfoBase): ProcessBackgroundTaskInfo {
    return {
      ...base,
      kind: 'process',
      command: this.command,
      pid: this.proc.pid,
      exitCode: this.exitCode,
      cwd: this.cwd,
      ...(this.outputTruncated ? { outputTruncated: true } : {}),
    };
  }

  private async disposeProcess(executionError?: unknown): Promise<void> {
    try {
      await this.proc.dispose();
      this.resourceSettlement = this.proc.resourcesSettled ?? this.exitConfirmed;
      if (!this.resourceSettlement) throw new Error('Process exit has not been confirmed.');
    } catch (error) {
      this.resourceSettlement = false;
      const cause = executionError === undefined ? error : new AggregateError(
        [executionError, error],
        `Process execution failed: ${errorMessage(executionError)}; cleanup failed: ${errorMessage(error)}`,
      );
      this.cleanupError = new NativeProcessCleanupError(this.proc, this.exitConfirmed, cause);
      throw this.cleanupError;
    }
    finally {
      if (this.resourcesSettled === true) this.releaseOwnership();
    }
  }
}

async function waitForStreamDrain(streamDrained: Promise<void>): Promise<boolean> {
  const expired = Promise.withResolvers<boolean>();
  const timeout = setTimeout(() => expired.resolve(false), STREAM_DRAIN_GRACE_MS);
  timeout.unref();
  try {
    return await Promise.race([streamDrained.then(() => true), expired.promise]);
  } finally {
    clearTimeout(timeout);
  }
}

async function waitForStreamDrainSettled(streamDrained: Promise<void>): Promise<boolean> {
  try {
    return await waitForStreamDrain(streamDrained);
  } catch {
    return false;
  }
}

function observeProcessStream(
  stream: Readable,
  kind: ProcessBackgroundTaskOutputKind,
  sink: BackgroundTaskSink,
  onOutput?: ProcessBackgroundTaskOutputCallback,
): Promise<void> {
  stream.setEncoding('utf8');
  const onData = (chunk: string): void => {
    if (chunk.length === 0) return;
    sink.appendOutput(chunk);
    onOutput?.(kind, chunk);
  };
  stream.on('data', onData);

  return new Promise<void>((resolve, reject) => {
    let ended = false;
    const settle = (callback: () => void): void => {
      cleanup();
      callback();
    };
    const done = (): void => {
      settle(resolve);
    };
    const fail = (error: unknown): void => {
      settle(() =>{  reject(error); });
    };
    const onEnd = (): void => {
      ended = true;
      done();
    };
    const onClose = (): void => {
      if (ended || sink.signal.aborted) {
        done();
        return;
      }

      fail(createPrematureCloseError());
    };
    const onError = (error: Error): void => {
      // When the task is aborted we intentionally destroy the streams, which
      // can emit errors. Swallow those expected errors; surface anything else.
      if (sink.signal.aborted) {
        done();
      } else {
        fail(error);
      }
    };
    const cleanup = (): void => {
      stream.removeListener('data', onData);
      stream.removeListener('end', onEnd);
      stream.removeListener('close', onClose);
      stream.removeListener('error', onError);
    };
    stream.once('end', onEnd);
    stream.once('close', onClose);
    stream.once('error', onError);
  });
}

function createPrematureCloseError(): Error {
  const error = new Error('Premature close') as NodeJS.ErrnoException;
  error.code = 'ERR_STREAM_PREMATURE_CLOSE';
  return error;
}
