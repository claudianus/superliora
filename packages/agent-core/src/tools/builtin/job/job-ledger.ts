import type { GoalBudgetLimits } from '../../../agent/goal/types';
import type { ToolStore } from '../../store';
import {
  createJobId,
  emptyJobLedger,
  JOB_LEDGER_STORE_KEY,
  type JobDeliveryMode,
  type JobDeliveryPhase,
  type JobKind,
  type JobLandReceipt,
  type JobLedger,
  type JobRecord,
  type JobStatus,
} from './job-store-key';

declare module '../../store' {
  interface ToolStoreData {
    job_ledger: JobLedger;
  }
}

export function readJobLedger(store: ToolStore): JobLedger {
  return store.get(JOB_LEDGER_STORE_KEY) ?? emptyJobLedger();
}

export function writeJobLedger(store: ToolStore, ledger: JobLedger): void {
  store.set(JOB_LEDGER_STORE_KEY, {
    schemaVersion: 1,
    jobs: ledger.jobs.map((j) => ({ ...j })),
  });
}

export function listJobs(store: ToolStore): readonly JobRecord[] {
  return readJobLedger(store).jobs;
}

export function getJob(store: ToolStore, id: string): JobRecord | undefined {
  return listJobs(store).find((j) => j.id === id);
}

export function upsertJob(store: ToolStore, job: JobRecord): JobRecord {
  const ledger = readJobLedger(store);
  const idx = ledger.jobs.findIndex((j) => j.id === job.id);
  const jobs =
    idx === -1
      ? [...ledger.jobs, job]
      : ledger.jobs.map((j, i) => (i === idx ? job : j));
  writeJobLedger(store, { schemaVersion: 1, jobs });
  return job;
}

export function createJob(
  store: ToolStore,
  input: {
    readonly title: string;
    readonly kind?: JobKind;
    readonly priority?: number;
    readonly prompt?: string;
    readonly ownershipPaths?: readonly string[];
    readonly contextPaths?: readonly string[];
    readonly successCriteria?: readonly string[];
    readonly mustNotTouch?: readonly string[];
    readonly verificationCommands?: readonly string[];
    readonly testSeams?: readonly string[];
    readonly tddMode?: JobRecord['tddMode'];
    readonly reproCommand?: string;
    readonly blockedByJobIds?: readonly string[];
    readonly deliveryMode?: JobDeliveryMode;
    readonly deliveryPhase?: JobDeliveryPhase;
    readonly parentJobId?: string;
    /** Goal-driver binding (spec 2026-08-04-goal-driver-jobs). */
    readonly goalObjective?: string;
    readonly goalCompletionCriterion?: string;
    readonly goalGateCommand?: string;
    readonly goalBudgetLimits?: GoalBudgetLimits;
    /** Plan Desk: ultra structured pipeline vs regular free-form plan. */
    readonly planStructured?: boolean;
    readonly expertId?: string;
    readonly expertScore?: number;
    readonly staffQuery?: string;
    readonly reviewAxis?: JobRecord['reviewAxis'];
    readonly modelAlias?: string;
    readonly surfaceKind?: JobRecord['surfaceKind'];
    readonly verifyVerdict?: JobRecord['verifyVerdict'];
  },
): JobRecord {
  const now = new Date().toISOString();
  const job: JobRecord = {
    id: createJobId(),
    title: input.title.trim(),
    status: 'queued',
    kind: input.kind ?? 'task',
    priority: input.priority ?? 0,
    createdAt: now,
    updatedAt: now,
    prompt: input.prompt?.trim() || undefined,
    ownershipPaths: input.ownershipPaths,
    contextPaths: input.contextPaths,
    successCriteria: input.successCriteria,
    mustNotTouch: input.mustNotTouch,
    verificationCommands: input.verificationCommands,
    testSeams: input.testSeams,
    tddMode: input.tddMode,
    reproCommand: input.reproCommand?.trim() || undefined,
    blockedByJobIds: input.blockedByJobIds,
    deliveryMode: input.deliveryMode,
    deliveryPhase: input.deliveryPhase,
    parentJobId: input.parentJobId,
    goalObjective: input.goalObjective,
    goalCompletionCriterion: input.goalCompletionCriterion,
    goalGateCommand: input.goalGateCommand,
    goalBudgetLimits: input.goalBudgetLimits,
    planStructured: input.planStructured,
    expertId: input.expertId,
    expertScore: input.expertScore,
    staffQuery: input.staffQuery,
    reviewAxis: input.reviewAxis,
    modelAlias: input.modelAlias?.trim() || undefined,
    surfaceKind: input.surfaceKind,
    verifyVerdict: input.verifyVerdict,
  };
  return upsertJob(store, job);
}

export function patchJob(
  store: ToolStore,
  id: string,
  patch: Partial<
    Pick<
      JobRecord,
      | 'status'
      | 'title'
      | 'priority'
      | 'worktreePath'
      | 'worktreeBranch'
      | 'workerAgentId'
      | 'workerResumeAgentId'
      | 'workerCheckpointAt'
      | 'resultSummary'
      | 'resultContract'
      | 'landReceipt'
      | 'notes'
      | 'prompt'
      | 'progress'
      | 'goalId'
      | 'surfaceKind'
      | 'verifyVerdict'
    >
  >,
): JobRecord | undefined {
  const existing = getJob(store, id);
  if (existing === undefined) return undefined;
  const next: JobRecord = {
    ...existing,
    ...patch,
    ...(patch.notes === undefined ? {} : { notes: capJobNotes(patch.notes) }),
    id: existing.id,
    createdAt: existing.createdAt,
    updatedAt: new Date().toISOString(),
  };
  return upsertJob(store, next);
}

/** Newest notes kept when a job's append-only trail is trimmed. */
export const JOB_NOTES_MAX_LINES = 12;
export const JOB_NOTES_MAX_CHARS = 2_000;

/**
 * More than a dozen call sites append to `notes` with no reader ever pruning
 * it, and JobInspect used to dump the whole record. Capping at the single
 * ledger write point beats trimming at each caller: the oldest lines are the
 * ones nobody diagnoses from, and the newest are what JobInspect is opened for.
 */
export function capJobNotes(notes: string): string {
  let lines = notes.split('\n');
  let dropped = 0;
  if (lines.length > JOB_NOTES_MAX_LINES) {
    dropped = lines.length - JOB_NOTES_MAX_LINES;
    lines = lines.slice(-JOB_NOTES_MAX_LINES);
  }
  let text = lines.join('\n');
  while (text.length > JOB_NOTES_MAX_CHARS && lines.length > 1) {
    lines = lines.slice(1);
    dropped += 1;
    text = lines.join('\n');
  }
  if (text.length > JOB_NOTES_MAX_CHARS) text = text.slice(-JOB_NOTES_MAX_CHARS);
  return dropped > 0 ? `[${dropped} earlier note(s) trimmed]\n${text}` : text;
}

export function renderJobLine(job: JobRecord): string {
  const paths =
    job.ownershipPaths && job.ownershipPaths.length > 0
      ? ` paths=${job.ownershipPaths.join(',')}`
      : '';
  const model =
    job.modelAlias !== undefined && job.modelAlias.length > 0
      ? ` model=${job.modelAlias}`
      : '';
  const live = job.status === 'running' ? renderJobProgressSuffix(job) : '';
  return `- ${job.id} [${job.status}] (${job.kind} p${job.priority}) ${job.title}${paths}${model}${live}`;
}

/**
 * Compact live-progress suffix for a running job, e.g.
 * ` — Bash: pnpm test · 12s ago`. Empty when the worker has not reported yet.
 */
export function renderJobProgressSuffix(job: JobRecord, nowMs: number = Date.now()): string {
  const progress = job.progress;
  if (progress === undefined) return '';
  const parts: string[] = [];
  if (progress.phase !== undefined && progress.phase.length > 0) parts.push(progress.phase);
  if (progress.lastHeartbeatAt !== undefined) {
    const ageMs = nowMs - Date.parse(progress.lastHeartbeatAt);
    if (Number.isFinite(ageMs) && ageMs >= 0) {
      parts.push(
        ageMs < 60_000 ? `${Math.round(ageMs / 1000)}s ago` : `${Math.round(ageMs / 60_000)}m ago`,
      );
    }
  }
  return parts.length === 0 ? '' : ` — ${parts.join(' · ')}`;
}

export function renderJobLedger(jobs: readonly JobRecord[]): string {
  if (jobs.length === 0) return 'Job ledger is empty.';
  return ['Job ledger:', ...jobs.map(renderJobLine)].join('\n');
}

export type {
  JobDeliveryMode,
  JobDeliveryPhase,
  JobKind,
  JobLandReceipt,
  JobLedger,
  JobRecord,
  JobStatus,
};
export { JOB_LEDGER_STORE_KEY, createJobId, emptyJobLedger };
