/**
 * Public subagent-host types and batch re-exports.
 *
 * Extracted so callers (events, telemetry, batch, collaboration) can depend on
 * option shapes without importing the SessionSubagentHost class.
 */

import type { TokenUsage } from '@superliora/kosong';

import type { SubagentResultContract } from './subagent-result-contract';

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
  /** Wall-clock budget for the run; drives finishing mode and telemetry (T4-5). */
  readonly timeoutMs?: number;
  /** Shared contract file that must compile before the subagent is spawned (T4-3). */
  readonly contractPath?: string;
  /** File paths the subagent owns; claimed at spawn so overlaps fail fast (T4-2). */
  readonly ownership?: readonly string[];
  readonly onReady?: () => void;
  readonly suppressRateLimitFailureEvent?: boolean;
}

export interface SpawnSubagentOptions extends RunSubagentOptions {
  readonly profileName: string;
  readonly profileBaseName?: string;
}

export type SubagentCompletion = {
  readonly result: string;
  readonly usage?: TokenUsage;
  readonly contract?: SubagentResultContract;
};

export type SubagentHandle = {
  readonly agentId: string;
  readonly profileName: string;
  readonly resumed: boolean;
  readonly completion: Promise<SubagentCompletion>;
};
