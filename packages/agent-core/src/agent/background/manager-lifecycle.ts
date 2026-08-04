import { createControlledPromise } from '@antfu/utils';

import { errorMessage } from '../../loop/errors';
import { resettableTimeoutOutcome, timeoutOutcome } from '../../utils/promise';
import {
  SIGTERM_GRACE_MS,
  USER_INTERRUPT_REASON,
  type ManagedTask,
  type TerminalOutcome,
} from './managed-types';
import type { BackgroundManagerHost } from './manager-host';
import { appendBackgroundTaskOutput } from './manager-output';
import { persistLiveBackgroundTask } from './manager-persistence';
import { fireTerminalEffects } from './manager-events';
import type { BackgroundTaskSettlement } from './task';

export async function runBackgroundTaskLifecycle(
  host: BackgroundManagerHost,
  entry: ManagedTask,
): Promise<void> {
  const worker = createControlledPromise<BackgroundTaskSettlement>();
  let workerSettled = false;
  const settleWorker = (settlement: BackgroundTaskSettlement): boolean => {
    if (workerSettled) return false;
    workerSettled = true;
    worker.resolve(settlement);
    return true;
  };

  void Promise.resolve()
    .then(() => entry.task.start({
      signal: entry.abortController.signal,
      appendOutput: (chunk) => {
        appendBackgroundTaskOutput(host, entry, chunk);
      },
      settle: async (settlement) => settleWorker(settlement),
    }))
    .catch((error: unknown) => {
      settleWorker({
        status: entry.abortController.signal.aborted ? 'killed' : 'failed',
        stopReason: entry.abortController.signal.aborted ? undefined : errorMessage(error),
      });
    });

  const timeout = resettableTimeoutOutcome(entry.options.timeoutMs, { kind: 'timeout' as const });
  entry.timeoutHandle = timeout;
  const outcome = await Promise.race([
    worker.then((settlement): TerminalOutcome => ({ kind: 'worker', settlement })),
    timeout,
    entry.stop.then((request): TerminalOutcome => ({ kind: 'stop', request })),
    signalOutcome(host, entry),
  ]).finally(() => {
    timeout.clear();
    entry.timeoutHandle = undefined;
  });
  const settlement = await settlementForOutcome(host, entry, outcome, worker);
  await finalizeBackgroundTask(host, entry, settlement);
}

function signalOutcome(host: BackgroundManagerHost, entry: ManagedTask): Promise<TerminalOutcome> {
  const signal = entry.options.signal;
  if (signal === undefined) return new Promise<never>(() => {});
  const outcome = (): TerminalOutcome => ({
    kind: 'stop',
    request: { reason: USER_INTERRUPT_REASON, abortReason: signal.reason },
  });
  if (signal.aborted) return Promise.resolve(outcome());
  return new Promise((resolve) => {
    signal.addEventListener(
      'abort',
      () => {
        if (!host.isDetached(entry)) resolve(outcome());
      },
      { once: true },
    );
  });
}

async function settlementForOutcome(
  host: BackgroundManagerHost,
  entry: ManagedTask,
  outcome: TerminalOutcome,
  worker: Promise<BackgroundTaskSettlement>,
): Promise<BackgroundTaskSettlement> {
  if (outcome.kind === 'worker') return outcome.settlement;

  const timedOut = outcome.kind === 'timeout';
  const stopReason = outcome.kind === 'stop' ? outcome.request.reason : undefined;
  let abortReason: unknown;
  if (timedOut) {
    abortReason = 'Timed out';
  } else if (outcome.kind === 'stop') {
    abortReason = outcome.request.abortReason ?? stopReason;
  }
  entry.stopReason = stopReason;
  entry.abortController.abort(abortReason);

  const graceTimeout = timeoutOutcome(SIGTERM_GRACE_MS, undefined);
  const workerAfterAbort = await Promise.race([
    worker,
    graceTimeout,
  ]).finally(() =>{  graceTimeout.clear(); });

  if (
    outcome.kind === 'stop' &&
    workerAfterAbort !== undefined &&
    workerAfterAbort.status !== 'killed' &&
    workerAfterAbort.status !== 'timed_out'
  ) {
    return workerAfterAbort;
  }

  if (workerAfterAbort === undefined) {
    try {
      await entry.task.forceStop?.();
    } catch {
      /* ignore */
    }
  }

  return {
    status: timedOut ? 'timed_out' : 'killed',
    stopReason,
  };
}

async function finalizeBackgroundTask(
  host: BackgroundManagerHost,
  entry: ManagedTask,
  settlement: BackgroundTaskSettlement,
): Promise<void> {
  entry.status = settlement.status;
  entry.endedAt = Date.now();
  entry.stopReason =
    settlement.stopReason ?? (settlement.status === 'killed' ? entry.stopReason : undefined);
  if (entry.outputPersistStarted) {
    await persistLiveBackgroundTask(host, entry);
  } else {
    entry.pendingOutput = [];
    entry.pendingOutputBytes = 0;
  }
  // Terminal tasks never append output again. When the output already streams
  // to `output.log` (the authoritative copy read by getOutputSnapshot), drop
  // the in-memory ring so long sessions don't retain up to 1 MiB per task.
  if (entry.outputPersistStarted && host.persistence !== undefined) {
    entry.outputChunks.length = 0;
    entry.pendingOutput = [];
    entry.pendingOutputBytes = 0;
  }
  fireTerminalEffects(host, entry);
  entry.foregroundRelease?.resolve('terminal');
  entry.terminal.resolve();
}
