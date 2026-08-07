/**
 * Mission Control bento geometry + visibility. On wide terminals the dock is
 * a capped panel that shares the stage's height and sits in a centered
 * stage+dock cluster (not glued to the terminal's right edge). The stage
 * resolves inside the cluster's left cell via `workspaceCenter`. Narrow
 * terminals fall back to the in-stack `mission` chrome region instead.
 */

import type { RendererRect } from '#/tui/renderer';

import { resolveStageLayout } from '../../controllers/layout/stage-layout';
import type { TUIState } from '../../tui-state';

/** Right panel width (cols), frame included. */
export const MISSION_DOCK_WIDTH = 40;
/** Gap between the stage and Mission Control in the centered cluster. */
export const MISSION_DOCK_GAP = 1;
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
  readonly userStageSize?: { readonly width: number; readonly height: number };
}

export interface MissionBentoCluster {
  /** Stage cell — passed as `workspaceCenter` so the stage fills this band. */
  readonly stageBand: RendererRect;
  /** Mission Control cell — same height as the stage, adjacent to its right. */
  readonly dock: RendererRect;
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

/**
 * Centered stage+dock cluster. Stage size mirrors {@link resolveStageLayout}
 * after reserving dock+gap; both panels share height and sit as one bundle.
 */
export function measureMissionBentoCluster(
  columns: number,
  rows: number,
  userStageSize?: { readonly width: number; readonly height: number },
): MissionBentoCluster {
  const cols = Math.max(0, Math.floor(columns));
  const bandRows = Math.max(0, Math.floor(rows));
  const dockWidth = Math.min(MISSION_DOCK_WIDTH, cols);
  const gap = cols > dockWidth ? MISSION_DOCK_GAP : 0;
  const reserved = dockWidth + gap;
  // Size the stage inside the space left for it, then re-center stage+dock
  // together so the pair — not only the stage — is the reading focus.
  const provisional = resolveStageLayout({
    width: cols,
    height: bandRows,
    workspaceCenter: {
      x: 0,
      y: 0,
      width: Math.max(1, cols - reserved),
      height: Math.max(1, bandRows),
    },
    userStageSize,
  });
  const stageWidth = provisional.stage.width;
  const stageHeight = provisional.stage.height;
  const clusterWidth = stageWidth + gap + dockWidth;
  const clusterX = cols > clusterWidth ? Math.floor((cols - clusterWidth) / 2) : 0;
  const clusterY =
    bandRows > stageHeight ? Math.floor((bandRows - stageHeight) / 2) : 0;
  return {
    stageBand: {
      x: clusterX,
      y: clusterY,
      width: stageWidth,
      height: stageHeight,
    },
    dock: {
      x: clusterX + stageWidth + gap,
      y: clusterY,
      width: dockWidth,
      height: stageHeight,
    },
  };
}

export function missionDockRect(
  columns: number,
  rows: number,
  userStageSize?: { readonly width: number; readonly height: number },
): RendererRect {
  return measureMissionBentoCluster(columns, rows, userStageSize).dock;
}

/**
 * Stage cell of the centered cluster — the production consumer of the native
 * frame callback's `workspaceCenter` hook.
 */
export function missionWorkspaceCenterRect(
  state: MissionDockStateLike,
  columns: number,
  rows: number,
): RendererRect | undefined {
  if (!missionDockActive(state, columns)) return undefined;
  return measureMissionBentoCluster(columns, rows, state.userStageSize).stageBand;
}

/** Convenience guard used by the frame build before painting the dock region. */
export function resolveMissionDockRect(
  state: TUIState,
  columns: number,
  rows: number,
): RendererRect | undefined {
  if (!missionDockActive(state, columns)) return undefined;
  return measureMissionBentoCluster(columns, rows, state.userStageSize).dock;
}
