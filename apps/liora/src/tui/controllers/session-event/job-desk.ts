/**
 * Conductor Job desk events → footer strip + toast notices.
 */

import type { JobInboxEvent, JobUpdatedEvent } from '@superliora/protocol';

import type { ColorToken } from '#/tui/theme';
import type { AppState } from '../../types';
import type { TUIState } from '../../tui-state';
import {
  appendJobInboxEntry,
  emptyConductorJobsSnapshot,
  mergeConductorJobsSnapshot,
  upsertConductorJobCard,
  type ConductorJobsSnapshot,
} from '../../utils/job/job-strip';

export type JobDeskHost = {
  readonly state: TUIState;
  setAppState(patch: Partial<AppState>): void;
  showStatus(msg: string, color?: ColorToken): void;
  showNotice(title: string, detail?: string, options?: { coalesceKey?: string }): void;
  /** Live Job board repaint hook; absent until the controller is wired. */
  readonly jobBoardController?: { repaint(): void };
};

function applyStatusDelta(
  prev: ConductorJobsSnapshot,
  status: JobUpdatedEvent['job']['status'],
  delta: 1 | -1,
): ConductorJobsSnapshot {
  const next = { ...prev };
  switch (status) {
    case 'running':
      next.running = Math.max(0, next.running + delta);
      break;
    case 'queued':
      next.queued = Math.max(0, next.queued + delta);
      break;
    case 'blocked':
      next.blocked = Math.max(0, next.blocked + delta);
      break;
    case 'needs_user':
      next.needsUser = Math.max(0, next.needsUser + delta);
      break;
    case 'interrupted':
      next.interrupted = Math.max(0, next.interrupted + delta);
      break;
    case 'failed':
      next.failed = Math.max(0, next.failed + delta);
      break;
    default:
      break;
  }
  next.total = Math.max(
    next.running + next.queued + next.blocked + next.needsUser + next.interrupted + next.failed,
    0,
  );
  return next;
}

export class SessionEventJobDesk {
  /** One-shot hint that the Job board is reachable while jobs run. */
  private boardHintShown = false;

  constructor(private readonly host: JobDeskHost) {}

  handleUpdated(event: JobUpdatedEvent): void {
    const prev = this.host.state.appState.conductorJobs ?? emptyConductorJobsSnapshot();
    let next = { ...prev };
    const previousStatus = event.change?.previousStatus;
    if (previousStatus !== undefined) {
      next = applyStatusDelta(next, previousStatus, -1);
    }
    next = applyStatusDelta(next, event.job.status, 1);
    next.jobs = upsertConductorJobCard(prev.jobs, event.job, event.change, Date.now());
    this.host.setAppState({
      conductorJobs: mergeConductorJobsSnapshot(prev, next),
    });
    this.host.jobBoardController?.repaint();
    if (
      !this.boardHintShown &&
      event.job.status === 'running' &&
      this.host.state.jobBoard === undefined
    ) {
      this.boardHintShown = true;
      this.host.showStatus(
        `Conductor job running: ${event.job.title} — open the job desk with /jobs board`,
        'info',
      );
    }
  }

  handleInbox(event: JobInboxEvent): void {
    const prev = this.host.state.appState.conductorJobs ?? emptyConductorJobsSnapshot();
    this.host.setAppState({
      conductorJobs: mergeConductorJobsSnapshot(prev, {
        unreadInbox: Math.max(0, prev.unreadInbox + 1),
        inbox: appendJobInboxEntry(prev.inbox, event, Date.now()),
      }),
    });
    this.host.jobBoardController?.repaint();
    const kindLabel = event.kind.replace(/^job\./, '');
    const detail = event.summary ? event.summary.slice(0, 120) : event.jobId;
    this.host.showNotice(`Job ${kindLabel}: ${event.title}`, detail, {
      coalesceKey: `job-inbox:${event.eventId}`,
    });
  }
}
