import type { TokenUsage } from '@superliora/kosong';
import type { JobProgressSnapshot } from '@superliora/protocol';

export const JOB_LEDGER_STORE_KEY = 'job_ledger' as const;
export type JobStatus = 'queued' | 'running' | 'blocked' | 'needs_user' | 'done' | 'failed' | 'cancelled' | 'interrupted';
export type JobKind = 'task' | 'explore' | 'research' | 'implement' | 'verify' | 'mission' | 'merge' | 'push' | 'desk';
export type JobLandChoice = 'pending' | 'keep' | 'apply' | 'pr';

/** Recorded only after git proves the destination contains the landed branch. */
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
  readonly contextPaths?: readonly string[];
  readonly successCriteria?: readonly string[];
  readonly mustNotTouch?: readonly string[];
  readonly verificationCommands?: readonly string[];
  readonly blockedByJobIds?: readonly string[];
  readonly worktreePath?: string;
  readonly repoRoot?: string;
  readonly worktreeBranch?: string;
  readonly sessionName?: string;
  readonly sessionNamePinned?: boolean;
  readonly landChoice?: JobLandChoice;
  readonly portOffset?: number;
  readonly workerHomedir?: string;
  readonly workerAgentId?: string;
  readonly workerResumeAgentId?: string;
  readonly workerCheckpointAt?: string;
  /** Explicit operator limit; absent means no Job-specific deadline. */
  readonly timeoutMs?: number;
  readonly resultSummary?: string;
  readonly filesChanged?: readonly string[];
  readonly usage?: TokenUsage;
  readonly landReceipt?: JobLandReceipt;
  readonly parentJobId?: string;
  readonly notes?: string;
  readonly progress?: JobProgressSnapshot;
  readonly modelAlias?: string;
}

export interface JobLedger {
  readonly jobs: readonly JobRecord[];
  readonly schemaVersion: 1;
}

export function emptyJobLedger(): JobLedger {
  return { schemaVersion: 1, jobs: [] };
}

export function createJobId(now = Date.now(), random = Math.random): string {
  const timePart = now.toString(36);
  const randPart = Math.floor(random() * 1e10).toString(36).padStart(6, '0').slice(0, 6);
  return `job_${timePart}${randPart}`.slice(0, 18);
}

export function slugifySessionName(title: string): string {
  const slug = title.trim().toLowerCase().replaceAll(/[^a-z0-9]+/g, '-').replaceAll(/^-+|-+$/g, '').slice(0, 40);
  return slug.length > 0 ? slug : 'session';
}

export function defaultSessionName(title: string, jobId: string): string {
  const suffix = jobId.replace(/^job_/, '').slice(-4);
  return `${slugifySessionName(title)}-${suffix}`;
}
