import type { RendererRect } from './compositor';
import {
  layoutFlex,
  layoutLength,
  layoutMin,
  splitRendererRect,
} from './layout';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type WorkspaceDockId = 'left' | 'right';

export type WorkspaceLayoutMode = 'wide' | 'medium' | 'narrow';

export interface WorkspaceLayoutOptions {
  /** Full terminal viewport rect (typically { x: 0, y: 0, width: cols, height: rows }). */
  readonly viewport: RendererRect;
  /** Width (columns) of the left dock. @default 30 */
  readonly leftDockWidth?: number;
  /** Width (columns) of the right dock. @default 40 */
  readonly rightDockWidth?: number;
  /** Minimum width for the center content area. @default 60 */
  readonly centerMinWidth?: number;
  /** Column threshold for wide mode (3-column). @default 160 */
  readonly wideBreakpoint?: number;
  /** Column threshold for medium mode (2-column). @default 120 */
  readonly mediumBreakpoint?: number;
  /** Whether the left dock is visible. @default true */
  readonly leftDockVisible?: boolean;
  /** Whether the right dock is visible. @default true */
  readonly rightDockVisible?: boolean;
  /** Gap between dock and center (columns). @default 0 */
  readonly dockGap?: number;
}

export interface WorkspaceDockLayout {
  readonly id: WorkspaceDockId;
  readonly rect: RendererRect;
  readonly width: number;
}

export interface WorkspaceLayoutResult {
  readonly mode: WorkspaceLayoutMode;
  readonly viewport: RendererRect;
  /** Center content area (always present). */
  readonly center: RendererRect;
  /** Left dock (present in wide mode when visible). */
  readonly leftDock?: WorkspaceDockLayout;
  /** Right dock (present in wide/medium mode when visible). */
  readonly rightDock?: WorkspaceDockLayout;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const DEFAULT_LEFT_DOCK_WIDTH = 30;
const DEFAULT_RIGHT_DOCK_WIDTH = 40;
const DEFAULT_CENTER_MIN_WIDTH = 60;
const DEFAULT_WIDE_BREAKPOINT = 160;
const DEFAULT_MEDIUM_BREAKPOINT = 120;
const DEFAULT_DOCK_GAP = 0;

// ---------------------------------------------------------------------------
// Implementation
// ---------------------------------------------------------------------------

/**
 * Computes the 2D workspace layout based on terminal width.
 *
 * - **wide** (>= wideBreakpoint): `[left-dock | center | right-dock]`
 * - **medium** (>= mediumBreakpoint): `[center | right-dock]`
 * - **narrow** (< mediumBreakpoint): `[center]` only (legacy vertical stack)
 */
export function measureWorkspaceLayout(options: WorkspaceLayoutOptions): WorkspaceLayoutResult {
  const viewport = options.viewport;
  const cols = viewport.width;

  const leftDockWidth = options.leftDockWidth ?? DEFAULT_LEFT_DOCK_WIDTH;
  const rightDockWidth = options.rightDockWidth ?? DEFAULT_RIGHT_DOCK_WIDTH;
  const centerMinWidth = options.centerMinWidth ?? DEFAULT_CENTER_MIN_WIDTH;
  const wideBreakpoint = options.wideBreakpoint ?? DEFAULT_WIDE_BREAKPOINT;
  const mediumBreakpoint = options.mediumBreakpoint ?? DEFAULT_MEDIUM_BREAKPOINT;
  const leftDockVisible = options.leftDockVisible ?? true;
  const rightDockVisible = options.rightDockVisible ?? true;
  const dockGap = options.dockGap ?? DEFAULT_DOCK_GAP;

  // Determine layout mode
  const mode = resolveLayoutMode(cols, wideBreakpoint, mediumBreakpoint);

  if (mode === 'narrow') {
    return { mode, viewport, center: viewport };
  }

  if (mode === 'medium') {
    if (!rightDockVisible) {
      return { mode, viewport, center: viewport };
    }
    return computeTwoColumnLayout(viewport, rightDockWidth, centerMinWidth, dockGap, 'right');
  }

  // Wide mode
  const showLeft = leftDockVisible;
  const showRight = rightDockVisible;

  if (!showLeft && !showRight) {
    return { mode, viewport, center: viewport };
  }

  if (showLeft && !showRight) {
    return computeTwoColumnLayout(viewport, leftDockWidth, centerMinWidth, dockGap, 'left');
  }

  if (!showLeft && showRight) {
    return computeTwoColumnLayout(viewport, rightDockWidth, centerMinWidth, dockGap, 'right');
  }

  // Full 3-column layout
  return computeThreeColumnLayout(viewport, leftDockWidth, rightDockWidth, centerMinWidth, dockGap);
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function resolveLayoutMode(
  cols: number,
  wideBreakpoint: number,
  mediumBreakpoint: number,
): WorkspaceLayoutMode {
  if (cols >= wideBreakpoint) return 'wide';
  if (cols >= mediumBreakpoint) return 'medium';
  return 'narrow';
}

function computeTwoColumnLayout(
  viewport: RendererRect,
  dockWidth: number,
  centerMinWidth: number,
  gap: number,
  dockSide: WorkspaceDockId,
): WorkspaceLayoutResult {
  const effectiveDockWidth = Math.min(dockWidth, Math.max(0, viewport.width - centerMinWidth - gap));

  if (effectiveDockWidth <= 0) {
    return { mode: 'narrow', viewport, center: viewport };
  }

  const constraints =
    dockSide === 'left'
      ? [layoutLength(effectiveDockWidth), layoutFlex(1)]
      : [layoutFlex(1), layoutLength(effectiveDockWidth)];

  const rects = splitRendererRect({
    rect: viewport,
    direction: 'horizontal',
    constraints,
    gap,
  });

  if (rects.length < 2) {
    return { mode: 'narrow', viewport, center: viewport };
  }

  const mode = resolveLayoutMode(
    viewport.width,
    DEFAULT_WIDE_BREAKPOINT,
    DEFAULT_MEDIUM_BREAKPOINT,
  );

  if (dockSide === 'left') {
    return {
      mode,
      viewport,
      center: rects[1]!,
      leftDock: { id: 'left', rect: rects[0]!, width: effectiveDockWidth },
    };
  }

  return {
    mode,
    viewport,
    center: rects[0]!,
    rightDock: { id: 'right', rect: rects[1]!, width: effectiveDockWidth },
  };
}

function computeThreeColumnLayout(
  viewport: RendererRect,
  leftWidth: number,
  rightWidth: number,
  centerMinWidth: number,
  gap: number,
): WorkspaceLayoutResult {
  const totalGaps = gap * 2;
  const availableForDocks = viewport.width - centerMinWidth - totalGaps;

  // Scale docks proportionally if they don't fit
  let effectiveLeft = leftWidth;
  let effectiveRight = rightWidth;

  if (leftWidth + rightWidth > availableForDocks) {
    const scale = availableForDocks / (leftWidth + rightWidth);
    effectiveLeft = Math.floor(leftWidth * scale);
    effectiveRight = Math.floor(rightWidth * scale);
  }

  if (effectiveLeft + effectiveRight <= 0) {
    return { mode: 'narrow', viewport, center: viewport };
  }

  const rects = splitRendererRect({
    rect: viewport,
    direction: 'horizontal',
    constraints: [
      layoutLength(effectiveLeft),
      layoutMin(centerMinWidth),
      layoutLength(effectiveRight),
    ],
    gap,
  });

  if (rects.length < 3) {
    // Fallback: try without left dock
    return computeTwoColumnLayout(viewport, rightWidth, centerMinWidth, gap, 'right');
  }

  return {
    mode: 'wide',
    viewport,
    leftDock: { id: 'left', rect: rects[0]!, width: effectiveLeft },
    center: rects[1]!,
    rightDock: { id: 'right', rect: rects[2]!, width: effectiveRight },
  };
}

// ---------------------------------------------------------------------------
// Utility: hit-test which dock/center a column belongs to
// ---------------------------------------------------------------------------

export type WorkspaceHitZone = 'left-dock' | 'center' | 'right-dock' | 'none';

export function hitTestWorkspaceZone(
  layout: WorkspaceLayoutResult,
  x: number,
  y: number,
): WorkspaceHitZone {
  if (layout.leftDock && containsPoint(layout.leftDock.rect, x, y)) {
    return 'left-dock';
  }
  if (layout.rightDock && containsPoint(layout.rightDock.rect, x, y)) {
    return 'right-dock';
  }
  if (containsPoint(layout.center, x, y)) {
    return 'center';
  }
  return 'none';
}

function containsPoint(rect: RendererRect, x: number, y: number): boolean {
  return x >= rect.x && x < rect.x + rect.width && y >= rect.y && y < rect.y + rect.height;
}
