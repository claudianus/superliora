import type { GoalBudgetLimits } from '../../../agent/goal/types';
import type { ToolStore } from '../../store';
import {
  createJobId,
  emptyJobLedger,
  JOB_LEDGER_STORE_KEY,
  type JobKind,
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
    readonly parentJobId?: string;
    readonly missionRunId?: string;
    /** Goal-driver binding (spec 2026-08-04-goal-driver-jobs). */
    readonly goalObjective?: string;
    readonly goalCompletionCriterion?: string;
    readonly goalBudgetLimits?: GoalBudgetLimits;
    /** Plan Desk: ultra structured pipeline vs regular free-form plan. */
    readonly planStructured?: boolean;
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
    parentJobId: input.parentJobId,
    missionRunId: input.missionRunId,
    goalObjective: input.goalObjective,
    goalCompletionCriterion: input.goalCompletionCriterion,
    goalBudgetLimits: input.goalBudgetLimits,
    planStructured: input.planStructured,
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
      | 'workerAgentId'
      | 'resultSummary'
      | 'resultContract'
      | 'notes'
      | 'prompt'
      | 'progress'
      | 'goalId'
    >
  >,
): JobRecord | undefined {
  const existing = getJob(store, id);
  if (existing === undefined) return undefined;
  const next: JobRecord = {
    ...existing,
    ...patch,
    id: existing.id,
    createdAt: existing.createdAt,
    updatedAt: new Date().toISOString(),
  };
  return upsertJob(store, next);
}

export function renderJobLine(job: JobRecord): string {
  const paths =
    job.ownershipPaths && job.ownershipPaths.length > 0
      ? ` paths=${job.ownershipPaths.join(',')}`
      : '';
  return `- ${job.id} [${job.status}] (${job.kind} p${job.priority}) ${job.title}${paths}`;
}

export function renderJobLedger(jobs: readonly JobRecord[]): string {
  if (jobs.length === 0) return 'Job ledger is empty.';
  return ['Job ledger:', ...jobs.map(renderJobLine)].join('\n');
}

export type { JobKind, JobLedger, JobRecord, JobStatus };
export { JOB_LEDGER_STORE_KEY, createJobId, emptyJobLedger };
