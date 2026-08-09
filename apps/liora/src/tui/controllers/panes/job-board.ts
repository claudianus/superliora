/**
 * Conductor Job Deck entry point. The in-transcript kanban panel surface
 * was absorbed into Mission Control; this controller now only opens the
 * interactive deck viewer (Alt+J, /jobs board, Command Hub) and persists
 * deck-fetched worker usage back onto the desk ledger. Job events still
 * flow through `job-desk-events` into `appState.conductorJobs`, which
 * Mission Control renders as condensed lanes.
 */

import type { ColorToken } from '../../theme';
import type { ConductorJobUsage } from '../../utils/job/job-strip';
import { ttui } from '../../utils/tui-i18n';

export interface JobBoardHost {
  showStatus(msg: string, color?: ColorToken): void;
  /** Mount the interactive Job Deck viewer (wired by LioraTUI). */
  readonly openJobDeck?: (jobId?: string) => void;
  /**
   * `appState.conductorJobs` has exactly one writer, the control-tower
   * sink. Usage backfill goes through it rather than patching appState here.
   */
  readonly controlTowerDesk?: {
    applyJobUsage(jobId: string, usage: ConductorJobUsage): boolean;
  };
}

export class JobBoardController {
  constructor(private readonly host: JobBoardHost) {}

  /**
   * Open the interactive Job Deck viewer, optionally focused on one job
   * (`/jobs deck <id>`). Falls back to a hint when the opener is not wired.
   */
  openDeck(jobId?: string): void {
    if (this.host.openJobDeck !== undefined) {
      this.host.openJobDeck(jobId);
      return;
    }
    this.host.showStatus(ttui('tui.conductor.jobDeckUnavailable'), 'textMuted');
  }

  /** Persist Job Deck–fetched token usage onto the desk ledger. */
  rememberUsage(jobId: string, usage: ConductorJobUsage): void {
    this.host.controlTowerDesk?.applyJobUsage(jobId, usage);
  }
}
