/**
 * Conductor Job desk event sink — the single consumer of `job.updated` /
 * `job.inbox` protocol events (V5-3). All state flows through
 * {@link JobBoardStore}; this sink only republishes the store snapshot into
 * appState and drives the board repaint plus notice side effects.
 */

import type {
  JobInboxEvent,
  JobSnapshot,
  JobUpdatedEvent,
  SubagentProgressEvent,
  SubagentToolCallEvent,
  SubagentToolResultEvent,
} from '@superliora/protocol';

import { isExperimentalFlagEnabled } from '../../commands/experimental-flags';
import { shortJobId } from '../../components/job-board/job-board-helpers';
import {
  DEFAULT_ONBOARDING_PREFERENCES,
  saveTuiConfig,
  type OnboardingPreferences,
} from '../../config';
import { tuiConfigFromHost } from '../../commands/config/appearance/tui-persist';
import type { ColorToken } from '../../theme';
import type { AppState } from '../../types';
import { formatGateAckDetail } from '../../utils/job/gate-preview';
import {
  jobDeckHintNotice,
  shouldShowJobDeckHint,
} from '../../utils/job/job-deck-hint';
import { formatLandResultNotice } from '../../utils/job/land-result-card';
import type {
  ConductorJobActivity,
  ConductorJobUsage,
} from '../../utils/job/job-strip';
import { InputAckLatencyTracker } from './input-ack-latency';
import { ttui } from '../../utils/tui-i18n';
import type { JobBoardStore } from './job-board-store';
import { maybeApplyStaleWorktrees } from './job-hygiene';

export interface JobDeskEventsHost {
  readonly state: {
    readonly appState: AppState;
  };
  readonly session?: {
    jobGcWorktrees(input?: {
      readonly dryRun?: boolean;
    }): Promise<{ readonly removed: number; readonly kept: number }>;
  };
  setAppState(patch: Partial<AppState>): void;
  showStatus(msg: string, color?: ColorToken): void;
  showNotice(title: string, detail?: string, options?: { coalesceKey?: string }): void;
  /** Optional: open Merge Preview Stage (review mode auto-open). */
  openMergePreviewForJob?(jobId: string): void;
  /** Optional: one-shot timeline default when jobs appear. */
  maybeDefaultConductorTimeline?(): void;
}

export class ControlTowerJobDesk {
  /** One-shot hint that the Job board is reachable while jobs run. */
  private boardHintShown = false;
  /** One-shot resume banner when interrupted jobs exist (UX v2). */
  private interruptedBannerShown = false;

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
    this.maybeShowFirstRunningHint(event);
    this.maybeShowInterruptedBanner();
    this.maybeShowStallNotice(event);
    this.maybeShowGateAck(event);
    this.host.maybeDefaultConductorTimeline?.();
  }

  handleInbox(event: JobInboxEvent): void {
    this.store.applyJobInbox(event);
    this.publish();
    const card = this.store.snapshot().jobs.find((entry) => entry.id === event.jobId);
    const land = isExperimentalFlagEnabled('conductor_ux_v2')
      ? formatLandResultNotice({
          kind: event.kind,
          title: event.title,
          summary: event.summary,
          landReceipt: card?.landReceipt,
          actionHints: event.actionHints,
          jobKind: card?.kind,
        })
      : undefined;
    if (land !== undefined) {
      this.host.showNotice(land.title, land.detail, {
        coalesceKey: `job-land:${event.eventId}`,
      });
      if (!/held/i.test(land.title)) {
        // F15: short success cue via status flash (appearance-effects clock).
        this.host.showStatus(ttui('tui.land.complete'), 'success');
        void maybeApplyStaleWorktrees(this.host);
      }
      this.maybeAutoOpenMergePreview(event, card);
      this.host.maybeDefaultConductorTimeline?.();
      return;
    }
    const kindLabel = event.kind.replace(/^job\./, '');
    const detail = event.summary ? event.summary.slice(0, 120) : event.jobId;
    this.host.showNotice(ttui('tui.job.noticeTitle', { kind: kindLabel, title: event.title }), detail, {
      coalesceKey: `job-inbox:${event.eventId}`,
    });
    // Keep notice stream; unread already bumped in the store publish above.
    this.maybeAutoOpenMergePreview(event, card);
    this.host.maybeDefaultConductorTimeline?.();
  }

  /** First running Job: Alt+J hint once (v2) or legacy Job Desk status. */
  private maybeShowFirstRunningHint(event: JobUpdatedEvent): void {
    if (this.boardHintShown || event.job.status !== 'running') return;
    this.boardHintShown = true;
    if (isExperimentalFlagEnabled('conductor_ux_v2')) {
      const previous =
        this.host.state.appState.onboarding ?? DEFAULT_ONBOARDING_PREFERENCES;
      if (
        !shouldShowJobDeckHint({
          conductorUxV2: true,
          jobDeckHintSeen: previous.jobDeckHintSeen,
          runningJobs: 1,
        })
      ) {
        return;
      }
      const notice = jobDeckHintNotice();
      this.host.showNotice(notice.title, notice.detail, {
        coalesceKey: 'job-deck-hint',
      });
      this.persistJobDeckHintSeen(previous);
      return;
    }
    this.host.showStatus(
      `Conductor job running: ${event.job.title} — Job Desk tracks it; click a card or /jobs deck for the worker transcript`,
      'info',
    );
  }

  private persistJobDeckHintSeen(previous: OnboardingPreferences): void {
    const onboarding: OnboardingPreferences = { ...previous, jobDeckHintSeen: true };
    this.host.setAppState({ onboarding });
    // Host is LioraTUI at runtime — enough fields for tuiConfigFromHost.
    void saveTuiConfig(
      tuiConfigFromHost(
        this.host as Parameters<typeof tuiConfigFromHost>[0],
        { onboarding },
      ),
    ).catch(() => {});
  }

  /** Review mode: auto-open Merge Preview on implement/task completion. */
  private maybeAutoOpenMergePreview(
    event: JobInboxEvent,
    card: { readonly kind: string } | undefined,
  ): void {
    if (!isExperimentalFlagEnabled('conductor_ux_v2')) return;
    if (this.host.state.appState.conductorProjectMode !== 'review') return;
    if (event.kind !== 'job.completed') return;
    if (card === undefined) return;
    if (card.kind !== 'implement' && card.kind !== 'task') return;
    this.host.openMergePreviewForJob?.(event.jobId);
  }

  /**
   * F13: after resume/startup hydration, call once when the ledger already
   * has interrupted jobs (also re-checks on the first matching job.updated).
   */
  maybeShowInterruptedBanner(force = false): void {
    if (!isExperimentalFlagEnabled('conductor_ux_v2')) return;
    if (this.interruptedBannerShown && !force) return;
    const interrupted = this.store.snapshot().interrupted;
    if (interrupted <= 0) return;
    this.interruptedBannerShown = true;
    const n = String(interrupted);
    this.host.showNotice(
      `${n} interrupted job${interrupted === 1 ? '' : 's'}`,
      '/job resume or open Inbox (Alt+I)',
      { coalesceKey: 'job-interrupted-banner' },
    );
    this.host.showStatus(
      `${n} interrupted jobs — /job resume or open Inbox (Alt+I)`,
      'warning',
    );
  }

  private maybeShowStallNotice(event: JobUpdatedEvent): void {
    if (!isExperimentalFlagEnabled('conductor_ux_v2')) return;
    const reason = event.change?.reason ?? '';
    const phase = event.job.progress?.phase ?? '';
    const stalled =
      reason.includes('stalled') ||
      phase.includes('stalled') ||
      phase.includes('no tool activity');
    if (!stalled) return;
    this.host.showNotice(
      'Worker may be stuck — Steer or Cancel',
      `${event.job.title} · ${shortJobId(event.job.id)}`,
      { coalesceKey: `job-stall:${event.job.id}` },
    );
  }

  /** F06: surface gateChecklist / briefPreview on JobCreate ACK (queued→running). */
  private maybeShowGateAck(event: JobUpdatedEvent): void {
    if (!isExperimentalFlagEnabled('conductor_ux_v2')) return;
    const gate = event.job.gateChecklist;
    const brief = event.job.briefPreview;
    if (gate === undefined && brief === undefined) return;
    const previous = event.change?.previousStatus;
    const isAck =
      event.job.status === 'queued' ||
      event.job.status === 'running' ||
      previous === 'queued' ||
      previous === undefined;
    if (!isAck) return;
    const detail = formatGateAckDetail({
      ...(gate === undefined ? {} : { gateChecklist: gate }),
      ...(brief === undefined ? {} : { briefPreview: brief }),
    });
    if (detail === undefined) return;
    this.host.showNotice(ttui('tui.job.ackTitle', { title: event.job.title }), detail, {
      coalesceKey: `job-gate-ack:${event.job.id}`,
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

  /** Bulk seed helper (resume JobList) — same publish path as live events. */
  publishFromStore(): void {
    this.publish();
  }

  /** F18: replace cards from Session.jobList() and republish. */
  applySnapshots(jobs: readonly JobSnapshot[]): void {
    this.store.applySnapshots(jobs);
  }

  /** Sync unread badge after Session.jobInbox({ markRead: true }). */
  markInboxRead(): void {
    this.store.markInboxRead();
    this.publish();
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
