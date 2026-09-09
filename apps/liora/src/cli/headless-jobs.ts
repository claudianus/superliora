/**
 * Headless job feedback for `liora -p "…"`.
 *
 * Conductor jobs are fired asynchronously from the main turn, so a plain
 * prompt run ends with nothing on stdout about the very work the user asked
 * for. After the turn, diff the job ledger against the baseline captured
 * before the prompt and report every job created during this run, with a
 * machine-readable exit code:
 *
 * - 0  every job created this run is `done`
 * - 4  work remains: a job is still queued/running/blocked/needs_user, or a
 *      finished coding job still needs a land decision (`landChoice=pending`)
 * - 5  at least one job failed / was cancelled / interrupted
 *
 * Only jobs created during this run count — pre-existing jobs from earlier
 * sessions of the same project are baseline noise.
 */

import type { JobSnapshot, Session } from '@superliora/sdk';

export interface HeadlessJobSummaryItem {
  readonly id: string;
  readonly title: string;
  readonly kind: string;
  readonly status: string;
  readonly landChoice?: string;
  readonly summary?: string;
}

export interface HeadlessJobSummary {
  readonly type: 'jobs.summary';
  readonly jobs: readonly HeadlessJobSummaryItem[];
  readonly exit: 'ok' | 'pending' | 'failed';
}

export const HEADLESS_JOB_EXIT_CODES = {
  ok: 0,
  pending: 4,
  failed: 5,
} as const;

const TERMINAL_FAILED_STATUSES = new Set(['failed', 'cancelled', 'interrupted']);
const NON_TERMINAL_STATUSES = new Set(['queued', 'running', 'blocked', 'needs_user']);

export function summarizeHeadlessJobs(jobs: readonly JobSnapshot[]): HeadlessJobSummary {
  const failed = jobs.some((job) => TERMINAL_FAILED_STATUSES.has(job.status));
  const pending =
    jobs.some((job) => NON_TERMINAL_STATUSES.has(job.status)) ||
    jobs.some((job) => job.status === 'done' && job.landChoice === 'pending' && wantsLandDecision(job));
  const items: HeadlessJobSummaryItem[] = jobs.map((job) => ({
    id: job.id,
    title: job.title,
    kind: job.kind,
    status: job.status,
    ...(job.landChoice !== undefined ? { landChoice: job.landChoice } : {}),
    ...(job.resultSummary !== undefined && job.resultSummary.length > 0
      ? { summary: job.resultSummary.slice(0, 300) }
      : {}),
  }));
  return {
    type: 'jobs.summary',
    jobs: items,
    exit: failed ? 'failed' : pending ? 'pending' : 'ok',
  };
}

/** Coding jobs left `pending` expect a land decision (apply/keep/pr). */
function wantsLandDecision(job: JobSnapshot): boolean {
  return job.kind === 'implement' || job.kind === 'task' || job.kind === 'merge';
}

export function headlessJobExitCode(summary: HeadlessJobSummary): number {
  switch (summary.exit) {
    case 'failed':
      return HEADLESS_JOB_EXIT_CODES.failed;
    case 'pending':
      return HEADLESS_JOB_EXIT_CODES.pending;
    default:
      return HEADLESS_JOB_EXIT_CODES.ok;
  }
}

/** Compact one-line-per-job block for the text transcript (stderr). */
export function formatHeadlessJobSummaryText(summary: HeadlessJobSummary): string {
  if (summary.jobs.length === 0) return '';
  const lines = summary.jobs.map((job) => {
    const verdict = job.landChoice === 'pending' ? 'done · land pending' : job.status;
    const line = `[job] ${job.id} [${job.kind}][${verdict}] ${job.title}`;
    return job.summary !== undefined && job.summary.length > 0
      ? `${line}\n      ${job.summary.replaceAll('\n', '\n      ')}`
      : line;
  });
  return `[jobs] ${summary.jobs.length === 1 ? '1 job' : `${String(summary.jobs.length)} jobs`} created this run (resume: /jobs)\n${lines.join('\n')}`;
}

/** Read the ledger before a prompt turn so only new jobs are reported. */
export async function captureJobBaseline(session: Session): Promise<ReadonlySet<string>> {
  try {
    const jobs = await session.jobList();
    return new Set(jobs.map((job) => job.id));
  } catch {
    return new Set();
  }
}

export async function collectJobsCreatedDuringRun(
  session: Session,
  baseline: ReadonlySet<string>,
): Promise<JobSnapshot[]> {
  try {
    const jobs = await session.jobList();
    return jobs.filter((job) => !baseline.has(job.id));
  } catch {
    return [];
  }
}
