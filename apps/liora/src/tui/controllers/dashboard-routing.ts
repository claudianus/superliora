/**
 * Dashboard Routing — handles entry/exit to the bento grid dashboard view.
 *
 * Entry: Ctrl+G or /dashboard command.
 * Exit: Escape or /dashboard again (toggle).
 * On exit, the original conversation view resumes.
 *
 * AC-5: Ctrl+G or /dashboard enters dashboard view,
 *        exit resumes original conversation.
 */

import type { DashboardViewMode } from './quest-types';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface DashboardRoutingOptions {
  /** Whether the dashboard is currently active. */
  readonly isDashboardActive: () => boolean;
  /** Activate the dashboard view (hide conversation, show grid). */
  readonly activateDashboard: () => void;
  /** Deactivate the dashboard view (show conversation, hide grid). */
  readonly deactivateDashboard: () => void;
  /** Request a re-render. */
  readonly requestRender: () => void;
}

// ---------------------------------------------------------------------------
// DashboardRouting
// ---------------------------------------------------------------------------

export class DashboardRouting {
  private active = false;
  private readonly isDashboardActive: () => boolean;
  private readonly activateDashboard: () => void;
  private readonly deactivateDashboard: () => void;
  private readonly requestRender: () => void;

  constructor(options: DashboardRoutingOptions) {
    this.isDashboardActive = options.isDashboardActive;
    this.activateDashboard = options.activateDashboard;
    this.deactivateDashboard = options.deactivateDashboard;
    this.requestRender = options.requestRender;
  }

  // -------------------------------------------------------------------------
  // Toggle
  // -------------------------------------------------------------------------

  /**
   * Toggle the dashboard view.
   * Called by Ctrl+G keybinding or /dashboard command.
   */
  toggle(): void {
    if (this.active) {
      this.exit();
    } else {
      this.enter();
    }
  }

  /** Enter the dashboard view. */
  enter(): void {
    if (this.active) return;
    this.active = true;
    this.activateDashboard();
    this.requestRender();
  }

  /** Exit the dashboard view, resuming conversation. */
  exit(): void {
    if (!this.active) return;
    this.active = false;
    this.deactivateDashboard();
    this.requestRender();
  }

  // -------------------------------------------------------------------------
  // Queries
  // -------------------------------------------------------------------------

  /** Whether the dashboard is currently active. */
  get isActive(): boolean {
    return this.active;
  }
}
