/**
 * Conductor Job desk controller — visibility of the in-transcript kanban
 * panel (chrome slot below the Todo board). The old full-screen control
 * tower takeover is gone: the operator keeps the prompt input and the
 * transcript at all times. Data stays event-driven (`job.updated` /
 * `job.inbox` → appState.conductorJobs → AppStateController re-syncs the
 * panel snapshot); this controller only toggles / repaints the slot.
 */

import type { ColorToken } from '../../theme';
import type { AppState } from '../../types';
import type { TUIState } from '../../tui-state';
import { requestTUILayoutRender } from '../../utils/render/frame-render';
import { syncJobDeskPanelContainer } from '../../components/chrome/job-desk/job-desk-panel';
import type { ConductorJobUsage } from '../../utils/job/job-strip';

export interface JobBoardHost {
  readonly state: TUIState;
  showStatus(msg: string, color?: ColorToken): void;
  setAppState(patch: Partial<AppState>): void;
  /** Mount the interactive Job Deck viewer (wired by LioraTUI). */
  readonly openJobDeck?: (jobId?: string) => void;
  readonly jobBoardStore?: {
    applyJobUsage(jobId: string, usage: ConductorJobUsage): boolean;
    snapshot(): import('../../utils/job/job-strip').ConductorJobsSnapshot;
  };
}

export class JobBoardController {
  constructor(private readonly host: JobBoardHost) {}

  /** The panel counts as open while it is not operator-hidden. */
  isOpen(): boolean {
    return !this.host.state.jobDeskPanel.isHidden();
  }

  toggle(): void {
    if (this.isOpen()) {
      this.close();
    } else {
      this.show();
    }
  }

  /**
   * Open the interactive Job Deck viewer, optionally focused on one job
   * (mouse card click / `/jobs deck <id>`). Falls back to a hint when the
   * opener is not wired.
   */
  openDeck(jobId?: string): void {
    if (this.host.openJobDeck !== undefined) {
      this.host.openJobDeck(jobId);
      return;
    }
    this.host.showStatus('Job Deck is unavailable in this host.', 'textMuted');
  }

  /** Persist Job Deck–fetched token usage onto the desk ledger. */
  rememberUsage(jobId: string, usage: ConductorJobUsage): void {
    const store = this.host.jobBoardStore;
    if (store === undefined) return;
    if (!store.applyJobUsage(jobId, usage)) return;
    this.host.setAppState({ conductorJobs: store.snapshot() });
    this.repaint();
  }

  /** Un-hide the panel; it mounts once the ledger has cards. */
  show(): void {
    const panel = this.host.state.jobDeskPanel;
    if (!panel.isHidden()) return;
    panel.setHidden(false);
    this.repaint();
    this.host.showStatus(
      panel.isEmpty()
        ? 'Job Desk will appear here once Conductor jobs exist.'
        : 'Job Desk shown — /jobs board hides it.',
      'textMuted',
    );
  }

  /**
   * Session-close hook: drop the stale ledger. The panel stays un-hidden so
   * the next session's jobs auto-mount it again (the empty slot collapses).
   */
  close(): void {
    const { state } = this.host;
    state.jobDeskPanel.clear();
    syncJobDeskPanelContainer(state);
    requestTUILayoutRender(state);
  }

  /** Re-mount the slot from the panel's current snapshot + visibility. */
  repaint(): void {
    const { state } = this.host;
    syncJobDeskPanelContainer(state);
    requestTUILayoutRender(state);
  }
}
