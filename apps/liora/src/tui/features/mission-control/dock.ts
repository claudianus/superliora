/**
 * Mission Control dock geometry + visibility. The dock is a right-side
 * workspace band painted as a frame region on wide terminals; the stage
 * resolves inside the remaining center band via `workspaceCenter`. Narrow
 * terminals fall back to the in-stack `mission` chrome region instead.
 */

import type { RendererRect } from '#/tui/renderer';

import type { TUIState } from '../../tui-state';

/** Right dock width (cols), frame included. */
export const MISSION_DOCK_WIDTH = 40;
/**
 * Below this many columns the dock would squeeze the stage reading column —
 * the in-stack fallback band takes over.
 */
export const MISSION_DOCK_MIN_COLUMNS = 148;
/**
 * Above stage letterbox (4) / frame rim (5) so the night-sky gutters cannot
 * bury the dock; below toast (9) and fullscreen takeover (1000).
 */
export const MISSION_DOCK_Z_INDEX = 6;

export type MissionControlMode = 'auto' | 'pinned' | 'hidden';

export interface MissionDockStateLike {
  readonly appState: {
    readonly appearance?: { readonly missionControl?: MissionControlMode };
  };
  readonly missionControlPanel: { isEmpty(): boolean };
}

export function missionControlModeOf(state: MissionDockStateLike): MissionControlMode {
  return state.appState.appearance?.missionControl ?? 'auto';
}

/** The right dock owns a band only on wide terminals with something to show. */
export function missionDockActive(state: MissionDockStateLike, columns: number): boolean {
  const mode = missionControlModeOf(state);
  if (mode === 'hidden') return false;
  if (!Number.isFinite(columns) || columns < MISSION_DOCK_MIN_COLUMNS) return false;
  return mode === 'pinned' || !state.missionControlPanel.isEmpty();
}

/** The in-stack band shows whenever the dock cannot but content exists. */
export function missionFallbackActive(state: MissionDockStateLike, columns: number): boolean {
  const mode = missionControlModeOf(state);
  if (mode === 'hidden') return false;
  if (missionDockActive(state, columns)) return false;
  return mode === 'pinned' || !state.missionControlPanel.isEmpty();
}

export function missionDockRect(columns: number, rows: number): RendererRect {
  const width = Math.min(MISSION_DOCK_WIDTH, Math.max(0, columns));
  return { x: Math.max(0, columns - width), y: 0, width, height: Math.max(0, rows) };
}

/**
 * Center band left for the stage while the dock is visible — the first
 * production consumer of the native frame callback's `workspaceCenter` hook.
 */
export function missionWorkspaceCenterRect(
  state: MissionDockStateLike,
  columns: number,
  rows: number,
): RendererRect | undefined {
  if (!missionDockActive(state, columns)) return undefined;
  return { x: 0, y: 0, width: Math.max(1, columns - MISSION_DOCK_WIDTH), height: rows };
}

/** Convenience guard used by the frame build before painting the dock region. */
export function resolveMissionDockRect(
  state: TUIState,
  columns: number,
  rows: number,
): RendererRect | undefined {
  if (!missionDockActive(state, columns)) return undefined;
  return missionDockRect(columns, rows);
}
