import type { RendererRect } from '../render/compositor';

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

  // Tall narrow docks with exactly two panels: Files-biased vertical stack in
  // dock order (not priority-sorted), matching placeDockPanels.
  if (dockLike && panels.length === 2) {
    const h0 = Math.max(3, Math.floor(area.height * 0.58));
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
  const sorted = [...panels].toSorted((a, b) => {
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
    if (bentoContainsPoint(cell.rect, x, y)) {
      return { cellId: cell.id, cell };
    }
  }
  return null;
}
