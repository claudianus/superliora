/**
 * Job board store — the single source of truth for Conductor job desk state
 * (V5-3). `job.updated` / `job.inbox` protocol events and best-effort Job*
 * tool output all converge here; counters are derived from the per-job cards
 * so they can never drift from the card list.
 */

import type { JobInboxEvent, JobUpdatedEvent } from '@superliora/protocol';

import {
  appendJobInboxEntry,
  emptyConductorJobsSnapshot,
  mergeConductorJobsSnapshot,
  parseJobStripFromToolOutput,
  patchConductorJobUsage,
  upsertConductorJobCard,
  type ConductorJobCard,
  type ConductorJobUsage,
  type ConductorJobsSnapshot,
} from '../../utils/job/job-strip';

export type JobBoardStoreListener = (snapshot: ConductorJobsSnapshot) => void;

export class JobBoardStore {
  private current: ConductorJobsSnapshot = emptyConductorJobsSnapshot();
  private readonly listeners = new Set<JobBoardStoreListener>();

  snapshot(): ConductorJobsSnapshot {
    return this.current;
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
    for (const listener of this.listeners) listener(next);
  }
}
