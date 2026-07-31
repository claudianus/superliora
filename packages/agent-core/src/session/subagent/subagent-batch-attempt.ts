import {
  isPermanentAuthError,
  isPermanentQuotaOrBillingError,
  isProviderRateLimitError,
  isTransientProviderError,
} from '@superliora/kosong';

import type { RunSubagentOptions, SpawnSubagentOptions, SubagentHandle } from './subagent-host';
import { classifySubagentFailureReason } from './subagent-batch-failure';
import {
  TRANSIENT_RETRY_BASE_DELAY_MS,
  TRANSIENT_RETRY_MAX_ATTEMPTS,
} from './subagent-batch-constants';
import type {
  ActiveAttempt,
  AttemptOutcome,
  QueuedSubagentTask,
  RateLimitedOutcome,
  SubagentBatchLauncher,
  SubagentResult,
  TaskState,
} from './subagent-batch-types';
import { renderSubagentCompletionText } from './subagent-result-contract';
import { isUserCancellation } from '../../utils/abort';

export function attemptErrorMessage<T>(
  attempt: ActiveAttempt<T>,
  error: unknown,
  status: SubagentResult<T>['status'],
): string {
  if (attempt.timedOut && attempt.state.task.timeout !== undefined) {
    return 'Subagent timed out.';
  }
  if (status === 'aborted') return 'The user manually interrupted this subagent batch.';
  return error instanceof Error ? error.message : String(error);
}

export function failedAttemptOutcome<T>(
  attempt: ActiveAttempt<T>,
  error: unknown,
): SubagentResult<T> {
  const status =
    attempt.controller.signal.aborted && isUserCancellation(attempt.controller.signal.reason)
      ? 'aborted'
      : 'failed';
  return {
    task: attempt.state.task,
    agentId: attempt.state.agentId,
    status,
    state: attempt.state.agentId === undefined ? 'not_started' : 'started',
    error: attemptErrorMessage(attempt, error, status),
    failureReason: classifySubagentFailureReason(error, status),
  };
}

/**
 * Transient provider failures (5xx / overloaded / connection errors) earn a
 * small bounded in-place retry, kept strictly separate from the rate-limit
 * capacity scheduler. Timeouts, aborts, rate limits, and permanent errors
 * never retry here.
 */
export function shouldRetryTransient<T>(
  attempt: ActiveAttempt<T>,
  error: unknown,
  finished: boolean,
): boolean {
  if (finished) return false;
  if (attempt.timedOut || attempt.controller.signal.aborted) return false;
  if (attempt.state.transientRetryCount >= TRANSIENT_RETRY_MAX_ATTEMPTS) return false;
  return isTransientProviderError(error);
}

/** Resolves true once the backoff elapses, false if the attempt is aborted. */
export function waitTransientBackoff<T>(attempt: ActiveAttempt<T>): Promise<boolean> {
  const delay =
    TRANSIENT_RETRY_BASE_DELAY_MS * 2 ** Math.max(0, attempt.state.transientRetryCount - 1);
  return new Promise((resolve) => {
    const abortSignal = attempt.controller.signal;
    if (abortSignal.aborted) {
      resolve(false);
      return;
    }
    const onAbort = () => {
      clearTimeout(timer);
      resolve(false);
    };
    const timer = setTimeout(() => {
      abortSignal.removeEventListener('abort', onAbort);
      resolve(true);
    }, delay);
    abortSignal.addEventListener('abort', onAbort, { once: true });
  });
}

export async function runSubagentAttempt<T>(
  attempt: ActiveAttempt<T>,
  launcher: SubagentBatchLauncher,
  finished: boolean,
  onReady: () => void,
): Promise<AttemptOutcome<T>> {
  const task = attempt.state.task;
  const runOptions: RunSubagentOptions = {
    parentToolCallId: task.parentToolCallId,
    parentToolCallUuid: task.parentToolCallUuid,
    prompt: task.prompt,
    description: task.description,
    swarmIndex: task.swarmIndex,
    runInBackground: task.runInBackground,
    signal: attempt.controller.signal,
    timeoutMs: task.timeout,
    contractPath: task.contractPath,
    worktreeDir: task.worktreeDir,
    onReady,
    suppressRateLimitFailureEvent: true,
  };

  for (;;) {
    let handle: SubagentHandle;
    try {
      attempt.controller.signal.throwIfAborted();
      if (attempt.state.retryAgentId !== undefined) {
        handle = await launcher.retry(attempt.state.retryAgentId, runOptions);
      } else if (attempt.state.agentId !== undefined) {
        // Transient retry after a failed completion: the agent instance still
        // exists, so retry its failed turn in place instead of spawning anew.
        handle = await launcher.retry(attempt.state.agentId, runOptions);
      } else if (task.kind === 'resume') {
        handle = await launcher.resume(task.resumeAgentId, runOptions);
      } else {
        const spawnOptions: SpawnSubagentOptions = {
          profileName: task.profileName,
          profileBaseName: task.profileBaseName,
          swarmItem: task.swarmItem,
          ...runOptions,
        };
        handle = await launcher.spawn(spawnOptions);
      }
    } catch (error) {
      if (!shouldRetryTransient(attempt, error, finished)) {
        return failedAttemptOutcome(attempt, error);
      }
      attempt.state.transientRetryCount += 1;
      if (!(await waitTransientBackoff(attempt))) {
        return failedAttemptOutcome(attempt, error);
      }
      continue;
    }

    attempt.state.agentId = handle.agentId;
    try {
      const completion = await handle.completion;
      return {
        task,
        agentId: handle.agentId,
        status: 'completed',
        result: renderSubagentCompletionText(completion),
        usage: completion.usage,
      };
    } catch (error) {
      // Permanent auth/quota failures (401/403, expired subscription,
      // exhausted credit) never recover by waiting. Checked before the
      // rate-limit branch so a quota error reported with a rate-limit
      // shaped payload (e.g. 429 "exceeded your current quota") fails
      // fast instead of being requeued into rate-limit phase; the failed
      // outcome flows through the regular failure path.
      if (isPermanentAuthError(error) || isPermanentQuotaOrBillingError(error)) {
        return failedAttemptOutcome(attempt, error);
      }
      if (isProviderRateLimitError(error)) {
        return {
          type: 'rate_limited',
          agentId: handle.agentId,
          error: attemptErrorMessage(attempt, error, 'failed'),
        } satisfies RateLimitedOutcome;
      }

      if (!shouldRetryTransient(attempt, error, finished)) {
        return failedAttemptOutcome(attempt, error);
      }
      attempt.state.transientRetryCount += 1;
      if (!(await waitTransientBackoff(attempt))) {
        return failedAttemptOutcome(attempt, error);
      }
    }
  }
}

export function linkAttemptSignals<T>(
  attempt: ActiveAttempt<T>,
  task: QueuedSubagentTask<T>,
  batchController: AbortController,
): () => void {
  const abortFromBatch = () => {
    attempt.controller.abort(batchController.signal.reason);
  };
  const abortFromTask = () => {
    attempt.controller.abort(task.signal?.reason);
  };
  const timeout =
    task.timeout === undefined
      ? undefined
      : setTimeout(() => {
          attempt.timedOut = true;
          attempt.controller.abort(new Error('Aborted'));
        }, task.timeout);

  if (batchController.signal.aborted) {
    abortFromBatch();
  } else if (task.signal?.aborted === true) {
    abortFromTask();
  } else {
    batchController.signal.addEventListener('abort', abortFromBatch, { once: true });
    task.signal?.addEventListener('abort', abortFromTask, { once: true });
  }

  return () => {
    if (timeout !== undefined) clearTimeout(timeout);
    batchController.signal.removeEventListener('abort', abortFromBatch);
    task.signal?.removeEventListener('abort', abortFromTask);
  };
}

export type MarkAttemptReadyContext<T> = {
  readonly finished: boolean;
  readonly rateLimitMode: boolean;
  readonly onReadyInNormalPhase: () => void;
  readonly onReadyInRateLimitPhase: (now: number) => void;
};

export function markAttemptReady<T>(
  attempt: ActiveAttempt<T>,
  active: Set<ActiveAttempt<T>>,
  ctx: MarkAttemptReadyContext<T>,
): void {
  if (ctx.finished || attempt.ready || !active.has(attempt)) return;

  attempt.ready = true;
  attempt.state.started = true;
  if (!ctx.rateLimitMode) {
    ctx.onReadyInNormalPhase();
  }

  if (ctx.rateLimitMode) {
    ctx.onReadyInRateLimitPhase(Date.now());
  }
}

export function createInitialTaskStates<T>(
  tasks: readonly QueuedSubagentTask<T>[],
): Array<TaskState<T>> {
  return tasks.map((task, index) => ({
    index,
    task,
    retryCount: 0,
    retryReadyAt: 0,
    started: false,
    transientRetryCount: 0,
  }));
}

export function buildUserCancellationResults<T>(
  states: readonly TaskState<T>[],
  results: readonly (SubagentResult<T> | undefined)[],
): Array<SubagentResult<T>> {
  return states.map((state) => {
    const result = results[state.index];
    if (result !== undefined) return result;

    if (state.started || state.agentId !== undefined) {
      return {
        task: state.task,
        agentId: state.agentId,
        status: 'aborted',
        state: 'started',
        error:
          'The user manually interrupted this subagent batch before this subagent finished.',
      };
    }

    return {
      task: state.task,
      status: 'aborted',
      state: 'not_started',
      error:
        'The user manually interrupted this subagent batch before this subagent was started.',
    };
  });
}
