/**
 * Conductor Job desk event sink — the single consumer of `job.updated` /
 * `job.inbox` protocol events (V5-3). All state flows through
 * {@link JobBoardStore}; this sink only republishes the store snapshot into
 * appState and drives the board repaint plus notice side effects.
 */

import type { JobInboxEvent, JobUpdatedEvent } from '@superliora/protocol';

import type { ColorToken } from '../../theme';
import type { AppState } from '../../types';
import { InputAckLatencyTracker } from './input-ack-latency';
import type { JobBoardStore } from './job-board-store';

export interface JobDeskEventsHost {
  readonly state: {
    readonly appState: AppState;
    readonly jobBoard: unknown;
  };
  setAppState(patch: Partial<AppState>): void;
  showStatus(msg: string, color?: ColorToken): void;
  showNotice(title: string, detail?: string, options?: { coalesceKey?: string }): void;
  /** Live Job board repaint hook; absent until the controller is wired. */
  readonly jobBoardController?: { repaint(): void };
}

export class ControlTowerJobDesk {
  /** One-shot hint that the Job board is reachable while jobs run. */
  private boardHintShown = false;

  /** V3-1: input submission → first JobCreate ACK latency samples. */
  readonly inputAckLatency = new InputAckLatencyTracker();

  constructor(
    private readonly host: JobDeskEventsHost,
    readonly store: JobBoardStore,
  ) {}

  /**
   * V3-1 window start: called from the TUI input path
   * (`MessageDispatchController.sendMessageInternal`) each time a prompt is
   * handed to the session. The first `job.*` event back closes the window.
   */
  markInputSubmitted(): void {
    this.inputAckLatency.markInputSubmitted(Date.now());
  }

  handleUpdated(event: JobUpdatedEvent): void {
    this.store.applyJobUpdated(event);
    // V3-1: a protocol job event is the JobCreate ACK for a pending window.
    this.inputAckLatency.markJobEventReceived(Date.now());
    this.publish();
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
    this.store.applyJobInbox(event);
    this.publish();
    this.host.jobBoardController?.repaint();
    const kindLabel = event.kind.replace(/^job\./, '');
    const detail = event.summary ? event.summary.slice(0, 120) : event.jobId;
    this.host.showNotice(`Job ${kindLabel}: ${event.title}`, detail, {
      coalesceKey: `job-inbox:${event.eventId}`,
    });
  }

  /** Best-effort Job* tool-output backfill through the same store. */
  applyToolOutput(output: string): boolean {
    const changed = this.store.applyToolOutput(output);
    if (changed) {
      // V3-1: Job* tool output that changes the board also counts as an ACK.
      this.inputAckLatency.markJobEventReceived(Date.now());
      this.publish();
      this.host.jobBoardController?.repaint();
    }
    return changed;
  }

  private publish(): void {
    this.host.setAppState({ conductorJobs: this.store.snapshot() });
  }
}
