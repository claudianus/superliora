/**
 * Conductor desk worker (contract §4.2, stream S4).
 *
 * The desk worker owns inbox/notification digestion so completion bursts never
 * stretch the main conductor turn past its budget (interactive turn ≤ 3s,
 * injection ≤ 1.5KB / ≤ 5 events). When a burst lands (≥5 inbox events within
 * 5 minutes, or an explicit `/job digest`), the runtime:
 *
 *   1. dedupes/groups the batch deterministically,
 *   2. marks the batch read so the main injector sees exactly one item,
 *   3. pushes ONE escalation card (`digest: true`) for the main turn to read,
 *   4. optionally enqueues a `kind=desk` worker job for a deeper digest.
 *
 * A desk job flows through the regular scheduler/launch path;
 * `profileForJobKind('desk')` routes it to the cheap profile. New notices
 * arriving mid-digest queue behind the same desk job — the main turn is not
 * touched.
 */

import type { ToolStore } from '../../store';
import {
  listUnreadJobInbox,
  markJobInboxRead,
  pushJobInboxEvent,
  readJobInbox,
  type JobInboxEvent,
} from './job-inbox';
import { createJob, listJobs, type JobRecord } from './job-ledger';

/** Burst window from contract §4.2: ≥5 notices within 5 minutes. */
export const DESK_DIGEST_WINDOW_MS = 5 * 60 * 1000;
export const DESK_DIGEST_TRIGGER_COUNT = 5;
/** One digest batch cap; leftover stays unread for the next cycle. */
export const DESK_DIGEST_MAX_BATCH = 20;

export interface DeskOffloadDecision {
  readonly offload: boolean;
  /** Inbox events created inside the burst window (read or unread). */
  readonly recentCount: number;
  readonly reason?: 'burst';
}

/**
 * Offloading decision (contract §4.2 판정표, "완료 폭주" row).
 * Counts every inbox event inside the window — a burst already digested
 * still counts, but the digest cycle is a no-op when nothing is unread.
 */
export function shouldOffloadInboxToDesk(
  store: ToolStore,
  nowMs: number = Date.now(),
  triggerCount: number = DESK_DIGEST_TRIGGER_COUNT,
): DeskOffloadDecision {
  const cutoff = nowMs - DESK_DIGEST_WINDOW_MS;
  const inbox = readJobInbox(store);
  let recentCount = 0;
  for (const event of inbox.events) {
    const at = Date.parse(event.createdAt);
    if (Number.isFinite(at) && at >= cutoff) recentCount += 1;
  }
  const offload = recentCount >= triggerCount;
  return { offload, recentCount, reason: offload ? 'burst' : undefined };
}

export interface DeskDigestGroup {
  readonly kind: JobInboxEvent['kind'];
  readonly status: JobInboxEvent['status'];
  readonly count: number;
  readonly jobIds: readonly string[];
  readonly sampleTitle: string;
}

export interface DeskDigest {
  readonly groups: readonly DeskDigestGroup[];
  /** One-line summary for the escalation card and TUI board. */
  readonly summary: string;
}

/** Deterministic dedupe + grouping so the budget holds without an LLM call. */
export function digestInboxEvents(events: readonly JobInboxEvent[]): DeskDigest {
  const byKey = new Map<string, { kind: JobInboxEvent['kind']; status: JobInboxEvent['status']; jobIds: string[]; sampleTitle: string }>();
  for (const event of events) {
    const key = `${event.kind}:${event.status}`;
    const entry = byKey.get(key);
    if (entry === undefined) {
      byKey.set(key, {
        kind: event.kind,
        status: event.status,
        jobIds: [event.jobId],
        sampleTitle: event.title,
      });
      continue;
    }
    if (!entry.jobIds.includes(event.jobId)) entry.jobIds.push(event.jobId);
  }
  const groups: DeskDigestGroup[] = [...byKey.values()]
    .map((entry) => ({
      kind: entry.kind,
      status: entry.status,
      count: events.filter((e) => e.kind === entry.kind && e.status === entry.status).length,
      jobIds: entry.jobIds,
      sampleTitle: entry.sampleTitle,
    }))
    .sort((a, b) => b.count - a.count);
  const parts = groups.map((g) => `${g.count}× ${g.kind}`);
  const jobTotal = new Set(events.map((e) => e.jobId)).size;
  const summary =
    events.length === 0
      ? 'No notices.'
      : `Desk digest: ${events.length} notices (${parts.join(', ')}) across ${jobTotal} job(s).`;
  return { groups, summary };
}

/** Prompt for a `kind=desk` worker when a deeper (LLM) digest is enqueued. */
export function buildDeskDigestPrompt(events: readonly JobInboxEvent[]): string {
  const lines = [
    'You are the Conductor desk worker. Digest the Job inbox batch below into ONE escalation card for the main conductor turn.',
    'Rules: dedupe by failure/finish reason, group by job kind/status, keep the card under 1KB, and do not edit files.',
    'Batch:',
    ...events.map(
      (e) =>
        `- ${e.kind} ${e.jobId} [${e.status}] ${e.title}${e.summary ? ` — ${e.summary.slice(0, 120)}` : ''}`,
    ),
  ];
  return lines.join('\n');
}

/** Active (queued/running) desk job, when one already owns the queue. */
export function findActiveDeskJob(store: ToolStore): JobRecord | undefined {
  return listJobs(store).find(
    (j) => j.kind === 'desk' && (j.status === 'queued' || j.status === 'running'),
  );
}

/**
 * Enqueue the desk digest worker job (idempotent while one is active —
 * mid-digest notices pile onto the same desk queue, not the main turn).
 */
export function enqueueDeskDigestJob(
  store: ToolStore,
  events: readonly JobInboxEvent[],
): JobRecord {
  const existing = findActiveDeskJob(store);
  if (existing !== undefined) return existing;
  return createJob(store, {
    title: 'Desk: inbox digest',
    kind: 'desk',
    priority: 1,
    prompt: buildDeskDigestPrompt(events),
  });
}

export interface DeskDigestCycleResult {
  readonly offloaded: boolean;
  /** How many notices were folded into the escalation card. */
  readonly batched: number;
  /** The single escalation card, when offloading happened. */
  readonly escalation?: JobInboxEvent;
  /** Set when a desk worker job was requested. */
  readonly deskJob?: JobRecord;
}

/**
 * Run one digest cycle against the store. Deterministic and ledger-only:
 * safe inside the injection path (no spawn, no git, stays in budget).
 *
 * Postcondition on offload: `listUnreadJobInbox(store).length === 1` — the
 * escalation card — so the main turn sees at most one injection item.
 */
export function runDeskDigestCycle(
  store: ToolStore,
  opts: {
    readonly nowMs?: number;
    /** Force a cycle even without a burst (`/job digest`). */
    readonly manual?: boolean;
    /** Also enqueue the desk worker job for a deeper digest. */
    readonly enqueueWorker?: boolean;
  } = {},
): DeskDigestCycleResult {
  const nowMs = opts.nowMs ?? Date.now();
  const decision = shouldOffloadInboxToDesk(store, nowMs);
  if (!decision.offload && opts.manual !== true) {
    return { offloaded: false, batched: 0 };
  }

  // Escalation cards never re-enter a batch — a repeat cycle must be a no-op.
  const unread = listUnreadJobInbox(store).filter((e) => e.digest !== true);
  if (unread.length === 0) return { offloaded: false, batched: 0 };

  const batch = unread.slice(0, DESK_DIGEST_MAX_BATCH);
  const digest = digestInboxEvents(batch);
  markJobInboxRead(
    store,
    batch.map((e) => e.id),
  );
  const escalation = pushJobInboxEvent(store, {
    kind: 'job.completed',
    jobId: batch[0]?.jobId ?? 'desk',
    status: 'done',
    title: `Inbox digest (${batch.length} notices)`,
    summary: digest.summary,
    digest: true,
  });

  let deskJob: JobRecord | undefined;
  if (opts.enqueueWorker === true) {
    deskJob = enqueueDeskDigestJob(store, batch);
  }

  return { offloaded: true, batched: batch.length, escalation, deskJob };
}
