import type { GoalBudgetLimits } from '../../../agent/goal/types';
import type { ToolStore } from '../../store';
import { classifyJobTaskTrack, type JobTaskTrack } from './job-task-track';
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

/**
 * Persist the ledger. Unchanged JobRecord references are shared so a single
 * progress heartbeat does not clone every field of every job.
 */
export function writeJobLedger(store: ToolStore, ledger: JobLedger): void {
  store.set(JOB_LEDGER_STORE_KEY, {
    schemaVersion: 1,
    // Shallow array copy only — each JobRecord is treated as immutable.
    jobs: ledger.jobs.slice(),
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
    readonly taskTrack?: JobTaskTrack;
    readonly verifyVerdict?: JobRecord['verifyVerdict'];
    /** Affinity reuse: bind an existing worktree before schedule assigns one. */
    readonly worktreePath?: string;
    readonly worktreeBranch?: string;
    /** Affinity reuse: prefer host.resume on this agent id before cold spawn. */
    readonly workerResumeAgentId?: string;
    readonly workerCheckpointAt?: string;
    readonly workerDeadlineStartedAt?: string;
    readonly notes?: string;
  },
): JobRecord {
  const now = new Date().toISOString();
  const kind = input.kind ?? 'task';
  const taskTrack =
    input.taskTrack ??
    classifyJobTaskTrack({
      title: input.title,
      prompt: input.prompt,
      ownershipPaths: input.ownershipPaths,
      contextPaths: input.contextPaths,
      kind,
      deliveryMode: input.deliveryMode,
      greenfieldChain: input.deliveryMode === 'greenfield' || input.deliveryPhase !== undefined,
    });
  const codingKind = kind === 'task' || kind === 'implement';
  const tddMode =
    input.tddMode ??
    (codingKind ? (taskTrack === 'general' ? 'off' : 'preferred') : undefined);
  const surfaceKind =
    input.surfaceKind ?? (codingKind && taskTrack === 'general' ? 'none' : undefined);
  const job: JobRecord = {
    id: createJobId(),
    title: input.title.trim(),
    status: 'queued',
    kind,
    taskTrack,
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
    tddMode,
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
    surfaceKind,
    verifyVerdict: input.verifyVerdict,
    worktreePath: input.worktreePath?.trim() || undefined,
    worktreeBranch: input.worktreeBranch?.trim() || undefined,
    workerResumeAgentId: input.workerResumeAgentId?.trim() || undefined,
    workerCheckpointAt: input.workerCheckpointAt?.trim() || undefined,
    workerDeadlineStartedAt: input.workerDeadlineStartedAt?.trim() || undefined,
    notes: input.notes !== undefined ? capJobNotes(input.notes) : undefined,
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
      | 'workerDeadlineStartedAt'
      | 'resultSummary'
      | 'resultContract'
      | 'landReceipt'
      | 'notes'
      | 'prompt'
      | 'progress'
      | 'goalId'
      | 'modelAlias'
      | 'surfaceKind'
      | 'verifyVerdict'
      | 'ownershipPaths'
      | 'contextPaths'
      | 'successCriteria'
      | 'mustNotTouch'
      | 'verificationCommands'
      | 'testSeams'
      | 'tddMode'
      | 'reproCommand'
      | 'kind'
      | 'taskTrack'
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
export const JOB_INBOX_SUMMARY_MAX_CHARS = 2_000;

/**
 * Diagnostic lines JobInspect / Inbox must keep across overflow: handoff,
 * success criteria, SHAs, and failure stderr. Heartbeats may drop first.
 */
export function isPinnedJobDiagnosticLine(line: string): boolean {
  const text = line.trim();
  if (text.length === 0) return false;
  if (/implement[_\s-]?handoff/i.test(text)) return true;
  if (/success[_\s-]?criteria/i.test(text)) return true;
  if (/\bsha\s*[=:]\s*[0-9a-f]{7,40}\b/i.test(text)) return true;
  if (/\bstderr\b/i.test(text)) return true;
  if (/^push:\s*failed/i.test(text)) return true;
  return false;
}

/**
 * Keep pinned diagnostic lines, then fill the remaining budget with the
 * newest unpinned lines. Used by ledger notes and inbox summaries.
 */
export function capPinnedDiagnosticText(
  text: string,
  options: { readonly maxLines?: number; readonly maxChars: number },
): { readonly text: string; readonly dropped: number } {
  const maxChars = options.maxChars;
  const maxLines = options.maxLines;
  const lines = text.split('\n');
  const pinned = lines.filter(isPinnedJobDiagnosticLine);
  const rest = lines.filter((line) => !isPinnedJobDiagnosticLine(line));

  const restBudget =
    maxLines === undefined ? rest.length : Math.max(0, maxLines - pinned.length);
  const keptRest = restBudget < rest.length ? rest.slice(-restBudget) : rest;
  let dropped = Math.max(0, lines.length - pinned.length - keptRest.length);

  let keptPinned = pinned;
  let keptUnpinned = keptRest;
  let next = [...keptPinned, ...keptUnpinned].join('\n');

  const rebuild = (): void => {
    next = [...keptPinned, ...keptUnpinned].join('\n');
  };
  const dropOldestUnpinned = (): boolean => {
    if (keptUnpinned.length === 0) return false;
    keptUnpinned = keptUnpinned.slice(1);
    dropped += 1;
    rebuild();
    return true;
  };
  const dropOldestPinned = (): boolean => {
    if (keptPinned.length === 0) return false;
    keptPinned = keptPinned.slice(1);
    dropped += 1;
    rebuild();
    return true;
  };

  while (next.length > maxChars && keptUnpinned.length > 1) {
    dropOldestUnpinned();
  }
  if (next.length > maxChars && keptUnpinned.length === 1 && keptPinned.length > 0) {
    dropOldestUnpinned();
  }
  if (next.length > maxChars && keptUnpinned.length === 1) {
    keptUnpinned = [keptUnpinned[0]!.slice(-maxChars)];
    rebuild();
  }
  while (next.length > maxChars && keptPinned.length > 1) {
    dropOldestPinned();
  }
  if (next.length > maxChars && keptPinned.length === 1) {
    keptPinned = [keptPinned[0]!.slice(0, maxChars)];
    rebuild();
  }
  if (next.length > maxChars) next = next.slice(-maxChars);
  return { text: next, dropped };
}

/**
 * More than a dozen call sites append to `notes` with no reader ever pruning
 * it, and JobInspect used to dump the whole record. Capping at the single
 * ledger write point beats trimming at each caller: heartbeats drop first,
 * while implement_handoff / success criteria / SHA / failure stderr stay pinned.
 */
export function capJobNotes(notes: string): string {
  const { text, dropped } = capPinnedDiagnosticText(notes, {
    maxLines: JOB_NOTES_MAX_LINES,
    maxChars: JOB_NOTES_MAX_CHARS,
  });
  if (dropped <= 0 && text === notes) return notes;
  if (dropped <= 0) return text;
  const prefix = `[${dropped} earlier note(s) trimmed]\n`;
  if (prefix.length + text.length <= JOB_NOTES_MAX_CHARS) return `${prefix}${text}`;
  return `${prefix}${text}`.slice(0, JOB_NOTES_MAX_CHARS);
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
  const wait = renderJobWaitLabel(job);
  return `- ${job.id} [${job.status}] (${job.kind} p${job.priority}) ${job.title}${paths}${model}${live}${wait}`;
}

/** Queued child of a greenfield parent: "대기(부모 단계)" so idle slots are not mistaken for free workers. */
export function renderJobWaitLabel(job: Pick<JobRecord, 'status' | 'parentJobId' | 'deliveryPhase'>): string {
  if (job.status !== 'queued' || job.parentJobId === undefined) return '';
  const phase = job.deliveryPhase === undefined ? 'parent' : job.deliveryPhase.replace('_', '-');
  return ` wait=대기(부모 단계:${phase})`;
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
