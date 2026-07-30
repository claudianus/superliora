import type { TokenUsage } from '@superliora/kosong';

import type {
  RunSubagentOptions,
  SpawnSubagentOptions,
  SubagentHandle,
} from './subagent-host';

type BaseQueuedSubagentTask<T> = {
  readonly data: T;
  readonly profileName: string;
  readonly profileBaseName?: string;
  readonly parentToolCallId: string;
  readonly parentToolCallUuid?: string;
  readonly prompt: string;
  readonly description: string;
  readonly swarmIndex?: number;
  readonly swarmItem?: string;
  readonly runInBackground: boolean;
  readonly timeout?: number;
  readonly contractPath?: string;
  readonly signal?: AbortSignal;
};

export type SpawnQueuedSubagentTask<T = unknown> = BaseQueuedSubagentTask<T> & {
  readonly kind: 'spawn';
  readonly resumeAgentId?: undefined;
};

export type ResumeQueuedSubagentTask<T = unknown> = BaseQueuedSubagentTask<T> & {
  readonly kind: 'resume';
  readonly resumeAgentId: string;
};

export type QueuedSubagentTask<T = unknown> =
  | SpawnQueuedSubagentTask<T>
  | ResumeQueuedSubagentTask<T>;

export type SubagentResult<T = unknown> = {
  readonly task: QueuedSubagentTask<T>;
  readonly agentId?: string;
  readonly status: 'completed' | 'failed' | 'aborted';
  readonly state?: 'started' | 'not_started';
  readonly result?: string;
  readonly usage?: TokenUsage;
  readonly error?: string;
  /**
   * Structured reason for failed/aborted outcomes. Lets downstream recovery
   * prompts distinguish recoverable failures (e.g. transient provider 5xx)
   * from terminal ones (e.g. `max_tokens` — needs a larger context window,
   * not a retry).
   */
  readonly failureReason?: 'max_tokens' | 'transient' | 'aborted' | 'other';
};

export type SubagentSuspendedEvent = {
  readonly task: QueuedSubagentTask;
  readonly agentId: string;
  readonly reason: string;
};

export type SubagentBatchLauncher = {
  spawn(options: SpawnSubagentOptions): Promise<SubagentHandle>;
  resume(agentId: string, options: RunSubagentOptions): Promise<SubagentHandle>;
  retry(agentId: string, options: RunSubagentOptions): Promise<SubagentHandle>;
  suspended?(event: SubagentSuspendedEvent): void;
};

export type RateLimitedOutcome = {
  readonly type: 'rate_limited';
  readonly agentId: string;
  readonly error: string;
};

export type AttemptOutcome<T> = SubagentResult<T> | RateLimitedOutcome;

export type TaskState<T> = {
  readonly index: number;
  readonly task: QueuedSubagentTask<T>;
  agentId?: string;
  retryAgentId?: string;
  retryCount: number;
  retryReadyAt: number;
  started: boolean;
  /** In-place retries spent on transient provider failures (bounded). */
  transientRetryCount: number;
};

export type ActiveAttempt<T> = {
  readonly state: TaskState<T>;
  readonly controller: AbortController;
  cleanup: () => void;
  ready: boolean;
  timedOut: boolean;
};

export type SubagentBatchOptions = {
  /**
   * Optional cap on how many subagents may run concurrently during the normal
   * phase. `undefined` means no cap (legacy ramp behavior). The rate-limit
   * phase is governed by its own capacity logic and is not affected.
   */
  readonly maxConcurrency?: number;
};
