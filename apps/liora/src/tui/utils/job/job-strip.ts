/**
 * Pure helpers for the Conductor Job desk: footer strip counts plus the
 * per-job cards that back the Job board view (no agent-core import).
 */

import type {
  JobEventKind,
  JobEventStatus,
  JobInboxEvent,
  JobProgressSnapshot,
  JobSnapshot,
} from '@superliora/protocol';

/** Per-job card for the Job board, sourced from `job.updated` events or JobList output. */
export interface ConductorJobCard {
  readonly id: string;
  readonly title: string;
  readonly status: JobEventStatus;
  readonly kind: JobEventKind;
  readonly priority: number;
  readonly worktreePath?: string;
  readonly workerAgentId?: string;
  readonly missionRunId?: string;
  readonly resultSummary?: string;
  /** Worker progress from `job.updated` v2 (phase/recent tools/heartbeat). */
  readonly progress?: JobProgressSnapshot;
  readonly updatedAtMs: number;
  readonly previousStatus?: JobEventStatus;
}

/** One `job.inbox` notice kept for the board drill-down. */
export interface ConductorJobInboxEntry {
  readonly eventId: string;
  readonly kind: JobInboxEvent['kind'];
  readonly jobId: string;
  readonly title: string;
  readonly summary?: string;
  readonly atMs: number;
}

/** Card cap for the board — terminal cards trim first. */
export const JOB_BOARD_MAX_CARDS = 64;
/** Inbox entries kept for the board drill-down. */
export const JOB_BOARD_MAX_INBOX = 24;

const IN_FLIGHT_CARD_STATUSES: ReadonlySet<JobEventStatus> = new Set<JobEventStatus>([
  'running',
  'queued',
  'blocked',
  'needs_user',
]);

export interface ConductorJobsSnapshot {
  readonly total: number;
  readonly queued: number;
  readonly running: number;
  readonly blocked: number;
  readonly needsUser: number;
  readonly interrupted: number;
  readonly failed: number;
  readonly unreadInbox: number;
  /** Per-job cards for the Job board (newest events win). */
  readonly jobs: readonly ConductorJobCard[];
  /** Recent `job.inbox` notices for the board drill-down. */
  readonly inbox: readonly ConductorJobInboxEntry[];
  /** Conductor pool slot limit when known (`pool: … maxConcurrent=N`). */
  readonly maxConcurrent?: number;
}

export function emptyConductorJobsSnapshot(): ConductorJobsSnapshot {
  return {
    total: 0,
    queued: 0,
    running: 0,
    blocked: 0,
    needsUser: 0,
    interrupted: 0,
    failed: 0,
    unreadInbox: 0,
    jobs: [],
    inbox: [],
  };
}

/** Insert or refresh one job card; keeps in-flight cards when trimming. */
export function upsertConductorJobCard(
  cards: readonly ConductorJobCard[],
  job: JobSnapshot,
  change: { readonly previousStatus?: JobEventStatus } | undefined,
  nowMs: number,
): readonly ConductorJobCard[] {
  const card: ConductorJobCard = {
    id: job.id,
    title: job.title,
    status: job.status,
    kind: job.kind,
    priority: job.priority,
    worktreePath: job.worktreePath,
    workerAgentId: job.workerAgentId,
    missionRunId: job.missionRunId,
    resultSummary: job.resultSummary,
    progress: job.progress,
    updatedAtMs: nowMs,
    previousStatus: change?.previousStatus,
  };
  const next = cards.filter((existing) => existing.id !== job.id);
  next.push(card);
  if (next.length <= JOB_BOARD_MAX_CARDS) return next;
  // Trim oldest terminal card first; fall back to the oldest card overall.
  let dropIndex = -1;
  for (let i = 0; i < next.length; i += 1) {
    const candidate = next[i]!;
    if (!IN_FLIGHT_CARD_STATUSES.has(candidate.status)) {
      dropIndex = i;
      break;
    }
  }
  if (dropIndex === -1) dropIndex = 0;
  next.splice(dropIndex, 1);
  return next;
}

/** Append one inbox notice, capped at {@link JOB_BOARD_MAX_INBOX}. */
export function appendJobInboxEntry(
  inbox: readonly ConductorJobInboxEntry[],
  event: JobInboxEvent,
  nowMs: number,
): readonly ConductorJobInboxEntry[] {
  const next = [
    ...inbox,
    {
      eventId: event.eventId,
      kind: event.kind,
      jobId: event.jobId,
      title: event.title,
      summary: event.summary,
      atMs: nowMs,
    },
  ];
  return next.length > JOB_BOARD_MAX_INBOX ? next.slice(next.length - JOB_BOARD_MAX_INBOX) : next;
}

/** Parse JobList / JobInbox tool text for best-effort strip updates. */
export function parseJobStripFromToolOutput(
  output: string,
  nowMs: number = Date.now(),
): Partial<ConductorJobsSnapshot> | null {
  const text = output.trim();
  if (text.length === 0) return null;

  const maxConcurrent = parseMaxConcurrent(text);

  // "Jobs: 2▸ 1… inbox 3" from formatJobStripLine
  const stripMatch = text.match(/Jobs:\s*([^\n]+)/i);
  if (stripMatch) {
    const body = stripMatch[1] ?? '';
    if (/idle/i.test(body)) {
      return { ...emptyConductorJobsSnapshot(), ...(maxConcurrent === undefined ? {} : { maxConcurrent }) };
    }
    const running = Number((body.match(/(\d+)▸/) ?? [])[1] ?? 0);
    const queued = Number((body.match(/(\d+)…/) ?? [])[1] ?? 0);
    const blocked = Number((body.match(/(\d+)⛔/) ?? [])[1] ?? 0);
    const needsUser = Number((body.match(/(\d+)\?/) ?? [])[1] ?? 0);
    const interrupted = Number((body.match(/(\d+)⏸/) ?? [])[1] ?? 0);
    const failed = Number((body.match(/(\d+)✗/) ?? [])[1] ?? 0);
    const unreadInbox = Number((body.match(/inbox\s+(\d+)/i) ?? [])[1] ?? 0);
    const total = running + queued + blocked + needsUser + interrupted + failed;
    return {
      total,
      running,
      queued,
      blocked,
      needsUser,
      interrupted,
      failed,
      unreadInbox,
      ...(maxConcurrent === undefined ? {} : { maxConcurrent }),
    };
  }

  // Ledger lines: `- job_xxx [running] (task p1) title`
  const cards = parseJobLedgerCards(text, nowMs);
  if (cards.length === 0) return null;
  let running = 0;
  let queued = 0;
  let blocked = 0;
  let needsUser = 0;
  let interrupted = 0;
  let failed = 0;
  for (const card of cards) {
    if (card.status === 'running') running += 1;
    else if (card.status === 'queued') queued += 1;
    else if (card.status === 'blocked') blocked += 1;
    else if (card.status === 'needs_user') needsUser += 1;
    else if (card.status === 'interrupted') interrupted += 1;
    else if (card.status === 'failed') failed += 1;
  }
  return {
    total: cards.length,
    running,
    queued,
    blocked,
    needsUser,
    interrupted,
    failed,
    unreadInbox: 0,
    jobs: cards,
    ...(maxConcurrent === undefined ? {} : { maxConcurrent }),
  };
}

/** `pool: warm=2 maxConcurrent=4` lines from JobCreate / JobSchedule output. */
function parseMaxConcurrent(text: string): number | undefined {
  const m = text.match(/maxConcurrent\s*=\s*(\d+)/i);
  if (m === null) return undefined;
  const value = Number(m[1]);
  return Number.isFinite(value) && value > 0 ? value : undefined;
}

const JOB_LEDGER_LINE = /^\s*-\s+(job_[A-Za-z0-9_-]+)\s+\[([a-z_]+)\]\s+\(([a-z]+)\s+p(\d+)\)\s+(.*)$/i;

/** Best-effort per-job cards from `renderJobLedger` style output. */
export function parseJobLedgerCards(
  text: string,
  nowMs: number = Date.now(),
): readonly ConductorJobCard[] {
  const cards: ConductorJobCard[] = [];
  for (const line of text.split('\n')) {
    const m = line.match(JOB_LEDGER_LINE);
    if (m === null) continue;
    const status = normalizeJobStatus(m[2] ?? '');
    if (status === undefined) continue;
    const kind = normalizeJobKind(m[3] ?? '');
    const rest = (m[5] ?? '').trim();
    // Trailing ` paths=a,b` metadata belongs to the ledger, not the title.
    const title = rest.replace(/\s+paths=\S+$/i, '').trim();
    cards.push({
      id: m[1]!,
      title: title.length > 0 ? title : m[1]!,
      status,
      kind,
      priority: Number(m[4] ?? 0),
      updatedAtMs: nowMs,
    });
  }
  return cards;
}

const JOB_STATUSES: readonly JobEventStatus[] = [
  'queued',
  'running',
  'blocked',
  'needs_user',
  'done',
  'failed',
  'cancelled',
  'interrupted',
];

const JOB_KINDS: readonly JobEventKind[] = [
  'task',
  'explore',
  'implement',
  'mission',
  'merge',
  'desk',
];

function normalizeJobStatus(raw: string): JobEventStatus | undefined {
  const lower = raw.toLowerCase();
  return JOB_STATUSES.find((status) => status === lower);
}

function normalizeJobKind(raw: string): JobEventKind {
  const lower = raw.toLowerCase();
  return JOB_KINDS.find((kind) => kind === lower) ?? 'task';
}

export function mergeConductorJobsSnapshot(
  prev: ConductorJobsSnapshot | null | undefined,
  patch: Partial<ConductorJobsSnapshot>,
): ConductorJobsSnapshot {
  const base = prev ?? emptyConductorJobsSnapshot();
  return {
    total: patch.total ?? base.total,
    queued: patch.queued ?? base.queued,
    running: patch.running ?? base.running,
    blocked: patch.blocked ?? base.blocked,
    needsUser: patch.needsUser ?? base.needsUser,
    interrupted: patch.interrupted ?? base.interrupted,
    failed: patch.failed ?? base.failed,
    unreadInbox: patch.unreadInbox ?? base.unreadInbox,
    jobs: patch.jobs ?? base.jobs,
    inbox: patch.inbox ?? base.inbox,
    maxConcurrent: patch.maxConcurrent ?? base.maxConcurrent,
  };
}
