/** Worker cancellation, explicit deadlines, and provider-failure classification. */

import { APIProviderRateLimitError } from '@superliora/kosong';

import type { Agent } from '../../agent';
import { ErrorCodes, type LioraErrorPayload } from '../../errors';
import {
  linkAbortSignal,
} from '../../utils/abort';
import { SubagentCleanupError, SubagentDeadlineError, SUBAGENT_MAX_TOKENS_ERROR, SubagentMaxTokensError, resolveSubagentDeadlineMs } from './subagent-errors';

export type ActiveChildEntry = {
  readonly controller: AbortController;
  runInBackground: boolean;
  resourcesSettled?: boolean;
  readonly worktreeDir?: string;
  pauseDeadline?: () => void;
  resumeDeadline?: () => void;
  resetDeadline?: (ms: number) => void;
};

export type RunWithActiveChildOptions = {
  readonly signal: AbortSignal;
  readonly runInBackground: boolean;
  readonly timeoutMs?: number;
  readonly worktreeDir?: string;
};

const deadlineControlsByChildId = new Map<string, {
  readonly pause: () => void;
  readonly resume: () => void;
  readonly reset: (ms: number) => void;
}>();

export function pauseActiveChildDeadline(childId: string): boolean {
  const control = deadlineControlsByChildId.get(childId);
  if (control === undefined) return false;
  control.pause();
  return true;
}

export function resumeActiveChildDeadline(childId: string): boolean {
  const control = deadlineControlsByChildId.get(childId);
  if (control === undefined) return false;
  control.resume();
  return true;
}

export function resetActiveChildDeadline(childId: string, ms: number): boolean {
  const control = deadlineControlsByChildId.get(childId);
  if (control === undefined) return false;
  control.reset(ms);
  return true;
}


/** Keep ownership until the underlying turn and tool teardown actually settle. */
export function runWithActiveChild<TResult, TOptions extends RunWithActiveChildOptions>(
  activeChildren: Map<string, ActiveChildEntry>,
  childId: string,
  options: TOptions,
  run: (options: TOptions) => Promise<TResult>,
): Promise<TResult> {
  const controller = new AbortController();
  const unlinkAbortSignal = linkAbortSignal(options.signal, controller);
  const deadlineMs = resolveSubagentDeadlineMs(options.timeoutMs);
  let selectedDeadlineMs = deadlineMs;
  let deadlineError: SubagentDeadlineError | undefined;
  let timer: NodeJS.Timeout | undefined;
  let remainingMs = deadlineMs;
  let startedAt = Date.now();
  let paused = false;
  const clearTimer = (): void => {
    clearTimeout(timer);
    timer = undefined;
  };
  const armTimer = (ms: number): void => {
    clearTimer();
    remainingMs = ms;
    startedAt = Date.now();
    if (ms <= 0 || paused || controller.signal.aborted) return;
    timer = setTimeout(() => {
      deadlineError = new SubagentDeadlineError(selectedDeadlineMs);
      controller.abort(deadlineError);
    }, ms);
    timer.unref?.();
  };
  const pause = (): void => {
    if (paused) return;
    if (timer !== undefined) remainingMs = Math.max(0, remainingMs - (Date.now() - startedAt));
    paused = true;
    clearTimer();
  };
  const resume = (): void => {
    if (!paused) return;
    paused = false;
    if (remainingMs > 0) armTimer(remainingMs);
    else if (selectedDeadlineMs > 0 && !controller.signal.aborted) {
      deadlineError = new SubagentDeadlineError(selectedDeadlineMs);
      controller.abort(deadlineError);
    }
  };
  const reset = (ms: number): void => {
    selectedDeadlineMs = ms;
    paused = false;
    armTimer(ms);
  };
  const entry: ActiveChildEntry = { controller, runInBackground: options.runInBackground, worktreeDir: options.worktreeDir, pauseDeadline: pause, resumeDeadline: resume, resetDeadline: reset };
  activeChildren.set(childId, entry);
  deadlineControlsByChildId.set(childId, { pause, resume, reset });
  armTimer(deadlineMs);
  return Promise.resolve().then(() => run({ ...options, signal: controller.signal }))
    .then((result) => {
      controller.signal.throwIfAborted();
      return result;
    })
    .catch((error: unknown) => {
      if (error instanceof SubagentCleanupError) {
        entry.resourcesSettled = false;
        throw error;
      }
      throw deadlineError ?? error;
    })
    .finally(() => {
      clearTimer();
      deadlineControlsByChildId.delete(childId);
      unlinkAbortSignal();
      if (entry.resourcesSettled !== false) {
        entry.resourcesSettled = true;
        activeChildren.delete(childId);
      }
    });
}

export async function runChildTurnToCompletion(child: Agent, signal: AbortSignal): Promise<void> {
  // Attach cancellation without racing the turn's actual teardown promise.
  const pending = child.turn.waitForCurrentTurn();
  const turnId = child.turn.currentId;
  const onAbort = (): void => child.turn.cancel(turnId, signal.reason);
  if (signal.aborted) onAbort();
  else signal.addEventListener('abort', onAbort, { once: true });
  const completion = await pending.finally(() => signal.removeEventListener('abort', onAbort));
  signal.throwIfAborted();
  const turnEnded = completion.event;
  if (turnEnded.reason !== 'completed') {
    if (turnEnded.reason === 'filtered') {
      throw new Error('Subagent turn blocked by provider safety policy');
    }
    if (turnEnded.error?.code === ErrorCodes.PROVIDER_RATE_LIMIT) {
      throw providerRateLimitErrorFromPayload(turnEnded.error);
    }
    const failure = new Error(
      turnEnded.error === undefined
        ? `Subagent turn ${turnEnded.reason}`
        : `[${turnEnded.error.code}] ${turnEnded.error.message}`,
    );
    // Preserve the provider HTTP status so downstream classifiers can tell
    // transient 5xx failures apart from permanent 4xx after payload flattening.
    const failureStatusCode = turnEnded.error?.details?.['statusCode'];
    if (typeof failureStatusCode === 'number') {
      (failure as Error & { statusCode?: number }).statusCode = failureStatusCode;
    }
    throw failure;
  }
  if (completion.stopReason === 'max_tokens') {
    throw new SubagentMaxTokensError(`${SUBAGENT_MAX_TOKENS_ERROR}.`);
  }
}

function providerRateLimitErrorFromPayload(error: LioraErrorPayload): APIProviderRateLimitError {
  const requestId =
    typeof error.details?.['requestId'] === 'string' ? error.details['requestId'] : null;
  return new APIProviderRateLimitError(error.message, requestId);
}



