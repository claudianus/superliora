import type { WorkspaceDockId, WorkspaceLayoutMode } from '@harness-kit/tui-renderer';

// ---------------------------------------------------------------------------
// Drawer-aware dock toggle decision.
//
// PanelManager docks default to `visible = true`. On narrow/medium
// viewports the affected dock is structurally omitted from the measured
// layout (narrow hides both docks; medium hides the left dock only) even
// though it is still logically "visible". A naive `toggleDock()` flips that
// flag `true -> false` on the *first* press, which has no visible effect
// (the dock was already absent) — the drawer only appears on the *second*
// press, once the flag flips back to `true`.
//
// This module resolves the correct action up front so the first press opens
// the drawer directly. It is a pure function so it can be unit-tested
// without spinning up `WorkspaceController`.
// ---------------------------------------------------------------------------

export type DockToggleAction = 'open-drawer' | 'close-drawer' | 'toggle';

export interface DockToggleDecision {
  /** What the caller should do to `PanelManager`'s visibility flag. */
  readonly action: DockToggleAction;
  /** Next value for `WorkspaceController`'s `lastToggledDock` field. */
  readonly lastToggledDock: WorkspaceDockId | null;
}

/** Whether `dock` is structurally omitted from the layout at `mode`. */
function isHiddenByBreakpoint(mode: WorkspaceLayoutMode, dock: WorkspaceDockId): boolean {
  return mode === 'narrow' || (mode === 'medium' && dock === 'left');
}

/**
 * Resolve what a toggle-dock shortcut/command should do for `dock`, given
 * the current layout mode and dock state.
 *
 * - Below the breakpoint that structurally hides `dock`: if it's currently
 *   showing as a drawer overlay, close it. Otherwise (first press) open the
 *   drawer without flipping visibility off — visibility is already `true`.
 * - Otherwise (wide mode, or a dock the current mode shows structurally):
 *   fall back to a plain visibility toggle.
 */
export function resolveDockToggleDecision(params: {
  readonly dock: WorkspaceDockId;
  readonly mode: WorkspaceLayoutMode;
  /** `PanelManager.isDockVisible(dock)` — the raw visibility flag. */
  readonly isDockVisible: boolean;
  /** Whether `dock` is present in the current `WorkspaceLayoutResult`. */
  readonly isDockInLayout: boolean;
}): DockToggleDecision {
  const { dock, mode, isDockVisible, isDockInLayout } = params;

  if (isHiddenByBreakpoint(mode, dock)) {
    if (isDockInLayout) {
      // Only reachable via the drawer overlay at this mode/dock combo —
      // close it.
      return { action: 'close-drawer', lastToggledDock: null };
    }
    if (isDockVisible) {
      // Default-hidden-by-breakpoint: first press opens the drawer.
      return { action: 'open-drawer', lastToggledDock: dock };
    }
  }

  return { action: 'toggle', lastToggledDock: dock };
}
