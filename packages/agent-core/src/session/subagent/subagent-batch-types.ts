import type { TokenUsage } from '@superliora/kosong';

import type {
  RunSubagentOptions,
  SpawnSubagentOptions,
  SubagentHandle,
} from './subagent-host';

type BaseQueuedSubagentTask<T> = {
  readonly data: T;
  readonly profileName?: 'agent';
  readonly parentToolCallId: string;
  readonly parentToolCallUuid?: string;
  readonly prompt: string;
  readonly description: string;
  readonly swarmIndex?: number;
  readonly swarmItem?: string;
  readonly runInBackground: boolean;
  readonly timeout?: number;
  readonly signal?: AbortSignal;
  /** Per-worker git worktree cwd when fleet env opt-in is enabled. */
  readonly worktreeDir?: string;
  readonly ownership?: readonly string[];
  readonly modelAlias?: string;
  readonly permissionMode?: 'yolo' | 'auto' | 'manual';
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
  readonly filesChanged?: readonly string[];
  readonly context?: { readonly agentId: string; readonly contextTokens: number };
  readonly error?: string;
  /**
   * Structured reason for failed/aborted outcomes. Lets downstream recovery
   * prompts distinguish recoverable failures (e.g. transient provider 5xx)
   * from terminal ones (e.g. `max_tokens` — needs a larger context window,
   * not a retry).
   */
  readonly failureReason?: 'max_tokens' | 'transient' | 'aborted' | 'other';
};


export type SubagentBatchLauncher = {
  spawn(options: SpawnSubagentOptions): Promise<SubagentHandle>;
  resume(agentId: string, options: RunSubagentOptions): Promise<SubagentHandle>;
};


export type SubagentBatchOptions = {
  /** Maximum simultaneous launches for this explicitly requested batch. */
  readonly maxConcurrency?: number;
};
