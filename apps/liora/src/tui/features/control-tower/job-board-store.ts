/**
 * Job board store — the single source of truth for Conductor job desk state
 * (V5-3). `job.updated` / `job.inbox` protocol events and best-effort Job*
 * tool output all converge here; counters are derived from the per-job cards
 * so they can never drift from the card list.
 */

import type { JobInboxEvent, JobSnapshot, JobUpdatedEvent } from '@superliora/protocol';

import {
  appendJobInboxEntry,
  emptyConductorJobsSnapshot,
  mergeConductorJobsSnapshot,
  parseJobStripFromToolOutput,
  patchConductorJobActivityByWorker,
  patchConductorJobProgressByWorker,
  patchConductorJobUsage,
  upsertConductorJobCard,
  type ConductorJobActivity,
  type ConductorJobCard,
  type ConductorJobUsage,
  type ConductorJobsSnapshot,
} from '../../utils/job/job-strip';

export type JobBoardStoreListener = (snapshot: ConductorJobsSnapshot) => void;

export class JobBoardStore {
  private current: ConductorJobsSnapshot = emptyConductorJobsSnapshot();
  private readonly listeners = new Set<JobBoardStoreListener>();
  /** workerAgentId → card index into `current.jobs` (rebuilt on publish). */
  private readonly workerToIndex = new Map<string, number>();

  snapshot(): ConductorJobsSnapshot {
    return this.current;
  }

  /** O(1) card lookup for a live worker id (job desk tool-result join). */
  cardByWorkerAgentId(workerAgentId: string): ConductorJobCard | undefined {
    const index = this.workerToIndex.get(workerAgentId);
    if (index === undefined) return undefined;
    return this.current.jobs[index];
  }

  subscribe(listener: JobBoardStoreListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  /** One `job.updated` event: upsert the card, then derive counters. */
  applyJobUpdated(event: JobUpdatedEvent): void {
    const prev = this.current;
    const jobs = upsertConductorJobCard(prev.jobs, event.job, event.change, Date.now());
    this.publish(this.deriveFromCards(jobs, prev.unreadInbox, prev.inbox, prev.maxConcurrent));
  }

  /**
   * Bulk resync from Session.jobList() snapshots (F18).
   * Preserves inbox / unread; replaces the card set from authoritative snapshots.
   */
  applySnapshots(jobs: readonly JobSnapshot[]): void {
    const prev = this.current;
    const nowMs = Date.now();
    let cards: readonly ConductorJobCard[] = [];
    for (const job of jobs) {
      cards = upsertConductorJobCard(cards, job, undefined, nowMs);
    }
    // Preserve liveActivity / usage from previous cards when ids match.
    const prevById = new Map(prev.jobs.map((card) => [card.id, card]));
    cards = cards.map((card) => {
      const older = prevById.get(card.id);
      if (older === undefined) return card;
      return {
        ...card,
        ...(older.liveActivity === undefined ? {} : { liveActivity: older.liveActivity }),
        ...(older.workerName === undefined ? {} : { workerName: older.workerName }),
        ...(older.liveTokens === undefined ? {} : { liveTokens: older.liveTokens }),
        ...(card.usage === undefined && older.usage !== undefined ? { usage: older.usage } : {}),
      };
    });
    this.publish(this.deriveFromCards(cards, prev.unreadInbox, prev.inbox, prev.maxConcurrent));
  }

  /** One `job.inbox` event: append the notice and bump unread. */
  applyJobInbox(event: JobInboxEvent): void {
    const prev = this.current;
    this.publish(
      this.deriveFromCards(
        prev.jobs,
        prev.unreadInbox + 1,
        appendJobInboxEntry(prev.inbox, event, Date.now()),
        prev.maxConcurrent,
      ),
    );
  }

  /** Host opened Inbox / JobInbox markRead — clear the unread badge. */
  markInboxRead(): void {
    const prev = this.current;
    if (prev.unreadInbox === 0) return;
    this.publish(
      this.deriveFromCards(prev.jobs, 0, prev.inbox, prev.maxConcurrent),
    );
  }

  /**
   * Best-effort JobList / Job* tool output parse (strip line or ledger).
   * Events stay authoritative; this only backfills between events.
   * Returns true when the snapshot changed.
   */
  applyToolOutput(output: string): boolean {
    const parsed = parseJobStripFromToolOutput(output);
    if (parsed === null) return false;
    const prev = this.current;
    const hasCards = parsed.jobs !== undefined && parsed.jobs.length > 0;
    const scalarsChanged =
      (parsed.total !== undefined && parsed.total !== prev.total) ||
      (parsed.running !== undefined && parsed.running !== prev.running) ||
      (parsed.queued !== undefined && parsed.queued !== prev.queued) ||
      (parsed.blocked !== undefined && parsed.blocked !== prev.blocked) ||
      (parsed.needsUser !== undefined && parsed.needsUser !== prev.needsUser) ||
      (parsed.interrupted !== undefined && parsed.interrupted !== prev.interrupted) ||
      (parsed.failed !== undefined && parsed.failed !== prev.failed) ||
      (parsed.unreadInbox !== undefined && parsed.unreadInbox !== prev.unreadInbox) ||
      (parsed.maxConcurrent !== undefined && parsed.maxConcurrent !== prev.maxConcurrent);
    if (!hasCards && !scalarsChanged) return false;
    const next = mergeConductorJobsSnapshot(prev, parsed);
    this.publish(hasCards ? this.deriveFromCards(next.jobs, next.unreadInbox, next.inbox, next.maxConcurrent) : next);
    return true;
  }

  reset(): void {
    this.publish(emptyConductorJobsSnapshot());
  }

  /**
   * `subagent.progress` heartbeat for a job worker: join it onto the card by
   * `workerAgentId` so the desk ticker moves between ledger events.
   * Returns true when a card was patched.
   */
  applySubagentProgress(beat: {
    readonly subagentId: string;
    readonly lastTool?: string;
    readonly lastTarget?: string;
    readonly toolCount?: number;
    readonly tokens?: number;
    readonly atMs?: number;
  }): boolean {
    const prev = this.current;
    const jobs = patchConductorJobProgressByWorker(
      prev.jobs,
      beat.subagentId,
      {
        lastTool: beat.lastTool,
        lastTarget: beat.lastTarget,
        toolCount: beat.toolCount,
        tokens: beat.tokens,
        atMs: beat.atMs ?? Date.now(),
      },
      this.workerToIndex.get(beat.subagentId),
    );
    if (jobs === undefined) return false;
    this.publish(this.deriveFromCards(jobs, prev.unreadInbox, prev.inbox, prev.maxConcurrent));
    return true;
  }

  /**
   * Immediate parent-side tool telemetry. The heartbeat remains the fallback
   * for phases where no tool event was emitted.
   */
  applySubagentActivity(
    workerAgentId: string,
    activity: ConductorJobActivity,
  ): boolean {
    const prev = this.current;
    const jobs = patchConductorJobActivityByWorker(
      prev.jobs,
      workerAgentId,
      activity,
      this.workerToIndex.get(workerAgentId),
    );
    if (jobs === undefined) return false;
    this.publish(this.deriveFromCards(jobs, prev.unreadInbox, prev.inbox, prev.maxConcurrent));
    return true;
  }

  /**
   * Remember worker token usage fetched by the Job Deck drill-down so the
   * in-transcript desk can show dense token chips without re-polling.
   * Returns true when a card was patched.
   */
  applyJobUsage(jobId: string, usage: ConductorJobUsage): boolean {
    const prev = this.current;
    const jobs = patchConductorJobUsage(prev.jobs, jobId, usage);
    if (jobs === undefined) return false;
    const previous = prev.jobs.find((card) => card.id === jobId);
    if (
      previous?.usage !== undefined &&
      previous.usage.input === usage.input &&
      previous.usage.output === usage.output &&
      previous.usage.cacheRead === usage.cacheRead
    ) {
      return false;
    }
    this.publish(this.deriveFromCards(jobs, prev.unreadInbox, prev.inbox, prev.maxConcurrent));
    return true;
  }

  private deriveFromCards(
    jobs: readonly ConductorJobCard[],
    unreadInbox: number,
    inbox: ConductorJobsSnapshot['inbox'],
    maxConcurrent: number | undefined,
  ): ConductorJobsSnapshot {
    let running = 0;
    let queued = 0;
    let blocked = 0;
    let needsUser = 0;
    let interrupted = 0;
    let failed = 0;
    for (const card of jobs) {
      switch (card.status) {
        case 'running':
          running += 1;
          break;
        case 'queued':
          queued += 1;
          break;
        case 'blocked':
          blocked += 1;
          break;
        case 'needs_user':
          needsUser += 1;
          break;
        case 'interrupted':
          interrupted += 1;
          break;
        case 'failed':
          failed += 1;
          break;
        default:
          break;
      }
    }
    return {
      total: jobs.length,
      running,
      queued,
      blocked,
      needsUser,
      interrupted,
      failed,
      unreadInbox,
      jobs,
      inbox,
      ...(maxConcurrent === undefined ? {} : { maxConcurrent }),
    };
  }

  private publish(next: ConductorJobsSnapshot): void {
    this.current = next;
    this.rebuildWorkerIndex(next.jobs);
    for (const listener of this.listeners) listener(next);
  }

  private rebuildWorkerIndex(jobs: readonly ConductorJobCard[]): void {
    this.workerToIndex.clear();
    for (let i = 0; i < jobs.length; i += 1) {
      const workerId = jobs[i]?.workerAgentId;
      if (workerId !== undefined && workerId.length > 0) {
        this.workerToIndex.set(workerId, i);
      }
    }
  }
}
