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
  /** Width (columns) of the left dock. @default DEFAULT_LEFT_DOCK_WIDTH */
  readonly leftDockWidth?: number;
  /** Width (columns) of the right dock. @default DEFAULT_RIGHT_DOCK_WIDTH */
  readonly rightDockWidth?: number;
  /** Minimum width for the center content area. @default DEFAULT_CENTER_MIN_WIDTH */
  readonly centerMinWidth?: number;
  /** Column threshold for wide mode (3-column). @default DEFAULT_WIDE_BREAKPOINT */
  readonly wideBreakpoint?: number;
  /** Column threshold for medium mode (2-column). @default DEFAULT_MEDIUM_BREAKPOINT */
  readonly mediumBreakpoint?: number;
  /** Whether the left dock is visible. @default true */
  readonly leftDockVisible?: boolean;
  /** Whether the right dock is visible. @default true */
  readonly rightDockVisible?: boolean;
  /** Gap between dock and center (columns). @default DEFAULT_DOCK_GAP */
  readonly dockGap?: number;
  /** Horizontal inset from viewport edges (columns). @default DEFAULT_SHELL_INSET_X */
  readonly shellInsetX?: number;
  /** Vertical inset from viewport edges (rows). @default DEFAULT_SHELL_INSET_Y */
  readonly shellInsetY?: number;
  /**
   * Dock to show as an inset overlay drawer inside the shell when the
   * current mode would otherwise hide it (narrow hides both docks; medium
   * hides the left dock). Set by the caller after the user explicitly
   * toggles that dock visible below the breakpoint that hides it. Has no
   * effect in wide mode, or when the dock is already shown structurally.
   */
  readonly drawerDock?: WorkspaceDockId;
}

export interface WorkspaceDockLayout {
  readonly id: WorkspaceDockId;
  readonly rect: RendererRect;
  readonly width: number;
}

export interface WorkspaceLayoutResult {
  readonly mode: WorkspaceLayoutMode;
  readonly viewport: RendererRect;
  /** Inset shell that owns all columns (equals viewport when inset collapses). */
  readonly shell: RendererRect;
  /** Center content area (always present). */
  readonly center: RendererRect;
  /** Left dock (present in wide mode when visible). */
  readonly leftDock?: WorkspaceDockLayout;
  /** Right dock (present in wide/medium mode when visible). */
  readonly rightDock?: WorkspaceDockLayout;
  readonly dockGap: number;
  readonly shellInsetX: number;
  readonly shellInsetY: number;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

export const DEFAULT_LEFT_DOCK_WIDTH = 42;
export const DEFAULT_RIGHT_DOCK_WIDTH = 52;
export const DEFAULT_CENTER_MIN_WIDTH = 60;
export const DEFAULT_WIDE_BREAKPOINT = 160;
export const DEFAULT_MEDIUM_BREAKPOINT = 120;
export const DEFAULT_DOCK_GAP = 2;
export const DEFAULT_SHELL_INSET_X = 2;
export const DEFAULT_SHELL_INSET_Y = 1;
export const DOCK_WIDTH_MIN = 24;
export const DOCK_WIDTH_MAX = 80;

// ---------------------------------------------------------------------------
// Implementation
// ---------------------------------------------------------------------------

export function insetRendererRect(
  rect: RendererRect,
  insetX: number,
  insetY: number,
): RendererRect {
  const ix = Math.max(0, Math.min(insetX, Math.floor((rect.width - 1) / 2)));
  const iy = Math.max(0, Math.min(insetY, Math.floor((rect.height - 1) / 2)));
  return {
    x: rect.x + ix,
    y: rect.y + iy,
    width: Math.max(1, rect.width - ix * 2),
    height: Math.max(1, rect.height - iy * 2),
  };
}

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
  const shellInsetX = options.shellInsetX ?? DEFAULT_SHELL_INSET_X;
  const shellInsetY = options.shellInsetY ?? DEFAULT_SHELL_INSET_Y;
  const shell = insetRendererRect(viewport, shellInsetX, shellInsetY);

  const layoutMeta = { viewport, shell, dockGap, shellInsetX, shellInsetY };

  // Determine layout mode from viewport width (terminal size), not shell width
  const mode = resolveLayoutMode(cols, wideBreakpoint, mediumBreakpoint);

  const visibility = { leftDockVisible, rightDockVisible };
  const dockWidths = { left: leftDockWidth, right: rightDockWidth };

  if (mode === 'narrow') {
    const result = { mode, ...layoutMeta, center: shell };
    return applyDrawerOverlay(result, layoutMeta, options.drawerDock, visibility, dockWidths);
  }

  if (mode === 'medium') {
    const result = !rightDockVisible
      ? { mode, ...layoutMeta, center: shell }
      : computeTwoColumnLayout(layoutMeta, rightDockWidth, centerMinWidth, dockGap, 'right');
    return applyDrawerOverlay(result, layoutMeta, options.drawerDock, visibility, dockWidths);
  }

  // Wide mode
  const showLeft = leftDockVisible;
  const showRight = rightDockVisible;

  if (!showLeft && !showRight) {
    return { mode, ...layoutMeta, center: shell };
  }

  if (showLeft && !showRight) {
    return computeTwoColumnLayout(layoutMeta, leftDockWidth, centerMinWidth, dockGap, 'left');
  }

  if (!showLeft && showRight) {
    return computeTwoColumnLayout(layoutMeta, rightDockWidth, centerMinWidth, dockGap, 'right');
  }

  // Full 3-column layout
  return computeThreeColumnLayout(
    layoutMeta,
    leftDockWidth,
    rightDockWidth,
    centerMinWidth,
    dockGap,
  );
}

/**
 * Overlays `drawerDock` onto `result` as an inset drawer inside the shell,
 * when that side is visible but isn't already shown structurally (narrow
 * shows no docks; medium shows only the right dock). The drawer floats over
 * whatever `result.center`/other dock already occupy — it does not reflow
 * them.
 */
function applyDrawerOverlay(
  result: WorkspaceLayoutResult,
  meta: WorkspaceLayoutMeta,
  drawerDock: WorkspaceDockId | undefined,
  visibility: { leftDockVisible: boolean; rightDockVisible: boolean },
  dockWidths: { left: number; right: number },
): WorkspaceLayoutResult {
  if (!drawerDock) return result;

  const alreadyShown = drawerDock === 'left' ? result.leftDock : result.rightDock;
  if (alreadyShown) return result;

  const visible = drawerDock === 'left' ? visibility.leftDockVisible : visibility.rightDockVisible;
  if (!visible) return result;

  const requestedWidth = drawerDock === 'left' ? dockWidths.left : dockWidths.right;
  const rect = computeDrawerRect(meta.shell, requestedWidth, drawerDock);
  const dock: WorkspaceDockLayout = { id: drawerDock, rect, width: rect.width };

  return drawerDock === 'left' ? { ...result, leftDock: dock } : { ...result, rightDock: dock };
}

/** Inset drawer rect: flush to the shell edge on `side`, full shell height. */
function computeDrawerRect(shell: RendererRect, requestedWidth: number, side: WorkspaceDockId): RendererRect {
  const width = Math.max(1, Math.min(requestedWidth, shell.width - 4));
  return {
    x: side === 'left' ? shell.x : shell.x + shell.width - width,
    y: shell.y,
    width,
    height: shell.height,
  };
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

interface WorkspaceLayoutMeta {
  readonly viewport: RendererRect;
  readonly shell: RendererRect;
  readonly dockGap: number;
  readonly shellInsetX: number;
  readonly shellInsetY: number;
}

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
  meta: WorkspaceLayoutMeta,
  dockWidth: number,
  centerMinWidth: number,
  gap: number,
  dockSide: WorkspaceDockId,
): WorkspaceLayoutResult {
  const { viewport, shell } = meta;
  const effectiveDockWidth = Math.min(dockWidth, Math.max(0, shell.width - centerMinWidth - gap));

  if (effectiveDockWidth <= 0) {
    return { mode: 'narrow', ...meta, center: shell };
  }

  const constraints =
    dockSide === 'left'
      ? [layoutLength(effectiveDockWidth), layoutFlex(1)]
      : [layoutFlex(1), layoutLength(effectiveDockWidth)];

  const rects = splitRendererRect({
    rect: shell,
    direction: 'horizontal',
    constraints,
    gap,
  });

  if (rects.length < 2) {
    return { mode: 'narrow', ...meta, center: shell };
  }

  const mode = resolveLayoutMode(
    viewport.width,
    DEFAULT_WIDE_BREAKPOINT,
    DEFAULT_MEDIUM_BREAKPOINT,
  );

  if (dockSide === 'left') {
    return {
      mode,
      ...meta,
      center: rects[1]!,
      leftDock: { id: 'left', rect: rects[0]!, width: effectiveDockWidth },
    };
  }

  return {
    mode,
    ...meta,
    center: rects[0]!,
    rightDock: { id: 'right', rect: rects[1]!, width: effectiveDockWidth },
  };
}

function computeThreeColumnLayout(
  meta: WorkspaceLayoutMeta,
  leftWidth: number,
  rightWidth: number,
  centerMinWidth: number,
  gap: number,
): WorkspaceLayoutResult {
  const { shell } = meta;
  const totalGaps = gap * 2;
  const availableForDocks = shell.width - centerMinWidth - totalGaps;

  // Scale docks proportionally if they don't fit
  let effectiveLeft = leftWidth;
  let effectiveRight = rightWidth;

  if (leftWidth + rightWidth > availableForDocks) {
    const scale = availableForDocks / (leftWidth + rightWidth);
    effectiveLeft = Math.floor(leftWidth * scale);
    effectiveRight = Math.floor(rightWidth * scale);
  }

  if (effectiveLeft + effectiveRight <= 0) {
    return { mode: 'narrow', ...meta, center: shell };
  }

  const rects = splitRendererRect({
    rect: shell,
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
    return computeTwoColumnLayout(meta, rightWidth, centerMinWidth, gap, 'right');
  }

  return {
    mode: 'wide',
    ...meta,
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
