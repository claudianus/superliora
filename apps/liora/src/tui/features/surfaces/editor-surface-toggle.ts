/**
 * Editor-replacement surface toggling.
 *
 * Job Deck (Alt+J) and Inbox (Alt+I) mount as editor replacements and are
 * closed by restoring the editor. The homepage demo models them as overlays
 * you press the same key again to close, so we give the keyboard path real
 * toggle semantics at the single choke points (`openJobDeckViewer`,
 * `openInbox`): if the surface this key last opened is still the current
 * editor child, a repeat press restores the editor instead of remounting.
 *
 * A panel is only ever toggled shut when it is the *actual current* editor
 * child of the host that pressed the key (identity check against the live
 * container), so a stale record can never close another host's panel or a
 * different surface that has since taken over the editor area.
 */

import type { Component } from '#/tui/renderer';

export const SURFACE_JOB_DECK = 'job-deck' as const;
export const SURFACE_JOB_INBOX = 'job-inbox' as const;
export const SURFACE_QUOTA = 'quota' as const;
export const SURFACE_PLAN = 'plan' as const;
export type EditorSurfaceKind =
  | typeof SURFACE_JOB_DECK
  | typeof SURFACE_JOB_INBOX
  | typeof SURFACE_QUOTA
  | typeof SURFACE_PLAN;

export interface EditorSurfaceHost {
  readonly state: {
    readonly editorContainer: { readonly children: readonly Component[] };
  };
  restoreEditor(): void;
}

const lastOpenedByKind = new Map<EditorSurfaceKind, Component>();

/** True when `panel` is currently the only child mounted in the editor area. */
function isCurrentEditorChild(host: EditorSurfaceHost, panel: Component): boolean {
  const children = host.state.editorContainer.children;
  return children.length === 1 && children[0] === panel;
}

/**
 * Toggle off: if `kind`'s last panel is still the current editor child,
 * restore the editor and return true so the caller skips opening a new one.
 */
export function toggleOffOpenSurface(host: EditorSurfaceHost, kind: EditorSurfaceKind): boolean {
  const panel = lastOpenedByKind.get(kind);
  if (panel === undefined) return false;
  if (!isCurrentEditorChild(host, panel)) return false;
  host.restoreEditor();
  lastOpenedByKind.delete(kind);
  return true;
}

/** Record the panel a surface opened so a repeat keypress can toggle it shut. */
export function rememberOpenSurface(kind: EditorSurfaceKind, panel: Component): void {
  lastOpenedByKind.set(kind, panel);
}
