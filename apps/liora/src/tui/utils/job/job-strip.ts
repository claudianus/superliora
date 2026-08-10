/**
 * Pure helpers for the Conductor Job desk: footer strip counts plus the
 * per-job cards that back the Job board view (no agent-core import).
 */

import type {
  JobBriefPreview,
  JobEventKind,
  JobEventStatus,
  JobGateChecklist,
  JobInboxEvent,
  JobLandReceiptSnapshot,
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
  /** Immediate parent-side tool telemetry for the owning worker. */
  readonly liveActivity?: ConductorJobActivity;
  /** Worker profile name from the latest subagent telemetry event. */
  readonly workerName?: string;
  /** Combined token count from the latest `subagent.progress` heartbeat. */
  readonly liveTokens?: number;
  readonly updatedAtMs: number;
  readonly previousStatus?: JobEventStatus;
  /** Ledger creation time (epoch ms) from `job.updated` v2 `createdAt`. */
  readonly createdAtMs?: number;
  /** When the status last changed — drives lane-move settle flashes. */
  readonly statusChangedAtMs?: number;
  /**
   * Last-known worker token usage (from progress heartbeat or Job Deck
   * drill-down fetch). Survives plain `job.updated` refreshes.
   */
  readonly usage?: ConductorJobUsage;
  /** Greenfield chain phase (schemaVersion 3). */
  readonly deliveryPhase?: JobSnapshot['deliveryPhase'];
  /** Structured brief excerpt (schemaVersion 3). */
  readonly briefPreview?: JobBriefPreview;
  /** Verification gate strip (schemaVersion 3). */
  readonly gateChecklist?: JobGateChecklist;
  /** Post-merge land receipt (schemaVersion 3). */
  readonly landReceipt?: JobLandReceiptSnapshot;
}

/** Dense token strip for Job Desk cards / Job Deck usage rows. */
export interface ConductorJobUsage {
  readonly input: number;
  readonly output: number;
  readonly cacheRead: number;
}

export interface ConductorJobActivity {
  readonly toolCallId: string;
  readonly name: string;
  readonly workerName?: string;
  readonly target?: string;
  readonly status: 'running' | 'ok' | 'error';
  readonly atMs: number;
}

/** One `job.inbox` notice kept for the board drill-down. */
export interface ConductorJobInboxEntry {
  readonly eventId: string;
  readonly kind: JobInboxEvent['kind'];
  readonly jobId: string;
  readonly title: string;
  readonly summary?: string;
  readonly atMs: number;
  /** Suggested host actions (schemaVersion 3). */
  readonly actionHints?: readonly string[];
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
  const existing = cards.find((entry) => entry.id === job.id);
  const createdAtMs = parseIsoMs(job.createdAt) ?? existing?.createdAtMs;
  const statusChanged = existing !== undefined && existing.status !== job.status;
  const usage = usageFromProgress(job.progress) ?? existing?.usage;
  const briefPreview = job.briefPreview ?? existing?.briefPreview;
  const gateChecklist = job.gateChecklist ?? existing?.gateChecklist;
  const landReceipt = job.landReceipt ?? existing?.landReceipt;
  const deliveryPhase = job.deliveryPhase ?? existing?.deliveryPhase;
  const card: ConductorJobCard = {
    id: job.id,
    title: job.title,
    status: job.status,
    kind: job.kind,
    priority: job.priority,
    worktreePath: job.worktreePath,
    workerAgentId: job.workerAgentId,
    resultSummary: job.resultSummary,
    progress: job.progress,
    updatedAtMs: parseIsoMs(job.updatedAt) ?? nowMs,
    previousStatus: change?.previousStatus ?? (statusChanged ? existing.status : undefined),
    createdAtMs,
    // Preserve the original change time on plain refreshes; re-arm on a move.
    statusChangedAtMs: statusChanged || existing === undefined ? nowMs : existing.statusChangedAtMs,
    ...(existing?.liveActivity === undefined ? {} : { liveActivity: existing.liveActivity }),
    ...(existing?.workerName === undefined ? {} : { workerName: existing.workerName }),
    ...(existing?.liveTokens === undefined ? {} : { liveTokens: existing.liveTokens }),
    ...(usage === undefined ? {} : { usage }),
    ...(deliveryPhase === undefined ? {} : { deliveryPhase }),
    ...(briefPreview === undefined ? {} : { briefPreview }),
    ...(gateChecklist === undefined ? {} : { gateChecklist }),
    ...(landReceipt === undefined ? {} : { landReceipt }),
  };
  const next = cards.filter((entry) => entry.id !== job.id);
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
      ...(event.actionHints === undefined || event.actionHints.length === 0
        ? {}
        : { actionHints: event.actionHints }),
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
  'research',
  'implement',
  'verify',
  'mission',
  'merge',
  'push',
  'desk',
  'goal-desk',
  'goal-driver',
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

/** Parse an ISO timestamp into epoch ms; undefined when absent/invalid. */
export function parseIsoMs(iso: string | undefined): number | undefined {
  if (iso === undefined || iso.length === 0) return undefined;
  const ms = Date.parse(iso);
  return Number.isFinite(ms) ? ms : undefined;
}

const TERMINAL_JOB_STATUSES: ReadonlySet<JobEventStatus> = new Set<JobEventStatus>([
  'done',
  'failed',
  'cancelled',
]);

/**
 * Wall-clock age of a job card: live jobs count against `now`, terminal jobs
 * freeze at their last ledger update (≈ completion time).
 */
export function jobElapsedMs(card: ConductorJobCard, nowMs: number): number | undefined {
  if (card.createdAtMs === undefined) return undefined;
  const end = TERMINAL_JOB_STATUSES.has(card.status)
    ? Math.max(card.updatedAtMs, card.createdAtMs)
    : nowMs;
  return Math.max(0, end - card.createdAtMs);
}

/** Compact human duration: `42s`, `3m 12s`, `1h 05m`, `2d 3h`. */
export function formatJobDuration(ms: number): string {
  const seconds = Math.floor(ms / 1000);
  if (seconds < 60) return `${String(seconds)}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${String(minutes)}m ${String(seconds % 60).padStart(2, '0')}s`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${String(hours)}h ${String(minutes % 60).padStart(2, '0')}m`;
  const days = Math.floor(hours / 24);
  return `${String(days)}d ${String(hours % 24)}h`;
}

/** Longest live-job age across the ledger — the desk's wall clock. */
export function longestActiveJobElapsedMs(
  cards: readonly ConductorJobCard[],
  nowMs: number,
): number | undefined {
  let longest: number | undefined;
  for (const card of cards) {
    if (TERMINAL_JOB_STATUSES.has(card.status)) continue;
    const elapsed = jobElapsedMs(card, nowMs);
    if (elapsed !== undefined && (longest === undefined || elapsed > longest)) {
      longest = elapsed;
    }
  }
  return longest;
}

/** Map progress heartbeat token fields onto the dense card usage shape. */
export function usageFromProgress(
  progress: JobProgressSnapshot | undefined,
): ConductorJobUsage | undefined {
  if (progress === undefined) return undefined;
  if (
    progress.tokensIn === undefined &&
    progress.tokensOut === undefined &&
    progress.cacheRead === undefined
  ) {
    return undefined;
  }
  return {
    input: progress.tokensIn ?? 0,
    output: progress.tokensOut ?? 0,
    cacheRead: progress.cacheRead ?? 0,
  };
}

/**
 * Resolve a full or short job id against the ledger.
 * Accepts `job_…`, bare short prefixes (`a1b2c3d4`), and unique substring hits.
 */
export function resolveConductorJobCard(
  cards: readonly ConductorJobCard[],
  query: string | undefined,
): ConductorJobCard | undefined {
  if (query === undefined) return undefined;
  const needle = query.trim();
  if (needle.length === 0) return undefined;
  const exact = cards.find((card) => card.id === needle);
  if (exact !== undefined) return exact;
  const withPrefix = needle.startsWith('job_') ? needle : `job_${needle}`;
  const prefixed = cards.find((card) => card.id === withPrefix);
  if (prefixed !== undefined) return prefixed;
  const lower = needle.toLowerCase();
  const prefixHits = cards.filter(
    (card) =>
      card.id.toLowerCase().startsWith(withPrefix.toLowerCase()) ||
      card.id.replace(/^job_/u, '').toLowerCase().startsWith(lower),
  );
  if (prefixHits.length === 1) return prefixHits[0];
  const contains = cards.filter((card) => card.id.toLowerCase().includes(lower));
  return contains.length === 1 ? contains[0] : undefined;
}

/** Newest tool wins, no immediate repeats, at most this many in the trail. */
const PROGRESS_TOOL_TRAIL_MAX = 3;

/**
 * Join a `subagent.progress` heartbeat onto the job card that spawned the
 * worker. The ledger has a `progress` field but no writer — this fills the
 * board ticker from telemetry the session already emits every few seconds,
 * so the desk shows live worker activity without a ledger write per beat.
 * Returns undefined only when no card owns the worker; a matching card
 * always repaints (the heartbeat timestamp moves every beat).
 */
export function patchConductorJobProgressByWorker(
  cards: readonly ConductorJobCard[],
  workerAgentId: string,
  beat: {
    readonly lastTool?: string;
    readonly lastTarget?: string;
    readonly toolCount?: number;
    readonly workerName?: string;
    readonly tokens?: number;
    readonly atMs: number;
  },
): readonly ConductorJobCard[] | undefined {
  const index = cards.findIndex((card) => card.workerAgentId === workerAgentId);
  if (index < 0) return undefined;
  const previous = cards[index]!;
  const trail = previous.progress?.recentTools ?? [];
  const recentTools =
    beat.lastTool === undefined || beat.lastTool === trail[trail.length - 1]
      ? trail
      : [...trail, beat.lastTool].slice(-PROGRESS_TOOL_TRAIL_MAX);
  const progress: JobProgressSnapshot = {
    ...previous.progress,
    ...(beat.lastTarget === undefined ? {} : { phase: beat.lastTarget }),
    ...(recentTools.length === 0 ? {} : { recentTools }),
    ...(beat.toolCount === undefined ? {} : { stepsCompleted: beat.toolCount }),
    lastHeartbeatAt: new Date(beat.atMs).toISOString(),
  };
  const next = [...cards];
  next[index] = {
    ...previous,
    progress,
    ...(beat.tokens === undefined ? {} : { liveTokens: beat.tokens }),
    ...(beat.workerName === undefined ? {} : { workerName: beat.workerName }),
  };
  return next;
}

/** Join an immediate worker tool-call/result event onto its owning card. */
export function patchConductorJobActivityByWorker(
  cards: readonly ConductorJobCard[],
  workerAgentId: string,
  activity: ConductorJobActivity,
): readonly ConductorJobCard[] | undefined {
  const index = cards.findIndex((card) => card.workerAgentId === workerAgentId);
  if (index < 0) return undefined;
  const previous = cards[index]!;
  const previousActivity = previous.liveActivity;
  const target =
    activity.target ??
    (previousActivity?.toolCallId === activity.toolCallId ? previousActivity.target : undefined);
  const trail = previous.progress?.recentTools ?? [];
  const recentTools =
    activity.name.length === 0 || activity.name === trail[trail.length - 1]
      ? trail
      : [...trail, activity.name].slice(-PROGRESS_TOOL_TRAIL_MAX);
  const progress: JobProgressSnapshot = {
    ...previous.progress,
    ...(target === undefined ? {} : { phase: target }),
    ...(recentTools.length === 0 ? {} : { recentTools }),
    lastHeartbeatAt: new Date(activity.atMs).toISOString(),
  };
  const next = [...cards];
  next[index] = {
    ...previous,
    progress,
    ...(activity.workerName === undefined ? {} : { workerName: activity.workerName }),
    liveActivity: {
      ...activity,
      ...(target === undefined ? {} : { target }),
    },
  };
  return next;
}

/** Patch one card's remembered usage; returns undefined when the id is unknown. */
export function patchConductorJobUsage(
  cards: readonly ConductorJobCard[],
  jobId: string,
  usage: ConductorJobUsage,
): readonly ConductorJobCard[] | undefined {
  const index = cards.findIndex((card) => card.id === jobId);
  if (index < 0) return undefined;
  const next = [...cards];
  const previous = next[index]!;
  next[index] = { ...previous, usage };
  return next;
}
