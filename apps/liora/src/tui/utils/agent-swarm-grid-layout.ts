import { visibleWidth } from '#/tui/renderer';

const TEXT_CELL_PREFERRED_WIDTH = 30;
const CELL_GAP = '  ';
const TEXT_BRAILLE_BAR_MIN_WIDTH = 6;
const BRAILLE_BAR_MAX_WIDTH = 8;
const PHASE_LABEL_WIDTH = 'Completed'.length;
const MIN_LABEL_WIDTH = PHASE_LABEL_WIDTH;
const COMPACT_TERMINAL_MARK_WIDTH = 1;
const AGENT_SWARM_NON_GRID_LINES = 14;
/** Extra transcript rows reserved for the UltraSwarm feed box (border + feed + padding). */
export const AGENT_SWARM_OPS_FEED_LINE_BUDGET = 10;

export interface AgentSwarmGridLayoutInput {
  readonly width: number;
  readonly height: number;
  readonly count: number;
}

export interface AgentSwarmGridLayout {
  readonly renderText: boolean;
  readonly barCells: number;
  readonly columns: number;
  readonly rows: number;
  readonly cellWidth: number;
  readonly columnGap: number;
  readonly leftPadding: number;
}

function textGridLayout(
  columns: number,
  rows: number,
  cellWidth: number,
  gapWidth: number,
  idWidth: number,
): AgentSwarmGridLayout {
  return {
    renderText: true,
    barCells: barCellsForTextCellWidth(cellWidth, idWidth),
    columns,
    rows,
    cellWidth,
    columnGap: gapWidth,
    leftPadding: 0,
  };
}

export function calculateAgentSwarmGridLayout(
  input: AgentSwarmGridLayoutInput,
): AgentSwarmGridLayout {
  const count = Math.max(0, Math.floor(input.count));
  const width = Math.max(0, Math.floor(input.width));
  const height = Math.max(0, Math.floor(input.height));
  const idWidth = agentSwarmGridIdWidth(count);

  if (count === 0) {
    return {
      renderText: true,
      barCells: 1,
      columns: 0,
      rows: 0,
      cellWidth: 0,
      columnGap: 0,
      leftPadding: 0,
    };
  }

  const textGapWidth = visibleWidth(CELL_GAP);
  const compactGapWidth = textGapWidth;
  const textColumns = columnsForCellWidth(width, count, TEXT_CELL_PREFERRED_WIDTH, textGapWidth);
  const textRows = rowsForColumns(count, textColumns);
  const textCellWidth = gridCellWidth(width, textColumns, textGapWidth);
  if (textRows <= height && textCellWidth >= minTextCellWidth(idWidth)) {
    return textGridLayout(textColumns, textRows, textCellWidth, textGapWidth, idWidth);
  }
  const targetTextColumns = height <= 0 ? count : Math.min(count, Math.ceil(count / height));
  const targetTextCellWidth = gridCellWidth(width, targetTextColumns, textGapWidth);
  const targetTextRows = rowsForColumns(count, targetTextColumns);
  if (height > 0 && targetTextRows <= height && targetTextCellWidth >= minTextCellWidth(idWidth)) {
    return textGridLayout(targetTextColumns, targetTextRows, targetTextCellWidth, textGapWidth, idWidth);
  }

  const compactColumns = compactColumnsForLayout(width, count, height, idWidth, compactGapWidth);
  const compactCellWidthBudget = gridCellWidth(width, compactColumns, compactGapWidth);
  const compactBarCells = compactBarCellsForCellWidth(compactCellWidthBudget, idWidth);
  const compactActualCellWidth = compactCellWidth(idWidth, compactBarCells);
  return {
    renderText: false,
    barCells: compactBarCells,
    columns: compactColumns,
    rows: rowsForColumns(count, compactColumns),
    cellWidth: compactActualCellWidth,
    columnGap: compactGapWidth,
    leftPadding: 0,
  };
}

export function agentSwarmGridHeightForTerminalRows(
  rows: number | undefined,
  followingRows = 0,
  options?: { readonly opsFeed?: boolean },
): number | undefined {
  if (rows === undefined || !Number.isFinite(rows)) return undefined;
  const rowsAfterSwarm = Number.isFinite(followingRows)
    ? Math.max(0, Math.floor(followingRows))
    : 0;
  const nonGridLines =
    AGENT_SWARM_NON_GRID_LINES +
    (options?.opsFeed === true ? AGENT_SWARM_OPS_FEED_LINE_BUDGET : 0);
  return Math.max(0, Math.floor(rows) - rowsAfterSwarm - nonGridLines);
}

function agentSwarmGridIdWidth(count: number): number {
  return Math.max(3, String(Math.max(1, count)).length);
}

function columnsForCellWidth(
  width: number,
  count: number,
  cellWidth: number,
  gapWidth: number,
): number {
  if (count <= 1) return count <= 0 ? 0 : 1;
  const columns = Math.floor((width + gapWidth) / (Math.max(1, cellWidth) + gapWidth));
  return Math.max(1, Math.min(count, columns));
}

function rowsForColumns(count: number, columns: number): number {
  if (count <= 0) return 0;
  return Math.ceil(count / Math.max(1, columns));
}

function gridCellWidth(width: number, columns: number, gapWidth: number): number {
  if (columns <= 0) return 0;
  return Math.max(
    1,
    Math.floor((width - gapWidth * Math.max(0, columns - 1)) / columns),
  );
}

function minTextCellWidth(idWidth: number): number {
  return idWidth + TEXT_BRAILLE_BAR_MIN_WIDTH + 4 + MIN_LABEL_WIDTH;
}

function barCellsForTextCellWidth(cellWidth: number, idWidth: number): number {
  const fixedWidth = idWidth + 1 + 2 + 1 + MIN_LABEL_WIDTH;
  const availableForBar = cellWidth - fixedWidth;
  return availableForBar >= TEXT_BRAILLE_BAR_MIN_WIDTH
    ? Math.min(BRAILLE_BAR_MAX_WIDTH, availableForBar)
    : TEXT_BRAILLE_BAR_MIN_WIDTH;
}

function compactColumnsForLayout(
  width: number,
  count: number,
  height: number,
  idWidth: number,
  gapWidth: number,
): number {
  const maxColumns = columnsForCellWidth(width, count, compactCellWidth(idWidth, 1), gapWidth);
  if (height <= 0) return maxColumns;
  const targetColumns = Math.min(count, Math.ceil(count / height));
  return Math.max(1, Math.min(targetColumns, maxColumns));
}

function compactBarCellsForCellWidth(cellWidth: number, idWidth: number): number {
  return Math.max(
    1,
    cellWidth - compactFixedWidth(idWidth) - COMPACT_TERMINAL_MARK_WIDTH,
  );
}

function compactCellWidth(idWidth: number, barCells: number): number {
  return compactFixedWidth(idWidth) + Math.max(1, barCells) + COMPACT_TERMINAL_MARK_WIDTH;
}

function compactFixedWidth(idWidth: number): number {
  return idWidth + 1 + 2;
}
