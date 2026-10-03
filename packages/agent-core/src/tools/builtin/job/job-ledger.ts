import type { ToolStore } from '../../store';
import { resolveRepoRootForNewJob } from './job-git-root';
import {
  createJobId,
  defaultSessionName,
  emptyJobLedger,
  JOB_LEDGER_STORE_KEY,
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
 *
 * The write path is also the ledger growth cap: marathon sessions enqueue
 * hundreds of jobs and every heartbeat/patch otherwise re-persists the whole
 * array while `getJob`/`nextQueuedJobs` degrade to O(n) scans over records
 * that can never run again. Pruning happens here so no caller can forget it.
 */
export function writeJobLedger(store: ToolStore, ledger: JobLedger): void {
  const pruned = pruneJobLedgerJobs(ledger.jobs);
  store.set(JOB_LEDGER_STORE_KEY, {
    schemaVersion: 1,
    // Shallow array copy only — each JobRecord is treated as immutable.
    jobs: pruned.jobs,
  });
}

/**
 * Ledger cap: oldest terminal Jobs (done/failed/cancelled/interrupted) are
 * dropped first when over budget. Never pruned: live statuses, pending land
 * dispositions, pinned sessions, and any job still referenced as a parent
 * (parent-chain scheduling + affinity reuse resolve parentJobId from the
 * ledger — evicting a referenced parent would strand its children).
 */
const JOB_LEDGER_MAX_JOBS = 500;

const PRUNABLE_STATUSES: ReadonlySet<JobStatus> = new Set([
  'done',
  'failed',
  'cancelled',
  'interrupted',
]);

function pruneJobLedgerJobs(
  jobs: readonly JobRecord[],
): { readonly jobs: readonly JobRecord[]; readonly pruned: readonly JobRecord[] } {
  if (jobs.length <= JOB_LEDGER_MAX_JOBS) return { jobs, pruned: [] };
  const referencedParents = new Set<string>();
  for (const job of jobs) {
    if (job.parentJobId !== undefined) referencedParents.add(job.parentJobId);
  }
  const evictable: JobRecord[] = [];
  for (const job of jobs) {
    if (
      PRUNABLE_STATUSES.has(job.status) &&
      job.landChoice !== 'pending' &&
      job.sessionNamePinned !== true &&
      !referencedParents.has(job.id)
    ) {
      evictable.push(job);
    }
  }
  evictable.sort((a, b) => a.updatedAt.localeCompare(b.updatedAt));
  const over = jobs.length - JOB_LEDGER_MAX_JOBS;
  const evict = new Set(
    evictable.slice(0, Math.max(0, over)).map((j) => j.id),
  );
  if (evict.size === 0) return { jobs, pruned: [] };
  const kept: JobRecord[] = [];
  const pruned: JobRecord[] = [];
  for (const job of jobs) {
    if (evict.has(job.id)) pruned.push(job);
    else kept.push(job);
  }
  return { jobs: kept, pruned };
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
    readonly blockedByJobIds?: readonly string[];
    readonly parentJobId?: string;
    readonly modelAlias?: string;
    readonly timeoutMs?: number;
    /** Affinity reuse: bind an existing worktree before schedule assigns one. */
    readonly worktreePath?: string;
    readonly worktreeBranch?: string;
    /** Product git toplevel. When omitted, resolved from parent / ownership / session. */
    readonly repoRoot?: string;
    /** Live session cwd — used only to resolve `repoRoot`, never stored as identity. */
    readonly sessionRepoPath?: string;
    /** Affinity reuse: prefer host.resume on this agent id before cold spawn. */
    readonly workerResumeAgentId?: string;
    readonly workerCheckpointAt?: string;
    readonly sessionName?: string;
    readonly sessionNamePinned?: boolean;
    readonly landChoice?: JobRecord['landChoice'];
    readonly portOffset?: number;
    readonly workerHomedir?: string;
    readonly notes?: string;
  },
): JobRecord {
  const now = new Date().toISOString();
  const id = createJobId();
  const kind = input.kind ?? 'task';
  const parent = input.parentJobId !== undefined ? getJob(store, input.parentJobId) : undefined;
  const repoRoot = resolveRepoRootForNewJob({
    persistedRepoRoot: input.repoRoot ?? parent?.repoRoot,
    ownershipPaths: input.ownershipPaths,
    worktreePath: input.worktreePath ?? parent?.worktreePath,
    sessionRepoPath: input.sessionRepoPath,
  });
  const job: JobRecord = {
    id,
    title: input.title.trim(),
    sessionName: input.sessionName?.trim() || defaultSessionName(input.title, id),
    status: 'queued',
    kind,
    priority: input.priority ?? 0,
    createdAt: now,
    updatedAt: now,
    prompt: input.prompt?.trim() || undefined,
    ownershipPaths: input.ownershipPaths,
    contextPaths: input.contextPaths,
    successCriteria: input.successCriteria,
    mustNotTouch: input.mustNotTouch,
    verificationCommands: input.verificationCommands,
    blockedByJobIds: input.blockedByJobIds,
    parentJobId: input.parentJobId,
    modelAlias: input.modelAlias?.trim() || undefined,
    timeoutMs: input.timeoutMs,
    worktreePath: input.worktreePath?.trim() || undefined,
    worktreeBranch: input.worktreeBranch?.trim() || undefined,
    repoRoot: repoRoot?.trim() || undefined,
    workerResumeAgentId: input.workerResumeAgentId?.trim() || undefined,
    workerCheckpointAt: input.workerCheckpointAt?.trim() || undefined,
    sessionNamePinned: input.sessionNamePinned === true ? true : undefined,
    landChoice: input.landChoice,
    portOffset: input.portOffset,
    workerHomedir: input.workerHomedir?.trim() || undefined,
    notes: input.notes !== undefined ? capJobNotes(input.notes) : undefined,
  };
  return upsertJob(store, job);
}

export function patchJob(
  store: ToolStore,
  id: string,
  patch: Partial<Omit<JobRecord, 'id' | 'createdAt' | 'updatedAt'>>,
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
  if (/^effect:/i.test(text)) return true;
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

export function renderJobWaitLabel(job: Pick<JobRecord, 'status' | 'parentJobId'>): string {
  if (job.status !== 'queued' || job.parentJobId === undefined) return '';
  return ' wait=queued(parent)';
}

/**
 * Compact live-progress suffix for a running job, e.g.
 * ` — Bash: pnpm test · 12s ago`. Empty when the worker has not reported yet.
 */
function renderJobProgressSuffix(job: JobRecord, nowMs: number = Date.now()): string {
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

export type {
  JobKind,
  JobLandReceipt,
  JobLedger,
  JobRecord,
  JobStatus,
};
export { JOB_LEDGER_STORE_KEY, createJobId, emptyJobLedger };
