/**
 * Land pass gate — only done, passed work may merge onto the operator checkout.
 * Kept off job-land.ts so emit/RPC can read the same verdict without pulling git.
 */

import type { JobRecord } from './job-ledger';

export type JobLandGate =
  | { readonly ok: true }
  | { readonly ok: false; readonly reason: string };

export type JobLandGateStatus = 'pass' | 'fail' | 'pending' | 'na';

/** Ledger note prefix Job Deck / Inbox can match when Land is refused. */
export const LAND_REFUSED_NOTE = 'land: refused';

function isCodingLandJob(job: Pick<JobRecord, 'kind' | 'taskTrack'>): boolean {
  if (job.taskTrack === 'general') return false;
  return job.kind === 'task' || job.kind === 'implement' || job.kind === 'goal-driver';
}

/**
 * Whether `landJobToMain` / Apply / MergeJob may touch the operator checkout.
 * Worker output must be `done` or `blocked` (trust-hold retry); failed verify
 * or a failed verification contract still blocks Land.
 */
function isLandableStatus(status: JobRecord['status']): boolean {
  // `blocked` is still passed worker output (merge-trust hold, land retry).
  // Failed / queued / running work must not touch the operator checkout.
  return status === 'done' || status === 'blocked';
}

export function jobMayLandToMain(job: JobRecord): JobLandGate {
  if (!isLandableStatus(job.status)) {
    return {
      ok: false,
      reason: `${LAND_REFUSED_NOTE}: status=${job.status} — only done work may land`,
    };
  }
  if (job.resultContract?.verification_failed === true) {
    return {
      ok: false,
      reason: `${LAND_REFUSED_NOTE}: verification failed — only passed work may land`,
    };
  }
  if (job.verifyVerdict === 'failed') {
    return {
      ok: false,
      reason: `${LAND_REFUSED_NOTE}: verifyVerdict=failed — only passed work may land`,
    };
  }
  return { ok: true };
}

/** Job snapshot gate cell Job Deck already consumes (`gateChecklist.land`). */
export function landGateStatusFromJob(job: JobRecord): JobLandGateStatus {
  if (!isCodingLandJob(job)) return 'na';
  if (job.landReceipt !== undefined) return 'pass';
  if (job.landChoice === 'keep' || job.landChoice === 'pr') return 'na';
  if (job.status === 'failed' || job.status === 'cancelled') return 'fail';
  if (job.resultContract?.verification_failed === true) return 'fail';
  if (job.verifyVerdict === 'failed') return 'fail';
  if (job.notes?.includes(LAND_REFUSED_NOTE) === true) return 'fail';
  return 'pending';
}
