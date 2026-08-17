/**
 * Per-Job coding vs general track.
 *
 * Gates (worktree / verify / changeset / gate brief) key off `JobRecord.taskTrack`.
 * The harness never classifies from prompt wording. Track comes from a declared
 * contract, structural facts (kind / greenfield / tool event), affinity
 * inheritance, or an LLM effect judgment ({@link inferJobTaskTrack}).
 * Ambiguous / failed judgment stays coding.
 */

import { isPlaceholderBriefLine } from './job-brief';
import type {
  JobDeliveryMode,
  JobKind,
  JobRecord,
  JobSurfaceKind,
  JobTaskTrack,
  JobTaskTrackSource,
  JobTddMode,
} from './job-store-key';

export type { JobTaskTrack, JobTaskTrackSource };

export type GeneralVerdictField = 'passed' | 'failed';

export interface ClassifyJobTaskTrackInput {
  readonly title?: string;
  readonly prompt?: string;
  /** Done-contract the effect judge reads first. Not a keyword source. */
  readonly successCriteria?: readonly string[];
  readonly verificationCommands?: readonly string[];
  readonly surfaceKind?: JobSurfaceKind;
  readonly ownershipPaths?: readonly string[];
  readonly contextPaths?: readonly string[];
  readonly kind?: JobKind;
  readonly deliveryMode?: JobDeliveryMode;
  readonly greenfieldChain?: boolean;
  /** JobCreate / JobSteer contract. Invalid values are ignored. */
  readonly explicit?: string;
  /** Affinity / continue_from inheritance. Explicit still wins. */
  readonly inherited?: JobTaskTrack;
  /**
   * Harness event — not prompt text. Product-file tools force coding.
   * Used by the conductor draft recorder.
   */
  readonly toolName?: string;
  readonly blockedCode?: string;
}

export type JobTaskTrackResolution =
  | { readonly source: Exclude<JobTaskTrackSource, 'pending'>; readonly track: JobTaskTrack }
  | { readonly source: 'pending' };

export interface GeneralVerdict {
  readonly generalVerdict: GeneralVerdictField;
  readonly proof: string;
}

export function normalizeJobTaskTrack(value: string | undefined): JobTaskTrack | undefined {
  if (value === 'coding' || value === 'general') return value;
  return undefined;
}

/** True when coding worktree/verify/merge gates should stay off. */
export function isGeneralTaskTrack(
  job: Pick<JobRecord, 'kind' | 'taskTrack'>,
): boolean {
  if (job.kind !== 'task' && job.kind !== 'implement') return false;
  return job.taskTrack === 'general';
}

export function isPendingTaskTrack(
  job: Pick<JobRecord, 'taskTrackSource'>,
): boolean {
  return job.taskTrackSource === 'pending';
}

/** Where the worker runs. Mirrors `needsWorktree` without importing runtime. */
export function jobIsolationKind(
  job: Pick<JobRecord, 'kind' | 'taskTrack'>,
): 'worktree' | 'checkout' | 'none' {
  if (
    job.kind === 'merge' ||
    job.kind === 'push' ||
    job.kind === 'desk' ||
    job.kind === 'goal-desk'
  ) {
    return 'none';
  }
  if (isGeneralTaskTrack(job)) return 'checkout';
  if (job.kind === 'explore' || job.kind === 'research') return 'checkout';
  return 'worktree';
}

/**
 * Structural / declared resolution only. Does not read title or prompt.
 * Unresolved task/implement Jobs stay `pending` for LLM effect judgment.
 */
export function resolveJobTaskTrack(input: ClassifyJobTaskTrackInput): JobTaskTrackResolution {
  const kind = input.kind ?? 'task';
  if (kind !== 'task' && kind !== 'implement') {
    return { source: 'structural', track: 'coding' };
  }
  if (input.deliveryMode === 'greenfield' || input.greenfieldChain === true) {
    return { source: 'structural', track: 'coding' };
  }

  const explicit = normalizeJobTaskTrack(input.explicit);
  if (explicit !== undefined) return { source: 'declared', track: explicit };
  if (input.inherited !== undefined) return { source: 'inherited', track: input.inherited };

  if (forcesCodingFromHarnessEvent(input)) {
    return { source: 'structural', track: 'coding' };
  }

  // implement is a product-change kind. Only task may stay pending for effect judgment.
  if (kind === 'implement') {
    return { source: 'structural', track: 'coding' };
  }

  return { source: 'pending' };
}

function forcesCodingFromHarnessEvent(input: ClassifyJobTaskTrackInput): boolean {
  const tool = input.toolName;
  if (tool === 'Write' || tool === 'Edit' || tool === 'ApplyPatch') return true;
  if (input.blockedCode === 'CONDUCTOR_DIRECT_WORK_BLOCKED') return true;
  const paths = input.ownershipPaths ?? [];
  return paths.some((path) => path.includes('/') || path.includes('.'));
}

/**
 * Sync seam: structural / declared / inherited, else coding.
 * Never scans prompt text. Pending Jobs must go through {@link inferJobTaskTrack}.
 */
export function jobTaskTrackCreateFields(resolution: JobTaskTrackResolution): {
  readonly taskTrack?: JobTaskTrack;
  readonly taskTrackSource: JobTaskTrackSource;
} {
  if (resolution.source === 'pending') return { taskTrackSource: 'pending' };
  return { taskTrack: resolution.track, taskTrackSource: resolution.source };
}

export function classifyJobTaskTrack(input: ClassifyJobTaskTrackInput): JobTaskTrack {
  const resolved = resolveJobTaskTrack(input);
  return resolved.source === 'pending' ? 'coding' : resolved.track;
}

/** Same as {@link classifyJobTaskTrack}. */
export function classifyJobTrack(input: ClassifyJobTaskTrackInput): JobTaskTrack {
  return classifyJobTaskTrack(input);
}

export function taskTrackCreateDefaults(input: {
  readonly codingKind: boolean;
  readonly track: JobTaskTrack | undefined;
  readonly pending: boolean;
  readonly tddMode?: JobTddMode;
  readonly surfaceKind?: JobSurfaceKind;
}): { readonly tddMode?: JobTddMode; readonly surfaceKind?: JobSurfaceKind } {
  if (!input.codingKind) {
    return { tddMode: input.tddMode, surfaceKind: input.surfaceKind };
  }
  if (input.pending) {
    return {
      tddMode: input.tddMode ?? 'preferred',
      surfaceKind: input.surfaceKind,
    };
  }
  if (input.track === 'general') {
    return {
      tddMode: input.tddMode ?? 'off',
      surfaceKind: input.surfaceKind ?? 'none',
    };
  }
  return {
    tddMode: input.tddMode ?? 'preferred',
    surfaceKind: input.surfaceKind,
  };
}

/**
 * Parse `{"generalVerdict":"passed"|"failed","proof":"..."}` from a worker summary.
 * Missing JSON, empty proof, or placeholder proof → undefined (not passed).
 */
export function parseGeneralVerdict(summary: string | undefined): GeneralVerdict | undefined {
  if (summary === undefined || summary.trim().length === 0) return undefined;
  const text = summary.trim();

  for (const match of text.matchAll(/```(?:json)?\s*([\s\S]*?)```/gi)) {
    const parsed = tryParseGeneralVerdictObject(match[1]);
    if (parsed !== undefined) return parsed;
  }

  for (const objectText of iterBalancedJsonObjects(text)) {
    const parsed = tryParseGeneralVerdictObject(objectText);
    if (parsed !== undefined) return parsed;
  }

  return undefined;
}

function tryParseGeneralVerdictObject(raw: string | undefined): GeneralVerdict | undefined {
  if (raw === undefined) return undefined;
  const trimmed = raw.trim();
  if (trimmed.length === 0) return undefined;
  try {
    const value: unknown = JSON.parse(trimmed);
    if (value === null || typeof value !== 'object') return undefined;
    const record = value as Record<string, unknown>;
    const verdictRaw = record['generalVerdict'] ?? record['verdict'];
    if (typeof verdictRaw !== 'string') return undefined;
    const generalVerdict = normalizeVerdict(verdictRaw);
    if (generalVerdict === undefined) return undefined;
    const proofRaw = record['proof'];
    const proof = typeof proofRaw === 'string' ? proofRaw.trim() : '';
    if (proof.length === 0 || isPlaceholderBriefLine(proof)) return undefined;
    return { generalVerdict, proof };
  } catch {
    return undefined;
  }
}

function normalizeVerdict(raw: string): GeneralVerdictField | undefined {
  const value = raw.trim().toLowerCase();
  if (value === 'pass' || value === 'passed') return 'passed';
  if (value === 'fail' || value === 'failed') return 'failed';
  return undefined;
}

function iterBalancedJsonObjects(text: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let start = -1;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch === '{') {
      if (depth === 0) start = i;
      depth += 1;
    } else if (ch === '}') {
      if (depth === 0) continue;
      depth -= 1;
      if (depth === 0 && start >= 0) {
        out.push(text.slice(start, i + 1));
        start = -1;
      }
    }
  }
  return out;
}
