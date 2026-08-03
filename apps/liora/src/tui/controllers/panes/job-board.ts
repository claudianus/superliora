/**
 * Conductor Job desk controller — visibility of the in-transcript kanban
 * panel (chrome slot below the Todo board). The old full-screen control
 * tower takeover is gone: the operator keeps the prompt input and the
 * transcript at all times. Data stays event-driven (`job.updated` /
 * `job.inbox` → appState.conductorJobs → AppStateController re-syncs the
 * panel snapshot); this controller only toggles / repaints the slot.
 */

import type { ColorToken } from '../../theme';
import type { TUIState } from '../../tui-state';
import { requestTUILayoutRender } from '../../utils/render/frame-render';
import { syncJobDeskPanelContainer } from '../../components/chrome/job-desk/job-desk-panel';

export interface JobBoardHost {
  readonly state: TUIState;
  showStatus(msg: string, color?: ColorToken): void;
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
