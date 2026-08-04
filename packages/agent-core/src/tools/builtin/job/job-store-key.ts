/**
 * Job ledger store key — meta-orchestrator (Conductor) work units.
 * Execution-lane Jobs are tracked here; Fleet/workers attach later.
 */

import type { JobProgressSnapshot } from '@superliora/protocol';

import type { GoalBudgetLimits } from '../../../agent/goal/types';
import type { SubagentResultContract } from '../../../session/subagent/subagent-result-contract';

export const JOB_LEDGER_STORE_KEY = 'job_ledger' as const;
export const JOB_WARM_POOL_STORE_KEY = 'job_warm_pool' as const;

export type JobStatus =
  | 'queued'
  | 'running'
  | 'blocked'
  | 'needs_user'
  | 'done'
  | 'failed'
  | 'cancelled'
  | 'interrupted';

/**
 * `desk` (contract §4.2): inbox/notification digest worker that keeps burst
 * handling off the main conductor turn.
 * `goal-driver` (spec 2026-08-04-goal-driver-jobs): autonomous goal loop —
 * the goal lives on the worker agent, so the worker self-continues in its
 * own worktree while the conductor lane stays free. Multiple goal-drivers
 * run in parallel, one per goal.
 */
export type JobKind =
  | 'task'
  | 'explore'
  | 'implement'
  | 'mission'
  | 'merge'
  | 'desk'
  | 'goal-driver';

export interface JobRecord {
  readonly id: string;
  readonly title: string;
  readonly status: JobStatus;
  readonly kind: JobKind;
  readonly priority: number;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly prompt?: string;
  readonly ownershipPaths?: readonly string[];
  /** Read-first hints rendered into the worker prompt (cold-start shortcut). */
  readonly contextPaths?: readonly string[];
  readonly worktreePath?: string;
  readonly workerAgentId?: string;
  readonly missionRunId?: string;
  /** Goal-driver binding (spec 2026-08-04-goal-driver-jobs): the goal the driver worker pursues. */
  readonly goalId?: string;
  readonly goalObjective?: string;
  readonly goalCompletionCriterion?: string;
  readonly goalBudgetLimits?: GoalBudgetLimits;
  readonly resultSummary?: string;
  /** Machine-readable handoff facts (files changed, verification) from the worker contract. */
  readonly resultContract?: SubagentResultContract;
  readonly parentJobId?: string;
  readonly notes?: string;
  /** Worker progress (phase/recent tools/heartbeat) mirrored to `job.updated` v2. */
  readonly progress?: JobProgressSnapshot;
}

export interface JobLedger {
  readonly jobs: readonly JobRecord[];
  readonly schemaVersion: 1;
}

export function emptyJobLedger(): JobLedger {
  return { schemaVersion: 1, jobs: [] };
}

/** Short stable id: job_<10 base36 chars from time+entropy>. */
export function createJobId(now = Date.now(), random = Math.random): string {
  const timePart = now.toString(36);
  const randPart = Math.floor(random() * 1e10)
    .toString(36)
    .padStart(6, '0')
    .slice(0, 6);
  return `job_${timePart}${randPart}`.slice(0, 18);
}
