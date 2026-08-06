/**
 * Public subagent-host types and batch re-exports.
 *
 * Extracted so callers (events, telemetry, batch, collaboration) can depend on
 * option shapes without importing the SessionSubagentHost class.
 */

import type { TokenUsage } from '@superliora/kosong';

import type { GoalBudgetLimits, GoalStatus } from '../../agent/goal/types';
import type { SubagentFriction } from './subagent-friction';
import type { SubagentResultContract } from './subagent-result-contract';

export type {
  SubagentResult as QueuedSubagentRunResult,
  QueuedSubagentTask,
  ResumeQueuedSubagentTask,
  SpawnQueuedSubagentTask,
} from './subagent-batch';

/**
 * Goal migrated onto the worker agent at spawn time
 * (spec 2026-08-04-goal-driver-jobs). The runtime creates the goal
 * mechanically before the task prompt turn; the turn engine then drives the
 * autonomous continuation loop on the worker lane.
 */
export interface SubagentGoalBinding {
  readonly objective: string;
  readonly completionCriterion?: string;
  readonly budgetLimits?: GoalBudgetLimits;
}

/**
 * Structured plan activated on the worker at spawn (Plan Desk / mission Jobs).
 * Mirrors goal migration: the runtime calls planMode.enter before the task turn.
 */
export interface SubagentPlanBinding {
  /** Structured pipeline (research→interview→…); default true for Plan Desk. */
  readonly ultra?: boolean;
  readonly initialContext?: string;
  readonly planId?: string;
}

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
  /** Isolated git worktree cwd for fleet workers (SUPERLIORA_FLEET_WORKTREE=1 soft path). */
  readonly worktreeDir?: string;
  /**
   * Migrate a Goal onto the worker agent before its task prompt turn
   * (goal-driver Jobs): the worker self-continues toward it in its own lane.
   */
  readonly goal?: SubagentGoalBinding;
  /**
   * Activate structured / free-form plan mode on the worker before its task
   * prompt (Plan Desk mission Jobs).
   */
  readonly plan?: SubagentPlanBinding;
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
  /** Deterministic struggle stats for the parent's refine pipeline. */
  readonly friction?: SubagentFriction;
  /**
   * Terminal state of a migrated goal (goal-driver Jobs). `complete` when the
   * worker met the objective (the record is cleared on completion), otherwise
   * the stopped status (`blocked`/`paused`) the caller maps onto its ledger.
   */
  readonly goalStatus?: GoalStatus;
  readonly goalId?: string;
  readonly goalTerminalReason?: string;
};

export type SubagentHandle = {
  readonly agentId: string;
  readonly profileName: string;
  readonly resumed: boolean;
  readonly completion: Promise<SubagentCompletion>;
};
