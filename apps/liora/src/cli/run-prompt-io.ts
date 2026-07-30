export interface PromptOutput {
  readonly columns?: number | undefined;
  write(chunk: string): boolean;
}

export interface PromptRunIO {
  readonly stdout?: PromptOutput;
  readonly stderr?: PromptOutput;
  readonly process?: PromptProcess;
}

export interface PromptProcess {
  once(signal: NodeJS.Signals, listener: () => Promise<void>): unknown;
  off(signal: NodeJS.Signals, listener: () => Promise<void>): unknown;
  exit(code?: number): never | void;
}

export async function raceWithTimeout(promise: Promise<void>, timeoutMs: number): Promise<void> {
  let timedOut = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const guarded = promise.catch((error: unknown) => {
    if (timedOut) return;
    throw error;
  });
  const timedOutSignal = new Promise<void>((resolve) => {
    timer = setTimeout(() => {
      timedOut = true;
      resolve();
    }, timeoutMs);
    timer.unref?.();
  });
  try {
    await Promise.race([guarded, timedOutSignal]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

export function installPromptTerminationCleanup(
  promptProcess: PromptProcess,
  cleanup: () => Promise<void>,
  emergencyFlushSync: () => void,
): () => void {
  let terminating = false;
  const exitAfterCleanup = async (signal: NodeJS.Signals): Promise<void> => {
    if (terminating) return;
    terminating = true;
    try {
      await cleanup();
    } finally {
      // If async cleanup could not complete in time (or threw), drain any
      // state still pending synchronously before the process exits so the
      // in-flight work is not lost. No-op if the async path already flushed.
      try {
        emergencyFlushSync();
      } catch {
        // Best-effort — exiting regardless.
      }
      promptProcess.exit(signalExitCode(signal));
    }
  };
  const onSigint = () => exitAfterCleanup('SIGINT');
  const onSigterm = () => exitAfterCleanup('SIGTERM');
  const onSighup = () => exitAfterCleanup('SIGHUP');
  promptProcess.once('SIGINT', onSigint);
  promptProcess.once('SIGTERM', onSigterm);
  promptProcess.once('SIGHUP', onSighup);
  return () => {
    promptProcess.off('SIGINT', onSigint);
    promptProcess.off('SIGTERM', onSigterm);
    promptProcess.off('SIGHUP', onSighup);
  };
}

function signalExitCode(signal: NodeJS.Signals): number {
  if (signal === 'SIGINT') return 130;
  if (signal === 'SIGHUP') return 129;
  return 143;
}
