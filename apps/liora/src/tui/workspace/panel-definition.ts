import type { NativeInputEvent } from '@harness-kit/tui-renderer';

// ---------------------------------------------------------------------------
// Panel definition interface
// ---------------------------------------------------------------------------

/**
 * A workspace panel that can be docked in the left/right side panels.
 * Each panel renders its own content and handles its own input when focused.
 */
export interface PanelDefinition {
  /** Unique identifier for this panel type. */
  readonly id: string;
  /** Display title shown in the panel title bar. */
  readonly title: string;
  /** Icon character (nerd font or ASCII) shown before the title. */
  readonly icon: string;
  /** Minimum width in columns. */
  readonly minWidth: number;
  /** Minimum height in rows. */
  readonly minHeight: number;

  /**
   * Render the panel content.
   * @param width - Available width in columns (inside the frame border).
   * @param height - Available height in rows (inside the frame border).
   * @param focused - Whether this panel currently has input focus.
   * @returns Array of content lines, each at most `width` characters.
   */
  render(width: number, height: number, focused: boolean): string[];

  /**
   * Handle an input event when this panel is focused.
   * @returns true if the event was consumed.
   */
  onInput?(event: NativeInputEvent): boolean;

  /** Called when the panel gains focus. */
  onFocus?(): void;

  /** Called when the panel loses focus. */
  onBlur?(): void;

  /** Called when the panel is removed from the workspace. Clean up resources. */
  dispose?(): void;
}

// ---------------------------------------------------------------------------
// Panel instance (a specific panel placed in a dock)
// ---------------------------------------------------------------------------

export interface PanelInstance {
  readonly instanceId: string;
  readonly definition: PanelDefinition;
}

// ---------------------------------------------------------------------------
// Dock assignment
// ---------------------------------------------------------------------------

export interface DockAssignment {
  readonly panelInstanceId: string;
  /** Height ratio within the dock (0-1). If undefined, equal split. */
  readonly heightRatio?: number;
}
