/*
Subagent batch scheduling contract:
Normal phase:
- Return results in input order; empty input returns an empty list.
- Start up to 5 tasks immediately, then 1 more every 700 ms while queued work remains. Active tasks are capped at SUPERLIORA_AGENT_SWARM_MAX_CONCURRENCY when set to a positive integer, otherwise at a default of 16; the ramp stops while active tasks reach that cap and resumes as tasks complete.
- Launch priority: previous agent id saved after a rate limit, explicit resume, then new spawn.
- Readiness can be reported while the attempt is active. Ready normal launches seed the first rate-limit capacity.
- The first provider rate limit stops the ramp and enters rate-limit phase.

Rate-limit phase:
- A provider rate limit requeues while there is other unfinished work. Save the agent id for same-agent retry, emit suspended, and requeue the task at the front; its own eligibility delays are 3000 ms, 6000 ms, 12000 ms, then doubling.
- If the rate-limited attempt is the only unfinished task, fail that task instead of suspending the whole batch forever.
- Enter with capacity equal to ready normal launches, minimum 1; set the next global launch no earlier than 3000 ms later; then shrink capacity by 1, minimum 1. Later rate limits shrink by 1, minimum 1, at most once per 2000 ms.
- Each pass starts at most 1 task: active attempts must be below capacity, global launch time reached, and task eligibility reached. Choose the first eligible queued task, then set next global launch to now plus the current interval. If blocked by time or queued work remains after a launch, wake at the earlier of next launch/eligibility and next capacity recovery.
- Core recovery rule: in rate-limit phase, if work is queued and no provider rate limit happened for 3 minutes, capacity increases by 1, which can launch one more task immediately. This can happen once per quiet window; a new rate limit restarts the window. If active attempts still fill capacity, wake at the next recovery time.

Results and cancellation:
- Completed, failed, aborted, and timed-out attempts occupy their input slots; when all slots have results, return the ordered list. A task timeout fails only that task and does not enter rate-limit phase or stop others.
- A transient provider failure (HTTP 5xx, provider overloaded/server_error, connection-level network error) retries the same task in place up to 2 extra attempts with 1000 ms / 2000 ms backoff before failing it; this budget is separate from the rate-limit phase. Timeouts, rate limits, aborts, and permanent errors never use this path.
- A permanent auth/quota/billing failure (401/403, invalid credentials, expired subscription, exhausted credit) fails only that task immediately; it never enters rate-limit phase, requeues, or uses the transient retry budget, even when the provider reports it with a rate-limit-shaped payload.
- The first task signal is the batch signal. User cancellation preserves existing results, marks ready or agent-known unfinished tasks aborted/started, and marks never-started tasks aborted/not_started. Non-user cancellation rejects.
*/

import { isUserCancellation } from '../../utils/abort';
import {
  buildUserCancellationResults,
  createInitialTaskStates,
  linkAttemptSignals,
  markAttemptReady,
  runSubagentAttempt,
} from './subagent-batch-attempt';
import {
  INITIAL_LAUNCH_INTERVAL_MS,
  INITIAL_LAUNCH_LIMIT,
} from './subagent-batch-constants';
import type {
  ActiveAttempt,
  AttemptOutcome,
  QueuedSubagentTask,
  SubagentBatchLauncher,
  SubagentBatchOptions,
  SubagentResult,
  TaskState,
} from './subagent-batch-types';
import { SubagentBatchRateLimit } from './subagent-batch-rate-limit';

export type {
  QueuedSubagentTask,
  ResumeQueuedSubagentTask,
  SpawnQueuedSubagentTask,
  SubagentBatchLauncher,
  SubagentBatchOptions,
  SubagentResult,
  SubagentSuspendedEvent,
} from './subagent-batch-types';
export { classifySubagentFailureReason } from './subagent-batch-failure';
export { DEFAULT_SWARM_MAX_CONCURRENCY, resolveSwarmMaxConcurrency } from './subagent-batch-concurrency';

export class SubagentBatch<T> {
  private readonly states: Array<TaskState<T>>;
  private readonly pending: Array<TaskState<T>>;
  private readonly results: Array<SubagentResult<T> | undefined>;
  private readonly active = new Set<ActiveAttempt<T>>();
  private readonly controller = new AbortController();
  private readonly batchSignal: AbortSignal | undefined;
  private readonly batchAbortListener: () => void;
  private readonly maxConcurrency: number | undefined;
  private readonly rateLimit = new SubagentBatchRateLimit<T>();
  private normalLaunchCount = 0;
  private normalLaunchTimer: ReturnType<typeof setTimeout> | undefined;
  private resolve: ((results: Array<SubagentResult<T>>) => void) | undefined;
  private reject: ((error: unknown) => void) | undefined;
  private finished = false;
  private started = false;
  private startedSuccessCount = 0;

  constructor(
    private readonly launcher: SubagentBatchLauncher,
    tasks: readonly QueuedSubagentTask<T>[],
    options: SubagentBatchOptions = {},
  ) {
    this.maxConcurrency = options.maxConcurrency;
    this.states = createInitialTaskStates(tasks);
    this.pending = [...this.states];
    this.results = Array.from({ length: tasks.length });
    this.batchSignal = tasks.find((task) => task.signal !== undefined)?.signal;
    this.batchAbortListener = () => {
      this.controller.abort(this.batchSignal?.reason);
      if (isUserCancellation(this.batchSignal?.reason)) {
        this.finishWithUserCancellation();
      } else {
        this.fail(this.batchSignal?.reason ?? new Error('Aborted'));
      }
    };
  }

  run(): Promise<Array<SubagentResult<T>>> {
    if (this.started) {
      throw new Error('SubagentBatch.run() can only be called once.');
    }
    this.started = true;

    return new Promise((resolve, reject) => {
      this.resolve = resolve;
      this.reject = reject;

      if (this.states.length === 0) {
        this.finish([]);
        return;
      }

      if (this.batchSignal?.aborted === true) {
        this.batchAbortListener();
        return;
      }

      this.batchSignal?.addEventListener('abort', this.batchAbortListener, { once: true });
      this.schedule();
    });
  }

  private schedule(): void {
    if (this.finished) return;
    if (this.finishIfComplete()) return;
    if (this.controller.signal.aborted) return;

    if (this.rateLimit.rateLimitMode) {
      this.scheduleRateLimitLaunch();
    } else {
      this.scheduleNormalLaunch();
    }
  }

  private scheduleNormalLaunch(): void {
    while (
      this.normalLaunchCount < INITIAL_LAUNCH_LIMIT &&
      this.pending.length > 0 &&
      !this.rateLimit.rateLimitMode &&
      !this.isAtConcurrencyLimit()
    ) {
      this.startAttempt(this.pending.shift()!);
      this.normalLaunchCount += 1;
    }

    if (
      this.pending.length === 0 ||
      this.rateLimit.rateLimitMode ||
      this.normalLaunchTimer !== undefined ||
      this.isAtConcurrencyLimit()
    ) {
      return;
    }

    this.normalLaunchTimer = setTimeout(() => {
      this.normalLaunchTimer = undefined;
      if (this.finished || this.rateLimit.rateLimitMode || this.pending.length === 0) return;
      if (this.isAtConcurrencyLimit()) return;
      this.startAttempt(this.pending.shift()!);
      this.normalLaunchCount += 1;
      this.schedule();
    }, INITIAL_LAUNCH_INTERVAL_MS);
  }

  private isAtConcurrencyLimit(): boolean {
    return this.maxConcurrency !== undefined && this.active.size >= this.maxConcurrency;
  }

  private scheduleRateLimitLaunch(): void {
    this.rateLimit.scheduleLaunch({
      pending: this.pending,
      active: this.active,
      finished: this.finished,
      startAttempt: (state) =>{  this.startAttempt(state); },
      schedule: () =>{  this.schedule(); },
    });
  }

  private startAttempt(state: TaskState<T>): void {
    if (this.finished || this.controller.signal.aborted) return;

    const attempt: ActiveAttempt<T> = {
      state,
      controller: new AbortController(),
      cleanup: () => {},
      ready: false,
      timedOut: false,
    };
    attempt.cleanup = linkAttemptSignals(attempt, state.task, this.controller);
    this.active.add(attempt);

    this.runAttempt(attempt).then(
      (outcome) => {
        this.handleAttemptOutcome(attempt, outcome);
      },
      (error) => {
        this.handleAttemptError(attempt, error);
      },
    );
  }

  private runAttempt(attempt: ActiveAttempt<T>): Promise<AttemptOutcome<T>> {
    return runSubagentAttempt(attempt, this.launcher, this.finished, () => {
      this.markAttemptReady(attempt);
    });
  }

  private markAttemptReady(attempt: ActiveAttempt<T>): void {
    markAttemptReady(attempt, this.active, {
      finished: this.finished,
      rateLimitMode: this.rateLimit.rateLimitMode,
      onReadyInNormalPhase: () => {
        this.startedSuccessCount += 1;
      },
      onReadyInRateLimitPhase: () => {
        this.rateLimit.onAttemptReadyInRateLimitPhase(() =>{  this.schedule(); });
      },
    });
  }

  private handleAttemptOutcome(attempt: ActiveAttempt<T>, outcome: AttemptOutcome<T>): void {
    if (!this.releaseAttempt(attempt)) return;
    if (this.finished) return;

    if ('status' in outcome) {
      this.results[attempt.state.index] = outcome;
    } else if (this.isOnlyUnfinishedTask(attempt.state)) {
      this.results[attempt.state.index] = {
        task: attempt.state.task,
        agentId: outcome.agentId,
        status: 'failed',
        state: 'started',
        error: outcome.error,
      };
    } else {
      this.rateLimit.requeueRateLimited(
        attempt,
        outcome.agentId,
        this.launcher,
        this.pending,
        () =>{  this.clearNormalTimer(); },
        this.startedSuccessCount,
      );
    }
    this.schedule();
  }

  private handleAttemptError(attempt: ActiveAttempt<T>, error: unknown): void {
    if (!this.releaseAttempt(attempt)) return;
    if (this.finished) return;
    this.results[attempt.state.index] = {
      task: attempt.state.task,
      agentId: attempt.state.agentId,
      status: 'failed',
      error: error instanceof Error ? error.message : String(error),
    };
    this.schedule();
  }

  private releaseAttempt(attempt: ActiveAttempt<T>): boolean {
    if (!this.active.delete(attempt)) return false;
    attempt.cleanup();
    return true;
  }

  private finishIfComplete(): boolean {
    if (this.results.every((result) => result !== undefined)) {
      this.finish(this.results);
      return true;
    }
    return false;
  }

  private isOnlyUnfinishedTask(state: TaskState<T>): boolean {
    return this.results.every((result, index) => index === state.index || result !== undefined);
  }

  private finishWithUserCancellation(): void {
    if (this.finished) return;
    this.finish(buildUserCancellationResults(this.states, this.results));
  }

  private finish(results: Array<SubagentResult<T>>): void {
    if (this.finished) return;
    this.finished = true;
    this.cleanup();
    this.resolve?.(results);
  }

  private fail(error: unknown): void {
    if (this.finished) return;
    this.finished = true;
    this.cleanup();
    this.reject?.(error);
  }

  private cleanup(): void {
    this.batchSignal?.removeEventListener('abort', this.batchAbortListener);
    this.clearNormalTimer();
    this.rateLimit.clearTimer();
    for (const attempt of this.active.values()) {
      attempt.cleanup();
    }
    this.active.clear();
  }

  private clearNormalTimer(): void {
    if (this.normalLaunchTimer !== undefined) clearTimeout(this.normalLaunchTimer);
    this.normalLaunchTimer = undefined;
  }
}
