/**
 * Job worker affinity — keep same-context follow-ups on an existing Job/worker
 * instead of cold-spawning a sibling that drops transcript context.
 *
 * Disposition:
 * - steer: live worker (running / needs_user) → JobSteer delta, no new Job
 * - fold: queued Job → patch brief in place, no new Job
 * - reattach: terminal unlanded coding Job → same job_id requeued + resume
 * - reuse: other terminal anchors (explore/mission) → child inheriting worktree + resume
 */

import type { ToolStore } from '../../store';
import { getJob, listJobs, type JobKind, type JobRecord, type JobStatus } from './job-ledger';
import { ownershipPathsOverlap } from './job-ownership';

/** Kinds that may share a worker / worktree via affinity as the *new* Job. */
const AFFINITY_KINDS = new Set<JobKind>(['task', 'implement', 'explore', 'research']);

/**
 * Anchor kinds eligible for continue_from reuse.
 * Terminal `mission` (approved Plan Desk) may seed an implement child on the
 * same worktree/resume so context is not cold-restarted.
 */
const AFFINITY_ANCHOR_KINDS = new Set<JobKind>([
  'task',
  'implement',
  'explore',
  'research',
  'mission',
]);

const LIVE_STATUSES = new Set<JobStatus>(['running', 'needs_user']);
const FOLD_STATUSES = new Set<JobStatus>(['queued']);
const REUSE_STATUSES = new Set<JobStatus>([
  'done',
  'failed',
  'interrupted',
  'blocked',
  'cancelled',
]);

export type JobAffinityMode = 'off' | 'auto';

export type JobAffinityDisposition =
  | { readonly action: 'steer'; readonly anchor: JobRecord }
  | { readonly action: 'fold'; readonly anchor: JobRecord }
  | { readonly action: 'reattach'; readonly anchor: JobRecord }
  | { readonly action: 'reuse'; readonly anchor: JobRecord }
  | { readonly action: 'reject'; readonly reason: string };

export interface JobAffinityRequest {
  readonly continueFromJobId?: string;
  readonly affinity?: JobAffinityMode;
  readonly kind?: JobKind;
  readonly ownershipPaths?: readonly string[];
  readonly contextPaths?: readonly string[];
  readonly autoSplit?: boolean;
  readonly greenfieldChain?: boolean;
}

/** Weighted same-context fit of a candidate anchor, with readable reasons. */
export interface JobAffinityScore {
  readonly score: number;
  readonly reasons: readonly string[];
}

/** Recency buckets: a warm worker shares more reusable context than an old one. */
const AFFINITY_AGE_BUCKETS: readonly { readonly maxHours: number; readonly points: number; readonly label: string }[] = [
  { maxHours: 1, points: 3, label: 'age<=1h' },
  { maxHours: 6, points: 2, label: 'age<=6h' },
  { maxHours: 24, points: 1, label: 'age<=24h' },
];

/**
 * Score how well a Job can host a same-context follow-up. Status ladders and
 * eligibility gates stay outside this function — the score only orders
 * candidates within the same status tier. Deterministic; no wall-clock
 * assertions (buckets tolerate CI timing).
 */
export function scoreAffinityCandidate(
  anchor: JobRecord,
  input: {
    readonly kind?: JobKind;
    readonly ownershipPaths?: readonly string[];
    readonly contextPaths?: readonly string[];
  },
): JobAffinityScore {
  const reasons: string[] = [];
  let score = 0;

  let ownershipOverlap = 0;
  for (const path of input.ownershipPaths ?? []) {
    if (ownershipPathsOverlap([path], anchor.ownershipPaths) !== undefined) ownershipOverlap += 1;
  }
  if (ownershipOverlap > 0) {
    score += 3 * ownershipOverlap;
    reasons.push(`paths=${String(ownershipOverlap)}`);
  }

  let contextOverlap = 0;
  for (const path of input.contextPaths ?? []) {
    if (ownershipPathsOverlap([path], anchor.contextPaths) !== undefined) contextOverlap += 1;
  }
  if (contextOverlap > 0) {
    score += contextOverlap;
    reasons.push(`context=${String(contextOverlap)}`);
  }

  if (input.kind !== undefined && anchor.kind === input.kind) {
    score += 1;
    reasons.push(`kind=${anchor.kind}`);
  }

  if (anchor.workerResumeAgentId !== undefined) {
    score += 2;
    reasons.push(`resume=${anchor.workerResumeAgentId.slice(0, 24)}`);
  }

  const updatedAtMs = Date.parse(anchor.updatedAt);
  if (Number.isFinite(updatedAtMs)) {
    const ageHours = (Date.now() - updatedAtMs) / 3_600_000;
    for (const bucket of AFFINITY_AGE_BUCKETS) {
      if (ageHours <= bucket.maxHours) {
        score += bucket.points;
        reasons.push(bucket.label);
        break;
      }
    }
  }

  return { score, reasons };
}

export function isAffinityEligibleKind(kind: JobKind | undefined): boolean {
  if (kind === undefined) return true;
  return AFFINITY_KINDS.has(kind);
}

export function isAffinityEligibleAnchorKind(kind: JobKind | undefined): boolean {
  if (kind === undefined) return false;
  return AFFINITY_ANCHOR_KINDS.has(kind);
}

export function resolveJobAffinity(
  store: ToolStore,
  request: JobAffinityRequest,
): JobAffinityDisposition | undefined {
  if (request.autoSplit === true) {
    if (request.continueFromJobId !== undefined || request.affinity === 'auto') {
      return {
        action: 'reject',
        reason:
          'Job affinity cannot combine with auto_split — affinity keeps one Job; split intents need separate creates or an explicit merge.',
      };
    }
    return undefined;
  }
  if (request.greenfieldChain === true) {
    if (request.continueFromJobId !== undefined || request.affinity === 'auto') {
      return {
        action: 'reject',
        reason:
          'Job affinity cannot combine with greenfield_chain — the skeleton→fill→delete-pass chain owns its own parent links.',
      };
    }
    return undefined;
  }

  const wantKind = request.kind ?? 'task';
  if (!isAffinityEligibleKind(wantKind)) {
    if (request.continueFromJobId !== undefined || request.affinity === 'auto') {
      return {
        action: 'reject',
        reason: `Job affinity does not apply to kind=${wantKind} (Maker≠Checker / control-plane kinds stay on a fresh Job).`,
      };
    }
    return undefined;
  }

  const anchor =
    request.continueFromJobId !== undefined
      ? getJob(store, request.continueFromJobId)
      : request.affinity === 'auto'
        ? findAffinityAnchor(store, {
            kind: wantKind,
            ownershipPaths: request.ownershipPaths,
            contextPaths: request.contextPaths,
          })
        : undefined;

  if (request.continueFromJobId !== undefined && anchor === undefined) {
    return {
      action: 'reject',
      reason: `continue_from_job_id not found: ${request.continueFromJobId}`,
    };
  }
  if (anchor === undefined) return undefined;

  if (!isAffinityEligibleAnchorKind(anchor.kind)) {
    return {
      action: 'reject',
      reason: `continue_from job ${anchor.id} kind=${anchor.kind} is not affinity-eligible.`,
    };
  }

  // Plan Desk mission: only terminal reuse into coding implement/task.
  // Do not steer/fold a live plan worker into product writes, and do not
  // continue_from mission into explore/research.
  if (anchor.kind === 'mission') {
    if (wantKind !== 'implement' && wantKind !== 'task') {
      return {
        action: 'reject',
        reason: `continue_from mission ${anchor.id} only allows kind=implement|task (got ${wantKind}).`,
      };
    }
    if (!REUSE_STATUSES.has(anchor.status)) {
      return {
        action: 'reject',
        reason: `continue_from mission ${anchor.id} requires a terminal status (got ${anchor.status}); wait for plan approval/ExitPlanMode.`,
      };
    }
    if (anchor.landReceipt !== undefined) {
      return {
        action: 'reject',
        reason: `continue_from job ${anchor.id} already landed — start a fresh Job instead of reusing its worktree.`,
      };
    }
    return { action: 'reuse', anchor };
  }

  if (LIVE_STATUSES.has(anchor.status)) {
    return { action: 'steer', anchor };
  }
  if (FOLD_STATUSES.has(anchor.status)) {
    return { action: 'fold', anchor };
  }
  if (REUSE_STATUSES.has(anchor.status)) {
    if (anchor.landReceipt !== undefined) {
      return {
        action: 'reject',
        reason: `continue_from job ${anchor.id} already landed — start a fresh Job instead of reusing its worktree.`,
      };
    }
    // Same coding session: reattach the job_id instead of a child that drops
    // the user's session identity. explore/research stay reuse (profile wall).
    if (
      (wantKind === 'task' || wantKind === 'implement') &&
      (anchor.kind === 'task' || anchor.kind === 'implement')
    ) {
      return { action: 'reattach', anchor };
    }
    return { action: 'reuse', anchor };
  }
  return {
    action: 'reject',
    reason: `continue_from job ${anchor.id} status=${anchor.status} cannot accept affinity.`,
  };
}

/**
 * Pick the best same-context Job for affinity=auto.
 * Status tiers come first (live → queued → terminal); within a tier the
 * multi-factor {@link scoreAffinityCandidate} decides, with updatedAt as the
 * final tiebreak so behavior stays deterministic for identical scores.
 */
export function findAffinityAnchor(
  store: ToolStore,
  input: {
    readonly kind: JobKind;
    readonly ownershipPaths?: readonly string[];
    readonly contextPaths?: readonly string[];
  },
): JobRecord | undefined {
  const paths = input.ownershipPaths;
  if (paths === undefined || paths.length === 0) return undefined;

  const candidates = listJobs(store).filter(
    (j) =>
      // Auto affinity still excludes mission — only explicit continue_from_job_id
      // may pick up a terminal Plan Desk worktree.
      isAffinityEligibleKind(j.kind) &&
      ownershipPathsOverlap(paths, j.ownershipPaths) !== undefined &&
      j.landReceipt === undefined,
  );
  if (candidates.length === 0) return undefined;

  const live = bestScored(candidates.filter((j) => LIVE_STATUSES.has(j.status)), input);
  if (live !== undefined) return live;

  const queued = bestScored(candidates.filter((j) => FOLD_STATUSES.has(j.status)), input);
  if (queued !== undefined) return queued;

  return bestScored(candidates.filter((j) => REUSE_STATUSES.has(j.status)), input);
}

/** Soft hint when a cold create overlaps a live/queued owner (no continue_from). */
export function findAffinityHint(
  store: ToolStore,
  input: {
    readonly kind?: JobKind;
    readonly ownershipPaths?: readonly string[];
    readonly contextPaths?: readonly string[];
    readonly excludeJobIds?: ReadonlySet<string>;
  },
): JobRecord | undefined {
  const paths = input.ownershipPaths;
  if (paths === undefined || paths.length === 0) return undefined;
  const exclude = input.excludeJobIds ?? new Set<string>();
  const holders = listJobs(store).filter(
    (j) =>
      !exclude.has(j.id) &&
      isAffinityEligibleKind(j.kind) &&
      (LIVE_STATUSES.has(j.status) || FOLD_STATUSES.has(j.status)) &&
      ownershipPathsOverlap(paths, j.ownershipPaths) !== undefined,
  );
  return bestScored(holders, input);
}

export function formatAffinityHint(
  anchor: JobRecord,
  input?: {
    readonly kind?: JobKind;
    readonly ownershipPaths?: readonly string[];
    readonly contextPaths?: readonly string[];
  },
): string {
  const path =
    anchor.ownershipPaths !== undefined && anchor.ownershipPaths.length > 0
      ? ` owns ${anchor.ownershipPaths.slice(0, 3).join(',')}`
      : '';
  const scored =
    input === undefined
      ? ''
      : (() => {
          const { score, reasons } = scoreAffinityCandidate(anchor, input);
          return score > 0 ? ` score=${String(score)} (${reasons.join(', ')})` : '';
        })();
  return (
    `affinity_hint: ${anchor.id} (${anchor.status}${path}) — ` +
    `same-context follow-up: JobSteer or JobCreate(continue_from_job_id=${anchor.id}) / affinity=auto; ` +
    `do not cold-spawn a sibling that races the same paths.${scored}`
  );
}

export function buildAffinitySteerMessage(input: {
  readonly title: string;
  readonly prompt?: string;
  readonly successCriteria?: readonly string[];
  readonly mustNotTouch?: readonly string[];
  readonly verificationCommands?: readonly string[];
  readonly contextPaths?: readonly string[];
}): string {
  const lines = [
    `[affinity] Scope delta — keep the existing finish line unless criteria below replace it.`,
    `Title: ${input.title}`,
  ];
  const prompt = input.prompt?.trim();
  if (prompt) lines.push(`Delta:\n${prompt}`);
  if (input.successCriteria !== undefined && input.successCriteria.length > 0) {
    lines.push(`Updated success_criteria:\n- ${input.successCriteria.join('\n- ')}`);
  }
  if (input.mustNotTouch !== undefined && input.mustNotTouch.length > 0) {
    lines.push(`must_not_touch:\n- ${input.mustNotTouch.join('\n- ')}`);
  }
  if (
    input.verificationCommands !== undefined &&
    input.verificationCommands.length > 0
  ) {
    lines.push(`verification_commands:\n- ${input.verificationCommands.join('\n- ')}`);
  }
  if (input.contextPaths !== undefined && input.contextPaths.length > 0) {
    lines.push(`context_paths: ${input.contextPaths.join(', ')}`);
  }
  return lines.join('\n');
}

/** Merge unique string lists (prefer existing order, append new). */
export function mergeStringLists(
  existing: readonly string[] | undefined,
  incoming: readonly string[] | undefined,
): readonly string[] | undefined {
  if (incoming === undefined || incoming.length === 0) return existing;
  if (existing === undefined || existing.length === 0) return incoming;
  const seen = new Set(existing.map((s) => s.trim()));
  const out = [...existing];
  for (const item of incoming) {
    const t = item.trim();
    if (t.length === 0 || seen.has(t)) continue;
    seen.add(t);
    out.push(t);
  }
  return out;
}

export function reuseInheritanceFromAnchor(anchor: JobRecord): {
  readonly parentJobId: string;
  readonly worktreePath?: string;
  readonly worktreeBranch?: string;
  readonly repoRoot?: string;
  readonly workerResumeAgentId?: string;
  readonly workerCheckpointAt?: string;
  readonly ownershipPaths?: readonly string[];
  readonly contextPaths?: readonly string[];
  readonly modelAlias?: string;
  readonly surfaceKind?: JobRecord['surfaceKind'];
  readonly taskTrack?: JobRecord['taskTrack'];
  readonly deliveryClass?: JobRecord['deliveryClass'];
  readonly notes: string;
} {
  return {
    parentJobId: anchor.id,
    worktreePath: anchor.worktreePath,
    worktreeBranch: anchor.worktreeBranch,
    repoRoot: anchor.repoRoot,
    workerResumeAgentId: anchor.workerResumeAgentId,
    workerCheckpointAt: anchor.workerCheckpointAt,
    ownershipPaths: anchor.ownershipPaths,
    contextPaths: anchor.contextPaths,
    modelAlias: anchor.modelAlias,
    surfaceKind: anchor.surfaceKind,
    taskTrack: anchor.taskTrack,
    deliveryClass: anchor.deliveryClass,
    notes: `affinity: reuse from ${anchor.id} (worktree=${anchor.worktreePath ?? 'none'}; resume=${anchor.workerResumeAgentId ?? 'cold'})`,
  };
}

function newest(jobs: readonly JobRecord[]): JobRecord | undefined {
  if (jobs.length === 0) return undefined;
  return [...jobs].toSorted((a, b) => b.updatedAt.localeCompare(a.updatedAt))[0];
}

/** Highest affinity score wins; updatedAt breaks ties deterministically. */
function bestScored(
  jobs: readonly JobRecord[],
  input: {
    readonly kind?: JobKind;
    readonly ownershipPaths?: readonly string[];
    readonly contextPaths?: readonly string[];
  },
): JobRecord | undefined {
  if (jobs.length === 0) return undefined;
  if (jobs.length === 1) return jobs[0];
  return jobs
    .map((job) => ({ job, score: scoreAffinityCandidate(job, input) }))
    .toSorted(
      (a, b) => b.score.score - a.score.score || b.job.updatedAt.localeCompare(a.job.updatedAt),
    )[0]!.job;
}
