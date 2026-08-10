/**
 * Job ledger store key — meta-orchestrator (Conductor) work units.
 * Execution-lane Jobs are tracked here; Fleet/workers attach later.
 */

import type { JobProgressSnapshot } from '@superliora/protocol';

import type { GoalBudgetLimits } from '../../../agent/goal/types';
import type { SubagentResultContract } from '../../../session/subagent/subagent-result-contract';

export const JOB_LEDGER_STORE_KEY = 'job_ledger' as const;

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
 * `goal-desk`: Conductor Goal Desk — orchestrates user `/goal` without running
 * the goal loop on the main lane. Spawns `goal-driver` children; no worktree.
 * `goal-driver` (spec 2026-08-04-goal-driver-jobs): autonomous goal loop —
 * the goal lives on the worker agent, so the worker self-continues in its
 * own worktree while the conductor lane stays free. Multiple goal-drivers
 * run in parallel, one per goal.
 */
export type JobKind =
  | 'task'
  | 'explore'
  | 'research'
  | 'implement'
  | 'verify'
  | 'mission'
  | 'merge'
  | 'push'
  | 'desk'
  | 'goal-desk'
  | 'goal-driver';

/** How the worker should deliver — greenfield forces a tighter brief + optional chain. */
export type JobDeliveryMode = 'standard' | 'greenfield';

/**
 * Conductor-declared user-visible surface for merge/verify proof selection.
 * Not inferred from path regex — set at JobCreate (or JobSteer).
 */
export type JobSurfaceKind = 'none' | 'web' | 'tui' | 'mixed';

/** Structured Maker≠Checker verify outcome (preferred over free-text parse). */
export type JobVerifyVerdictField = 'passed' | 'failed';

/**
 * TDD posture for coding Jobs. `required` demands non-empty `testSeams`.
 * Default for task/implement when unset at create time is `preferred`.
 */
export type JobTddMode = 'required' | 'preferred' | 'off';

/**
 * Greenfield chain phase (skeleton → fill → delete_pass). Absent on standard Jobs.
 * Not a JobKind — keeps the ledger kind set stable.
 */
export type JobDeliveryPhase = 'skeleton' | 'fill' | 'delete_pass';

/** Post-merge receipt: command-level proof that main contains the landed branch. */
export interface JobLandReceipt {
  readonly mergeSha: string;
  readonly branch: string;
  readonly verifiedAt: string;
}

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
  /** Verifiable done-lines the worker must prove (structured brief). */
  readonly successCriteria?: readonly string[];
  /** Negative scope fence — paths/concerns the worker must not touch. */
  readonly mustNotTouch?: readonly string[];
  /** Commands the worker should run as proof (structured brief). */
  readonly verificationCommands?: readonly string[];
  /** Pre-agreed public seams for red→green tests (structured brief). */
  readonly testSeams?: readonly string[];
  /** TDD posture; coding Jobs default to preferred when unset at create. */
  readonly tddMode?: JobTddMode;
  /**
   * One agent-runnable command that goes red on this bug (debug Jobs).
   * When absent, the worker must still establish Phase-1 repro before hypothesising.
   */
  readonly reproCommand?: string;
  /**
   * Job ids that must reach a terminal success state before this Job may schedule.
   * Orthogonal to `parentJobId` (decomposition / review chain link).
   */
  readonly blockedByJobIds?: readonly string[];
  /** Delivery posture; greenfield requires successCriteria + mustNotTouch on create. */
  readonly deliveryMode?: JobDeliveryMode;
  /** Greenfield chain step; drives jobPrompt phase contract. */
  readonly deliveryPhase?: JobDeliveryPhase;
  readonly worktreePath?: string;
  /** Branch created for the job worktree (`liora/…`); land prefers this over HEAD. */
  readonly worktreeBranch?: string;
  readonly workerAgentId?: string;
  /**
   * Last worker agent id kept across interrupt so crash recovery can try
   * `host.resume` before cold spawn. Distinct from live `workerAgentId` only
   * when a relaunch overwrites the live id after a failed reattach.
   */
  readonly workerResumeAgentId?: string;
  /** ISO timestamp when `workerResumeAgentId` was last bound to a live worker. */
  readonly workerCheckpointAt?: string;
  /** Goal-driver binding (spec 2026-08-04-goal-driver-jobs): the goal the driver worker pursues. */
  readonly goalId?: string;
  readonly goalObjective?: string;
  readonly goalCompletionCriterion?: string;
  /** Shell gate for goal-driver markComplete (Prime `--autonomous-gate`). */
  readonly goalGateCommand?: string;
  readonly goalBudgetLimits?: GoalBudgetLimits;
  readonly resultSummary?: string;
  /** Machine-readable handoff facts (files changed, verification) from the worker contract. */
  readonly resultContract?: SubagentResultContract;
  /** Set only after post-merge verification proves main contains the branch. */
  readonly landReceipt?: JobLandReceipt;
  readonly parentJobId?: string;
  readonly notes?: string;
  /**
   * Plan Desk: when kind=mission, whether the worker activates Ultra (structured)
   * plan mode. undefined/true = ultra; false = regular free-form plan.
   */
  readonly planStructured?: boolean;
  /** Worker progress (phase/recent tools/heartbeat) mirrored to `job.updated` v2. */
  readonly progress?: JobProgressSnapshot;
  /**
   * Conductor expert staffing (SearchExpert bind). Absent = plain worker.
   * Posture (implement / verify / research) lives on `kind`, not a role field.
   */
  readonly expertId?: string;
  readonly expertScore?: number;
  readonly staffQuery?: string;
  /**
   * Conductor-chosen worker model alias (from fleet catalog when role models
   * are auto). Absent → spawn falls back to profile/role smart route.
   */
  readonly modelAlias?: string;
  /**
   * Dual-axis review child marker. Absent on combined/visual-qa reviews.
   * Parallel Standards∥Spec children each carry one axis.
   */
  readonly reviewAxis?: 'standards' | 'spec';
  /**
   * Conductor-declared surface kind. Merge/verify proof gates key off this —
   * path/keyword heuristics must not invent a web VerifySurface requirement.
   */
  readonly surfaceKind?: JobSurfaceKind;
  /**
   * Structured verify Job verdict. Prefer this over parsing resultSummary JSON.
   * Set when kind=verify reaches a terminal state.
   */
  readonly verifyVerdict?: JobVerifyVerdictField;
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
