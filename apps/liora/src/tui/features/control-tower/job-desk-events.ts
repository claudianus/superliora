/**
 * Conductor Job desk event sink — the single consumer of `job.updated` /
 * `job.inbox` protocol events (V5-3). All state flows through
 * {@link JobBoardStore}; this sink only republishes the store snapshot into
 * appState and drives the board repaint plus notice side effects.
 */

import type {
  JobInboxEvent,
  JobUpdatedEvent,
  SubagentProgressEvent,
  SubagentToolCallEvent,
  SubagentToolResultEvent,
} from '@superliora/protocol';

import type { ColorToken } from '../../theme';
import type { AppState } from '../../types';
import type {
  ConductorJobActivity,
  ConductorJobUsage,
} from '../../utils/job/job-strip';
import { InputAckLatencyTracker } from './input-ack-latency';
import type { JobBoardStore } from './job-board-store';

export interface JobDeskEventsHost {
  readonly state: {
    readonly appState: AppState;
  };
  setAppState(patch: Partial<AppState>): void;
  showStatus(msg: string, color?: ColorToken): void;
  showNotice(title: string, detail?: string, options?: { coalesceKey?: string }): void;
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
    if (!this.boardHintShown && event.job.status === 'running') {
      this.boardHintShown = true;
      this.host.showStatus(
        `Conductor job running: ${event.job.title} — Job Desk tracks it; click a card or /jobs deck for the worker transcript`,
        'info',
      );
    }
  }

  handleInbox(event: JobInboxEvent): void {
    this.store.applyJobInbox(event);
    this.publish();
    const kindLabel = event.kind.replace(/^job\./, '');
    const detail = event.summary ? event.summary.slice(0, 120) : event.jobId;
    this.host.showNotice(`Job ${kindLabel}: ${event.title}`, detail, {
      coalesceKey: `job-inbox:${event.eventId}`,
    });
  }

  /**
   * Worker heartbeat: only jobs that own the subagent repaint, so unrelated
   * subagent traffic costs a map lookup and nothing else.
   */
  handleSubagentProgress(event: SubagentProgressEvent): void {
    if (!this.store.applySubagentProgress(event)) return;
    this.publish();
  }

  handleSubagentToolCall(event: SubagentToolCallEvent): void {
    const target = subagentToolTarget(event);
    const activity: ConductorJobActivity = {
      toolCallId: event.toolCallId,
      name: event.name,
      status: 'running',
      atMs: Date.now(),
      ...(event.subagentName === undefined ? {} : { workerName: event.subagentName }),
      ...(target === undefined ? {} : { target }),
    };
    if (!this.store.applySubagentActivity(event.subagentId, activity)) return;
    this.publish();
  }

  handleSubagentToolResult(event: SubagentToolResultEvent): void {
    const previous = this.store.snapshot().jobs.find(
      (card) =>
        card.workerAgentId === event.subagentId &&
        card.liveActivity?.toolCallId === event.toolCallId,
    )?.liveActivity;
    const activity: ConductorJobActivity = {
      toolCallId: event.toolCallId,
      name: event.name ?? previous?.name ?? 'tool',
      status: event.isError === true ? 'error' : 'ok',
      atMs: Date.now(),
      ...(previous?.target === undefined ? {} : { target: previous.target }),
    };
    if (!this.store.applySubagentActivity(event.subagentId, activity)) return;
    this.publish();
  }

  /** Job Deck–fetched token usage backfill through the same store. */
  applyJobUsage(jobId: string, usage: ConductorJobUsage): boolean {
    if (!this.store.applyJobUsage(jobId, usage)) return false;
    this.publish();
    return true;
  }

  /** Best-effort Job* tool-output backfill through the same store. */
  applyToolOutput(output: string): boolean {
    const changed = this.store.applyToolOutput(output);
    if (changed) {
      // V3-1: Job* tool output that changes the board also counts as an ACK.
      this.inputAckLatency.markJobEventReceived(Date.now());
      this.publish();
    }
    return changed;
  }

  private publish(): void {
    this.host.setAppState({ conductorJobs: this.store.snapshot() });
  }
}

function subagentToolTarget(event: SubagentToolCallEvent): string | undefined {
  const detail = event.detail;
  if (detail !== undefined) {
    switch (detail.kind) {
      case 'edit':
      case 'read':
      case 'write':
        return detail.path;
      case 'bash':
        return detail.command;
      case 'search':
        return detail.pattern;
    }
  }
  const preview = event.argsPreview?.trim();
  return preview === undefined || preview.length === 0 ? undefined : preview;
}
