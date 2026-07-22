/**
 * Approval Controller — handles inline a/x/r actions from the dashboard.
 *
 * a (approve): sends stdin input to the session via reverse-rpc approval adapter.
 * x (reject): presents "cancel all vs reject step" choice to user.
 * r (rewind): opens rewind picker (commit/turn/step level selection).
 *
 * AC-4: inline approval works from both dashboard cell and pin view.
 */

import type { Quest } from './quest-types';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type ApprovalAction = 'approve' | 'reject' | 'rewind';

export type RejectMode = 'cancel-all' | 'reject-step';

export type RewindLevel = 'commit' | 'turn' | 'step';

export interface ApprovalControllerOptions {
  /** Send raw stdin to a session (for approve). */
  readonly sendStdin: (sessionRef: string, data: string) => void;
  /** Cancel an entire quest/session. */
  readonly cancelQuest: (questId: string) => void;
  /** Reject current step only (re-request from agent). */
  readonly rejectStep: (sessionRef: string) => void;
  /** Open the rewind picker UI. Returns selected level or null. */
  readonly openRewindPicker: (questId: string) => Promise<RewindLevel | null>;
  /** Execute rewind to a specific level. */
  readonly executeRewind: (questId: string, level: RewindLevel) => void;
  /** Present reject mode choice to user. Returns selected mode or null. */
  readonly presentRejectChoice: (questId: string) => Promise<RejectMode | null>;
  /** Request a re-render. */
  readonly requestRender: () => void;
}

// ---------------------------------------------------------------------------
// ApprovalController
// ---------------------------------------------------------------------------

export class ApprovalController {
  private readonly sendStdin: (sessionRef: string, data: string) => void;
  private readonly cancelQuest: (questId: string) => void;
  private readonly rejectStep: (sessionRef: string) => void;
  private readonly openRewindPicker: (questId: string) => Promise<RewindLevel | null>;
  private readonly executeRewind: (questId: string, level: RewindLevel) => void;
  private readonly presentRejectChoice: (questId: string) => Promise<RejectMode | null>;
  private readonly requestRender: () => void;

  constructor(options: ApprovalControllerOptions) {
    this.sendStdin = options.sendStdin;
    this.cancelQuest = options.cancelQuest;
    this.rejectStep = options.rejectStep;
    this.openRewindPicker = options.openRewindPicker;
    this.executeRewind = options.executeRewind;
    this.presentRejectChoice = options.presentRejectChoice;
    this.requestRender = options.requestRender;
  }

  // -------------------------------------------------------------------------
  // Action Dispatch
  // -------------------------------------------------------------------------

  /**
   * Handle an approval action for a quest.
   * Called when user presses a/x/r on a focused quest cell.
   */
  async handleAction(quest: Quest, action: ApprovalAction): Promise<void> {
    switch (action) {
      case 'approve':
        this.handleApprove(quest);
        break;
      case 'reject':
        await this.handleReject(quest);
        break;
      case 'rewind':
        await this.handleRewind(quest);
        break;
      default: {
        const _exhaustive: never = action;
        return _exhaustive;
      }
    }
  }

  // -------------------------------------------------------------------------
  // Approve (a)
  // -------------------------------------------------------------------------

  /** Send approval via stdin to the session. */
  private handleApprove(quest: Quest): void {
    // Reuse existing reverse-rpc approval adapter path:
    // send 'y\n' (yes) to the session's stdin
    this.sendStdin(quest.sessionRef, 'y\n');
    this.requestRender();
  }

  // -------------------------------------------------------------------------
  // Reject (x)
  // -------------------------------------------------------------------------

  /** Present choice: cancel all vs reject step only. */
  private async handleReject(quest: Quest): Promise<void> {
    const choice = await this.presentRejectChoice(quest.id);
    if (choice === null) return; // User cancelled the choice

    switch (choice) {
      case 'cancel-all':
        this.cancelQuest(quest.id);
        break;
      case 'reject-step':
        this.rejectStep(quest.sessionRef);
        break;
      default: {
        const _exhaustive: never = choice;
        return _exhaustive;
      }
    }
    this.requestRender();
  }

  // -------------------------------------------------------------------------
  // Rewind (r)
  // -------------------------------------------------------------------------

  /** Open rewind picker, then execute rewind to selected level. */
  private async handleRewind(quest: Quest): Promise<void> {
    const level = await this.openRewindPicker(quest.id);
    if (level === null) return; // User cancelled the picker

    this.executeRewind(quest.id, level);
    this.requestRender();
  }
}
