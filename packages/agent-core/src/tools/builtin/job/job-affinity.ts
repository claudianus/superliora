/**
 * Job worker affinity — keep same-context follow-ups on an existing Job/worker
 * instead of cold-spawning a sibling that drops transcript context.
 *
 * Disposition:
 * - steer: live worker (running / needs_user) → JobSteer delta, no new Job
 * - fold: queued Job → patch brief in place, no new Job
 * - reuse: terminal Job → new child Job inheriting worktree + resume checkpoint
 */

import type { ToolStore } from '../../store';
import { getJob, listJobs, type JobKind, type JobRecord, type JobStatus } from './job-ledger';
import { ownershipPathsOverlap } from './job-ownership';

/** Kinds that may share a worker / worktree via affinity. */
const AFFINITY_KINDS = new Set<JobKind>(['task', 'implement', 'explore', 'research']);

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
  | { readonly action: 'reuse'; readonly anchor: JobRecord }
  | { readonly action: 'reject'; readonly reason: string };

export interface JobAffinityRequest {
  readonly continueFromJobId?: string;
  readonly affinity?: JobAffinityMode;
  readonly kind?: JobKind;
  readonly ownershipPaths?: readonly string[];
  readonly autoSplit?: boolean;
  readonly greenfieldChain?: boolean;
}

export function isAffinityEligibleKind(kind: JobKind | undefined): boolean {
  if (kind === undefined) return true;
  return AFFINITY_KINDS.has(kind);
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
          })
        : undefined;

  if (request.continueFromJobId !== undefined && anchor === undefined) {
    return {
      action: 'reject',
      reason: `continue_from_job_id not found: ${request.continueFromJobId}`,
    };
  }
  if (anchor === undefined) return undefined;

  if (!isAffinityEligibleKind(anchor.kind)) {
    return {
      action: 'reject',
      reason: `continue_from job ${anchor.id} kind=${anchor.kind} is not affinity-eligible.`,
    };
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
    return { action: 'reuse', anchor };
  }
  return {
    action: 'reject',
    reason: `continue_from job ${anchor.id} status=${anchor.status} cannot accept affinity.`,
  };
}

/**
 * Pick the best same-context Job for affinity=auto.
 * Prefer live → queued → recent terminal with overlapping ownership.
 */
export function findAffinityAnchor(
  store: ToolStore,
  input: {
    readonly kind: JobKind;
    readonly ownershipPaths?: readonly string[];
  },
): JobRecord | undefined {
  const paths = input.ownershipPaths;
  if (paths === undefined || paths.length === 0) return undefined;

  const candidates = listJobs(store).filter(
    (j) =>
      isAffinityEligibleKind(j.kind) &&
      ownershipPathsOverlap(paths, j.ownershipPaths) !== undefined &&
      j.landReceipt === undefined,
  );
  if (candidates.length === 0) return undefined;

  const live = newest(
    candidates.filter((j) => LIVE_STATUSES.has(j.status)),
  );
  if (live !== undefined) return live;

  const queued = newest(candidates.filter((j) => FOLD_STATUSES.has(j.status)));
  if (queued !== undefined) return queued;

  return newest(candidates.filter((j) => REUSE_STATUSES.has(j.status)));
}

/** Soft hint when a cold create overlaps a live/queued owner (no continue_from). */
export function findAffinityHint(
  store: ToolStore,
  input: {
    readonly ownershipPaths?: readonly string[];
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
  return newest(holders);
}

export function formatAffinityHint(anchor: JobRecord): string {
  const path =
    anchor.ownershipPaths !== undefined && anchor.ownershipPaths.length > 0
      ? ` owns ${anchor.ownershipPaths.slice(0, 3).join(',')}`
      : '';
  return (
    `affinity_hint: ${anchor.id} (${anchor.status}${path}) — ` +
    `same-context follow-up: JobSteer or JobCreate(continue_from_job_id=${anchor.id}) / affinity=auto; ` +
    `do not cold-spawn a sibling that races the same paths.`
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
  readonly workerResumeAgentId?: string;
  readonly workerCheckpointAt?: string;
  readonly ownershipPaths?: readonly string[];
  readonly contextPaths?: readonly string[];
  readonly modelAlias?: string;
  readonly surfaceKind?: JobRecord['surfaceKind'];
  readonly notes: string;
} {
  return {
    parentJobId: anchor.id,
    worktreePath: anchor.worktreePath,
    worktreeBranch: anchor.worktreeBranch,
    workerResumeAgentId: anchor.workerResumeAgentId,
    workerCheckpointAt: anchor.workerCheckpointAt,
    ownershipPaths: anchor.ownershipPaths,
    contextPaths: anchor.contextPaths,
    modelAlias: anchor.modelAlias,
    surfaceKind: anchor.surfaceKind,
    notes: `affinity: reuse from ${anchor.id} (worktree=${anchor.worktreePath ?? 'none'}; resume=${anchor.workerResumeAgentId ?? 'cold'})`,
  };
}

function newest(jobs: readonly JobRecord[]): JobRecord | undefined {
  if (jobs.length === 0) return undefined;
  return [...jobs].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))[0];
}
