/**
 * Pure 2D grid navigation for list pickers (Settings, Command Hub).
 * Index is flat over the visible filtered items; section headers are
 * not part of the grid (they are full-width chrome above cells).
 */

export interface GridNavState {
  readonly index: number;
  readonly count: number;
  readonly columns: number;
}

export function clampGridIndex(index: number, count: number): number {
  if (count <= 0) return 0;
  return Math.max(0, Math.min(count - 1, index));
}

export function resolveGridColumns(opts: {
  readonly width: number;
  readonly itemCount: number;
  readonly minCellWidth?: number;
  readonly maxColumns?: number;
  /** Force list mode when false. */
  readonly preferGrid?: boolean;
}): number {
  if (opts.preferGrid === false) return 1;
  if (opts.itemCount <= 1) return 1;
  const minCell = opts.minCellWidth ?? 28;
  const maxCols = opts.maxColumns ?? 3;
  if (opts.width < minCell * 2) return 1;
  const byWidth = Math.max(1, Math.floor(opts.width / minCell));
  const byCount = Math.min(maxCols, opts.itemCount);
  return Math.max(1, Math.min(byWidth, byCount, maxCols));
}

export function gridMoveUp(state: GridNavState): number {
  if (state.count <= 0) return 0;
  const cols = Math.max(1, state.columns);
  const next = state.index - cols;
  return next < 0 ? state.index : next;
}

export function gridMoveDown(state: GridNavState): number {
  if (state.count <= 0) return 0;
  const cols = Math.max(1, state.columns);
  const next = state.index + cols;
  return next >= state.count ? state.index : next;
}

export function gridMoveLeft(state: GridNavState): number {
  if (state.count <= 0) return 0;
  const cols = Math.max(1, state.columns);
  if (cols <= 1) return state.index;
  const col = state.index % cols;
  if (col === 0) return state.index;
  return state.index - 1;
}

export function gridMoveRight(state: GridNavState): number {
  if (state.count <= 0) return 0;
  const cols = Math.max(1, state.columns);
  if (cols <= 1) return state.index;
  const col = state.index % cols;
  if (col >= cols - 1) return state.index;
  const next = state.index + 1;
  return next >= state.count ? state.index : next;
}

export function gridRowCol(
  index: number,
  columns: number,
): { readonly row: number; readonly col: number } {
  const cols = Math.max(1, columns);
  return { row: Math.floor(index / cols), col: index % cols };
}
