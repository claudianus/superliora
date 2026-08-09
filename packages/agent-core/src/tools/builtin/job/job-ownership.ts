/**
 * Job ownership path helpers — schedule-time overlap gate so siblings wait
 * instead of spawn-failing on exclusive file leases (T4-2).
 */

import { normalize } from 'pathe';

import type { ToolStore } from '../../store';
import { getJob, listJobs, patchJob, type JobRecord } from './job-ledger';

const OWNERSHIP_DEFERRED_PREFIX = 'ownership_deferred:';

export function normalizeOwnershipPath(path: string): string {
  return normalize(path.trim()).replace(/\/+$/, '');
}

/** First overlapping normalized path, or undefined when disjoint / empty. */
export function ownershipPathsOverlap(
  a: readonly string[] | undefined,
  b: readonly string[] | undefined,
): string | undefined {
  if (a === undefined || a.length === 0 || b === undefined || b.length === 0) {
    return undefined;
  }
  const setB = new Set(b.map(normalizeOwnershipPath));
  for (const raw of a) {
    const n = normalizeOwnershipPath(raw);
    if (n.length > 0 && setB.has(n)) return n;
  }
  return undefined;
}

/**
 * Among `holders`, first job whose ownershipPaths overlap `job`'s claim set.
 * Skips `job` itself and jobs with empty ownership.
 */
export function findOwnershipHolder(
  holders: readonly JobRecord[],
  job: JobRecord,
): { readonly holder: JobRecord; readonly path: string } | undefined {
  const claim = job.ownershipPaths;
  if (claim === undefined || claim.length === 0) return undefined;
  for (const other of holders) {
    if (other.id === job.id) continue;
    const path = ownershipPathsOverlap(claim, other.ownershipPaths);
    if (path !== undefined) return { holder: other, path };
  }
  return undefined;
}

/** Parse `job:<jobId>:<uuid8>` run ids used by launchJobWorker. */
export function jobIdFromLeaseRunId(runId: string): string | undefined {
  const match = /^job:([^:]+):/.exec(runId.trim());
  const id = match?.[1]?.trim();
  return id !== undefined && id.length > 0 ? id : undefined;
}

/** Extract holder job id from claimChildOwnership error text when present. */
export function holderJobIdFromOwnershipError(detail: string): string | undefined {
  const runMatch = /run=(job:[^\s.]+)/.exec(detail);
  if (runMatch?.[1] !== undefined) {
    return jobIdFromLeaseRunId(runMatch[1]);
  }
  return undefined;
}

export function isOwnershipConflictError(detail: string): boolean {
  return /Ownership conflict/i.test(detail);
}

export function ownershipDeferredNote(holderJobId: string, path: string): string {
  return `${OWNERSHIP_DEFERRED_PREFIX} held_by=${holderJobId} path=${path}`;
}

/**
 * Append or refresh a single ownership_deferred note (no spam on every pump).
 */
export function noteOwnershipDeferred(
  store: ToolStore,
  job: JobRecord,
  holderJobId: string,
  path: string,
): JobRecord | undefined {
  const line = ownershipDeferredNote(holderJobId, path);
  const notes = job.notes ?? '';
  if (notes.includes(OWNERSHIP_DEFERRED_PREFIX)) {
    const next = notes
      .split('\n')
      .map((row) => (row.startsWith(OWNERSHIP_DEFERRED_PREFIX) ? line : row))
      .join('\n');
    if (next === notes) return getJob(store, job.id) ?? job;
    return patchJob(store, job.id, { notes: next });
  }
  return patchJob(store, job.id, {
    notes: [notes, line].filter(Boolean).join('\n'),
  });
}

/** Running jobs that currently hold exclusive ownership claims. */
export function listRunningOwnershipHolders(store: ToolStore): JobRecord[] {
  return listJobs(store).filter(
    (j) =>
      j.status === 'running' &&
      j.ownershipPaths !== undefined &&
      j.ownershipPaths.length > 0,
  );
}
