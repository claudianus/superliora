import type { TokenUsage } from '@superliora/kosong';

export type {
  SubagentResult as QueuedSubagentRunResult,
  QueuedSubagentTask,
  ResumeQueuedSubagentTask,
  SpawnQueuedSubagentTask,
} from './subagent-batch';

export interface RunSubagentOptions {
  readonly parentToolCallId: string;
  readonly parentToolCallUuid?: string;
  readonly prompt: string;
  readonly description: string;
  readonly swarmIndex?: number;
  readonly swarmItem?: string;
  readonly runInBackground: boolean;
  readonly signal: AbortSignal;
  /** Explicit wall-clock limit; zero leaves the run unlimited. */
  readonly timeoutMs?: number;
  readonly ownership?: readonly string[];
  /** Deliberately selected isolated worker cwd. */
  readonly worktreeDir?: string;
  readonly modelAlias?: string;
  readonly permissionMode?: 'yolo' | 'auto' | 'manual';
  readonly onReady?: () => void;
}

export interface SpawnSubagentOptions extends RunSubagentOptions {
  readonly profileName?: 'agent';
}

/** Observed turn completion, not a claim that the assigned task is verified. */
export type SubagentCompletion = {
  readonly status: 'completed';
  readonly result: string;
  readonly usage?: TokenUsage;
  readonly filesChanged: readonly string[];
  readonly context: {
    readonly agentId: string;
    readonly contextTokens: number;
  };
};

export type SubagentHandle = {
  readonly agentId: string;
  readonly profileName: string;
  readonly resumed: boolean;
  readonly completion: Promise<SubagentCompletion>;
  /** Live physical ownership state; undefined while execution is active. */
  readonly resourcesSettled?: boolean;
};
