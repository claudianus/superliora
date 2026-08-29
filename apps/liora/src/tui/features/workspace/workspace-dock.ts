/**
 * Workspace side dock — a worker's live transcript in a right-hand column
 * beside the main transcript (flag: `workspace_dock`, off by default).
 *
 * Split of responsibilities:
 * - `getWorkspaceDockCenterRect` is wired as the frame callback's
 *   `workspaceCenter` provider: while the dock is open it returns the
 *   measured center band so the stage (chrome + transcript + editor) shrinks
 *   to make room; closed it returns `null` and layout is bit-for-bit the
 *   pre-flag behavior.
 * - `createWorkspaceDockFrameRegion` builds the dock overlay region from the
 *   measured right-dock rect; the viewer instance is owned here so its live
 *   fetch cycle survives across frames.
 *
 * v1 is a live follow-tail view: no focus or input routing — the editor
 * keeps every key. Opening is via the worker-dock band click path.
 */

import {
  measureWorkspaceLayout,
  promoteRendererRegionLinesToCells,
  type RendererFrameRegion,
  type RendererRect,
} from '@harness-kit/tui-renderer';

import { isExperimentalFlagEnabled } from '../../commands/experimental-flags';
import { WorkerTranscriptViewerComponent } from '../../components/dialogs/worker-dock/worker-transcript-viewer';
import { currentTheme } from '../../theme';
import { requestTUILayoutRender } from '../../utils/render/frame-render';
import { invalidateTranscriptHitTestCache } from '../transcript/transcript-hit-test';
import type { TUIState } from '../../tui-state';

/** Dock column width handed to measureWorkspaceLayout (its own clamp applies). */
export const WORKSPACE_DOCK_WIDTH = 52;
/** Fixed viewer chrome rows (top/bottom border, title, hint, meta, rail, blank). */
const DOCK_FIXED_ROWS = 8;
/** Right-side gap between the center band and the dock column. */
const DOCK_GAP = 2;

interface WorkspaceDockState {
  readonly open: boolean;
  readonly workerId: string | undefined;
  readonly viewer: WorkerTranscriptViewerComponent | undefined;
}

const dock: {
  open: boolean;
  workerId: string | undefined;
  viewer: WorkerTranscriptViewerComponent | undefined;
} = { open: false, workerId: undefined, viewer: undefined };

export function isWorkspaceDockEnabled(): boolean {
  return isExperimentalFlagEnabled('workspace_dock');
}

export function isWorkspaceDockOpen(): boolean {
  return dock.open;
}

/**
 * Open (or switch) the dock for `workerId`; calling again with the id that is
 * already open closes it. Always invalidates the transcript hit-test cache —
 * opening/closing shifts the stage origin without a resize, which the cache
 * key cannot see.
 */
export function toggleWorkspaceDock(input: {
  readonly state: TUIState;
  readonly workerId: string;
  readonly createViewer: () => WorkerTranscriptViewerComponent;
}): void {
  if (!isWorkspaceDockEnabled()) return;
  if (dock.open && dock.workerId === input.workerId) {
    closeWorkspaceDock(input.state);
    return;
  }
  dock.open = true;
  dock.workerId = input.workerId;
  dock.viewer = input.createViewer();
  invalidateTranscriptHitTestCache(input.state);
  requestTUILayoutRender(input.state);
}

export function closeWorkspaceDock(state: TUIState): void {
  if (!dock.open) return;
  dock.open = false;
  dock.workerId = undefined;
  dock.viewer = undefined;
  invalidateTranscriptHitTestCache(state);
  requestTUILayoutRender(state);
}

/**
 * Center-band provider for the frame callback's `workspaceCenter` option.
 * Returns `null` whenever the dock should not occupy a column — flag off,
 * closed, or a terminal too narrow for a side dock (measureWorkspaceLayout
 * collapses the dock and hands back the full-width center).
 */
export function getWorkspaceDockCenterRect(ctx: {
  readonly columns: number;
  readonly rows: number;
}): RendererRect | null {
  if (!isWorkspaceDockEnabled() || !dock.open) return null;
  const layout = measureWorkspaceLayout({
    viewport: { x: 0, y: 0, width: ctx.columns, height: ctx.rows },
    rightDockWidth: WORKSPACE_DOCK_WIDTH,
    rightDockVisible: true,
  });
  return layout.rightDock === undefined ? null : layout.center;
}

/**
 * Build the dock overlay region for this frame. Callers pass the same
 * `workspaceCenter` rect the stage used; the dock is drawn in the columns to
 * the right of the center band, inside the shell inset.
 */
export function createWorkspaceDockFrameRegion(input: {
  readonly center: RendererRect;
  readonly width: number;
  readonly height: number;
}): RendererFrameRegion | undefined {
  if (!isWorkspaceDockEnabled() || !dock.open) return undefined;
  const dockX = input.center.x + input.center.width + DOCK_GAP;
  // One terminal column is left of the shell edge; the rest is dock body.
  const dockWidth = input.width - dockX - 1;
  if (dockWidth < 20) return undefined;
  const dockHeight = Math.min(input.center.height, Math.max(input.height - input.center.y, 0));
  if (dockHeight < 8) return undefined;

  const viewer = dock.viewer;
  if (viewer === undefined) return undefined;
  viewer.setRows(Math.max(4, dockHeight - DOCK_FIXED_ROWS));
  const lines = viewer.render(dockWidth);
  if (lines.length === 0) return undefined;

  return {
    id: 'liora-workspace-dock',
    rect: { x: dockX, y: input.center.y, width: dockWidth, height: dockHeight },
    content: promoteRendererRegionLinesToCells(lines),
    clear: true,
    background: currentTheme.canvasBackgroundCell(),
  };
}
