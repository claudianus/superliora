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

export type WorkspaceLayoutMode = 'ultrawide' | 'wide' | 'medium' | 'narrow' | 'compact' | 'micro';

export interface WorkspaceLayoutOptions {
  /** Full terminal viewport rect (typically { x: 0, y: 0, width: cols, height: rows }). */
  readonly viewport: RendererRect;
  /** Width (columns) of the left dock. @default DEFAULT_LEFT_DOCK_WIDTH */
  readonly leftDockWidth?: number;
  /** Width (columns) of the right dock. @default DEFAULT_RIGHT_DOCK_WIDTH */
  readonly rightDockWidth?: number;
  /** Minimum width for the center content area. @default DEFAULT_CENTER_MIN_WIDTH */
  readonly centerMinWidth?: number;
  /** Column threshold for ultrawide mode (expanded 3-column + breathing room). @default DEFAULT_ULTRAWIDE_BREAKPOINT */
  readonly ultrawideBreakpoint?: number;
  /** Column threshold for wide mode (3-column). @default DEFAULT_WIDE_BREAKPOINT */
  readonly wideBreakpoint?: number;
  /** Column threshold for medium mode (2-column). @default DEFAULT_MEDIUM_BREAKPOINT */
  readonly mediumBreakpoint?: number;
  /** Column threshold for compact mode (minimal chrome). @default DEFAULT_COMPACT_BREAKPOINT */
  readonly compactBreakpoint?: number;
  /** Column threshold for micro mode (absolute minimum). @default DEFAULT_MICRO_BREAKPOINT */
  readonly microBreakpoint?: number;
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
  /** Left dock (present in wide mode when visible). @deprecated Use bentoGrid instead. */
  readonly leftDock?: WorkspaceDockLayout;
  /** Right dock (present in wide/medium mode when visible). @deprecated Use bentoGrid instead. */
  readonly rightDock?: WorkspaceDockLayout;
  readonly dockGap: number;
  readonly shellInsetX: number;
  readonly shellInsetY: number;
  /** Bento grid layout (preferred over leftDock/rightDock when present). */
  readonly bentoGrid?: BentoGridLayout;
}

// ---------------------------------------------------------------------------
// Bento Grid Types
// ---------------------------------------------------------------------------

export interface BentoGridCell {
  readonly id: string;
  readonly col: number;
  readonly row: number;
  readonly colSpan: number;
  readonly rowSpan: number;
  readonly priority: number;
  /** Computed pixel rect for this cell (includes gap offset). */
  readonly rect: RendererRect;
  /** Whether this cell currently has focus. */
  readonly focused: boolean;
}

export interface BentoGridLayout {
  readonly columns: number;
  readonly rows: number;
  readonly cells: BentoGridCell[];
  readonly gap: number;
  /** The viewport area the grid occupies. */
  readonly area: RendererRect;
}

export interface BentoPanelSpec {
  readonly id: string;
  readonly colSpan: number;
  readonly rowSpan: number;
  readonly priority: number;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

export const DEFAULT_LEFT_DOCK_WIDTH = 42;
export const DEFAULT_RIGHT_DOCK_WIDTH = 52;
export const DEFAULT_CENTER_MIN_WIDTH = 60;
export const DEFAULT_ULTRAWIDE_BREAKPOINT = 220;
export const DEFAULT_WIDE_BREAKPOINT = 140;
export const DEFAULT_MEDIUM_BREAKPOINT = 120;
export const DEFAULT_COMPACT_BREAKPOINT = 80;
export const DEFAULT_MICRO_BREAKPOINT = 50;
export const DEFAULT_DOCK_GAP = 2;
export const DEFAULT_SHELL_INSET_X = 2;
export const DEFAULT_SHELL_INSET_Y = 1;
export const DOCK_WIDTH_MIN = 24;
export const DOCK_WIDTH_MAX = 80;

/** Ultrawide mode: slightly wider docks, but keep the hero center dominant. */
export const ULTRAWIDE_LEFT_DOCK_WIDTH = 48;
export const ULTRAWIDE_RIGHT_DOCK_WIDTH = 56;
export const ULTRAWIDE_DOCK_GAP = 2;
export const ULTRAWIDE_SHELL_INSET_X = 2;

// ---------------------------------------------------------------------------
// Implementation
// ---------------------------------------------------------------------------

function insetShellRect(
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
 * - **ultrawide** (>= ultrawideBreakpoint): expanded 3-column with wider docks and breathing room
 * - **wide** (>= wideBreakpoint): `[left-dock | center | right-dock]`
 * - **medium** (>= mediumBreakpoint): `[center | right-dock]`
 * - **narrow** (>= compactBreakpoint): `[center]` only (legacy vertical stack)
 * - **compact** (>= microBreakpoint): minimal chrome, zero inset
 * - **micro** (< microBreakpoint): absolute minimum viable layout
 */
export function measureWorkspaceLayout(options: WorkspaceLayoutOptions): WorkspaceLayoutResult {
  const viewport = options.viewport;
  const cols = viewport.width;

  const wideBreakpoint = options.wideBreakpoint ?? DEFAULT_WIDE_BREAKPOINT;
  const mediumBreakpoint = options.mediumBreakpoint ?? DEFAULT_MEDIUM_BREAKPOINT;
  const ultrawideBreakpoint = options.ultrawideBreakpoint ?? DEFAULT_ULTRAWIDE_BREAKPOINT;
  const compactBreakpoint = options.compactBreakpoint ?? DEFAULT_COMPACT_BREAKPOINT;
  const microBreakpoint = options.microBreakpoint ?? DEFAULT_MICRO_BREAKPOINT;

  // Determine layout mode from viewport width (terminal size)
  const mode = resolveLayoutMode(cols, ultrawideBreakpoint, wideBreakpoint, mediumBreakpoint, compactBreakpoint, microBreakpoint);

  // Adaptive insets: zero for compact/micro, reduced for narrow
  const shellInsetX = mode === 'compact' || mode === 'micro'
    ? 0
    : mode === 'narrow'
      ? Math.min(1, options.shellInsetX ?? DEFAULT_SHELL_INSET_X)
      : mode === 'ultrawide'
        ? (options.shellInsetX ?? ULTRAWIDE_SHELL_INSET_X)
        : (options.shellInsetX ?? DEFAULT_SHELL_INSET_X);
  const shellInsetY = mode === 'micro' ? 0 : (options.shellInsetY ?? DEFAULT_SHELL_INSET_Y);

  // Adaptive dock gap: wider for ultrawide
  const dockGap = mode === 'ultrawide'
    ? (options.dockGap ?? ULTRAWIDE_DOCK_GAP)
    : mode === 'compact' || mode === 'micro'
      ? 0
      : (options.dockGap ?? DEFAULT_DOCK_GAP);

  // Adaptive dock widths: wider for ultrawide. Panel managers always pass the
  // factory defaults (42/52) — treat those as "unset" so ultrawide can breathe.
  const leftDockWidth = resolveAdaptiveDockWidth(
    mode,
    options.leftDockWidth,
    DEFAULT_LEFT_DOCK_WIDTH,
    ULTRAWIDE_LEFT_DOCK_WIDTH,
  );
  const rightDockWidth = resolveAdaptiveDockWidth(
    mode,
    options.rightDockWidth,
    DEFAULT_RIGHT_DOCK_WIDTH,
    ULTRAWIDE_RIGHT_DOCK_WIDTH,
  );

  const centerMinWidth = mode === 'micro'
    ? Math.max(20, Math.floor(cols * 0.9))
    : mode === 'compact'
      ? Math.max(40, options.centerMinWidth ?? DEFAULT_CENTER_MIN_WIDTH)
      : (options.centerMinWidth ?? DEFAULT_CENTER_MIN_WIDTH);

  const leftDockVisible = options.leftDockVisible ?? true;
  const rightDockVisible = options.rightDockVisible ?? true;
  const shell = insetShellRect(viewport, shellInsetX, shellInsetY);

  const layoutMeta = { viewport, shell, dockGap, shellInsetX, shellInsetY };
  const visibility = { leftDockVisible, rightDockVisible };
  const dockWidths = { left: leftDockWidth, right: rightDockWidth };

  // Micro and compact: center only, no docks
  if (mode === 'micro' || mode === 'compact') {
    const result = { mode, ...layoutMeta, center: shell };
    return applyDrawerOverlay(result, layoutMeta, options.drawerDock, visibility, dockWidths);
  }

  if (mode === 'narrow') {
    const result = { mode, ...layoutMeta, center: shell };
    return applyDrawerOverlay(result, layoutMeta, options.drawerDock, visibility, dockWidths);
  }

  if (mode === 'medium') {
    const result = !rightDockVisible
      ? { mode, ...layoutMeta, center: shell }
      : computeTwoColumnLayout(layoutMeta, rightDockWidth, centerMinWidth, dockGap, 'right', mode);
    return applyDrawerOverlay(result, layoutMeta, options.drawerDock, visibility, dockWidths);
  }

  // Wide and ultrawide mode
  const showLeft = leftDockVisible;
  const showRight = rightDockVisible;

  if (!showLeft && !showRight) {
    return { mode, ...layoutMeta, center: shell };
  }

  if (showLeft && !showRight) {
    return computeTwoColumnLayout(layoutMeta, leftDockWidth, centerMinWidth, dockGap, 'left', mode);
  }

  if (!showLeft && showRight) {
    return computeTwoColumnLayout(layoutMeta, rightDockWidth, centerMinWidth, dockGap, 'right', mode);
  }

  // Full 3-column layout
  return computeThreeColumnLayout(
    layoutMeta,
    leftDockWidth,
    rightDockWidth,
    centerMinWidth,
    dockGap,
    mode,
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

function resolveAdaptiveDockWidth(
  mode: WorkspaceLayoutMode,
  requested: number | undefined,
  factoryDefault: number,
  ultrawideDefault: number,
): number {
  if (mode === 'ultrawide') {
    if (requested === undefined || requested === factoryDefault) {
      return ultrawideDefault;
    }
    return requested;
  }
  return requested ?? factoryDefault;
}

function resolveLayoutMode(
  cols: number,
  ultrawideBreakpoint: number,
  wideBreakpoint: number,
  mediumBreakpoint: number,
  compactBreakpoint: number,
  microBreakpoint: number,
): WorkspaceLayoutMode {
  if (cols >= ultrawideBreakpoint) return 'ultrawide';
  if (cols >= wideBreakpoint) return 'wide';
  if (cols >= mediumBreakpoint) return 'medium';
  if (cols >= compactBreakpoint) return 'narrow';
  if (cols >= microBreakpoint) return 'compact';
  return 'micro';
}

function computeTwoColumnLayout(
  meta: WorkspaceLayoutMeta,
  dockWidth: number,
  centerMinWidth: number,
  gap: number,
  dockSide: WorkspaceDockId,
  layoutMode: WorkspaceLayoutMode = 'wide',
): WorkspaceLayoutResult {
  const { shell } = meta;
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

  if (dockSide === 'left') {
    return {
      mode: layoutMode,
      ...meta,
      center: rects[1]!,
      leftDock: { id: 'left', rect: rects[0]!, width: effectiveDockWidth },
    };
  }

  return {
    mode: layoutMode,
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
  layoutMode: WorkspaceLayoutMode,
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
    return computeTwoColumnLayout(meta, rightWidth, centerMinWidth, gap, 'right', layoutMode);
  }

  return {
    mode: layoutMode,
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

// ---------------------------------------------------------------------------
// Bento Grid Layout Engine
// ---------------------------------------------------------------------------

/** Bento grid breakpoints (terminal columns → grid dimensions). */
const BENTO_BREAKPOINTS: { minCols: number; columns: number; rows: number }[] = [
  { minCols: 200, columns: 4, rows: 3 },
  { minCols: 140, columns: 3, rows: 3 },
  { minCols: 100, columns: 2, rows: 3 },
  { minCols: 60, columns: 1, rows: 6 },
];

const BENTO_GAP = 1;
const BENTO_INSET_X = 1;
const BENTO_INSET_Y = 0;

/**
 * Resolves the bento grid dimensions for a given terminal width.
 */
export function resolveBentoGridSize(cols: number): { columns: number; rows: number } {
  for (const bp of BENTO_BREAKPOINTS) {
    if (cols >= bp.minCols) return { columns: bp.columns, rows: bp.rows };
  }
  return { columns: 1, rows: 6 };
}

/**
 * Computes a bento grid layout from the viewport, panel specs, and focused panel.
 *
 * Panels are sorted by priority (descending) and placed into the grid using a
 * greedy first-fit algorithm. Larger panels (higher colSpan*rowSpan) are placed
 * first to avoid fragmentation.
 *
 * Dock columns are tall and narrow — using the terminal-wide breakpoints
 * (e.g. 1×6 for width < 60) leaves empty rows and postage-stamp tiles. When the
 * viewport looks like a side dock, stack panels in one column and size rows to
 * fill the dock height.
 */
export function measureBentoGridLayout(
  viewport: RendererRect,
  panels: BentoPanelSpec[],
  focusedId: string | null,
): BentoGridLayout {
  const cols = viewport.width;
  const dockLike =
    panels.length > 0 &&
    (cols < 60 || viewport.height >= Math.max(24, Math.floor(cols * 1.5)));
  const { columns, rows } = dockLike
    ? { columns: 1, rows: Math.max(1, panels.length) }
    : resolveBentoGridSize(cols);
  // Dock stacks abut closed frames; a 1-row gap reads as a hole between Files/Git.
  const gap = dockLike ? 0 : BENTO_GAP;

  // Inset the grid area — dock stacks sit flush in the dock rect (no extra pad).
  const insetX = dockLike ? 0 : BENTO_INSET_X;
  const area: RendererRect = {
    x: viewport.x + insetX,
    y: viewport.y + BENTO_INSET_Y,
    width: Math.max(1, viewport.width - insetX * 2),
    height: Math.max(1, viewport.height - BENTO_INSET_Y * 2),
  };

  // Tall narrow docks with exactly two panels: Git-biased vertical stack in
  // dock order (not priority-sorted), matching placeDockPanels.
  if (dockLike && panels.length === 2) {
    const h0 = Math.max(3, Math.floor(area.height * 0.45));
    const h1 = Math.max(3, area.height - h0);
    const cells: BentoGridCell[] = [
      {
        id: panels[0]!.id,
        col: 0,
        row: 0,
        colSpan: 1,
        rowSpan: 1,
        rect: { x: area.x, y: area.y, width: area.width, height: h0 },
        focused: panels[0]!.id === focusedId,
        priority: panels[0]!.priority,
      },
      {
        id: panels[1]!.id,
        col: 0,
        row: 1,
        colSpan: 1,
        rowSpan: 1,
        rect: { x: area.x, y: area.y + h0, width: area.width, height: h1 },
        focused: panels[1]!.id === focusedId,
        priority: panels[1]!.priority,
      },
    ];
    return { columns: 1, rows: 2, cells, gap: 0, area };
  }

  // Sort panels: higher priority first, then larger area first
  const sorted = [...panels].sort((a, b) => {
    if (b.priority !== a.priority) return b.priority - a.priority;
    return (b.colSpan * b.rowSpan) - (a.colSpan * a.rowSpan);
  });

  // Occupancy grid
  const occupied: boolean[][] = Array.from({ length: rows }, () =>
    Array.from({ length: columns }, () => false),
  );

  const cells: BentoGridCell[] = [];

  // Cell dimensions
  const cellWidth = Math.floor((area.width - gap * (columns - 1)) / columns);
  const cellHeight = Math.floor((area.height - gap * (rows - 1)) / rows);

  for (const panel of sorted) {
    // Clamp spans to grid dimensions
    const colSpan = Math.min(panel.colSpan, columns);
    const rowSpan = Math.min(panel.rowSpan, rows);

    const placement = findPlacement(occupied, columns, rows, colSpan, rowSpan);
    if (placement === null) {
      // Try smaller footprint (1x1) as fallback
      const fallback = findPlacement(occupied, columns, rows, 1, 1);
      if (fallback === null) continue; // Grid full, skip panel
      markOccupied(occupied, fallback.col, fallback.row, 1, 1);
      cells.push(buildCell(panel, fallback.col, fallback.row, 1, 1, area, cellWidth, cellHeight, gap, focusedId));
    } else {
      markOccupied(occupied, placement.col, placement.row, colSpan, rowSpan);
      cells.push(buildCell(panel, placement.col, placement.row, colSpan, rowSpan, area, cellWidth, cellHeight, gap, focusedId));
    }
  }

  return { columns, rows, cells, gap, area };
}

function findPlacement(
  occupied: boolean[][],
  columns: number,
  rows: number,
  colSpan: number,
  rowSpan: number,
): { col: number; row: number } | null {
  for (let row = 0; row <= rows - rowSpan; row++) {
    for (let col = 0; col <= columns - colSpan; col++) {
      if (canPlace(occupied, col, row, colSpan, rowSpan)) {
        return { col, row };
      }
    }
  }
  return null;
}

function canPlace(occupied: boolean[][], col: number, row: number, colSpan: number, rowSpan: number): boolean {
  for (let r = row; r < row + rowSpan; r++) {
    for (let c = col; c < col + colSpan; c++) {
      if (occupied[r]?.[c]) return false;
    }
  }
  return true;
}

function markOccupied(occupied: boolean[][], col: number, row: number, colSpan: number, rowSpan: number): void {
  for (let r = row; r < row + rowSpan; r++) {
    for (let c = col; c < col + colSpan; c++) {
      if (occupied[r]) occupied[r]![c] = true;
    }
  }
}

function buildCell(
  panel: BentoPanelSpec,
  col: number,
  row: number,
  colSpan: number,
  rowSpan: number,
  area: RendererRect,
  cellWidth: number,
  cellHeight: number,
  gap: number,
  focusedId: string | null,
): BentoGridCell {
  const x = area.x + col * (cellWidth + gap);
  const y = area.y + row * (cellHeight + gap);
  const width = cellWidth * colSpan + gap * (colSpan - 1);
  const height = cellHeight * rowSpan + gap * (rowSpan - 1);
  return {
    id: panel.id,
    col,
    row,
    colSpan,
    rowSpan,
    priority: panel.priority,
    rect: { x, y, width, height },
    focused: panel.id === focusedId,
  };
}

// ---------------------------------------------------------------------------
// Bento Grid Hit-Test
// ---------------------------------------------------------------------------

export type BentoHitResult = { cellId: string; cell: BentoGridCell } | null;

/**
 * Hit-test a bento grid: returns the cell that contains the given point.
 */
export function hitTestBentoGrid(grid: BentoGridLayout, x: number, y: number): BentoHitResult {
  for (const cell of grid.cells) {
    if (containsPoint(cell.rect, x, y)) {
      return { cellId: cell.id, cell };
    }
  }
  return null;
}
