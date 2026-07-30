/**
 * Virtual-scroll helpers for the collapsed todo board: terminal row budget,
 * viewport sizing, and scroll-offset math. Pure functions only — the
 * coordinator owns the live offset.
 */
import type { TodoBoardScrollAction } from './todo-panel-types';

/**
 * Virtual-scroll budget. The collapsed board windows its lanes inside a
 * third of the terminal (the same share the BTW panel takes) once chrome is
 * reserved: rounded frame top/bottom, board meta, lane header, lane
 * divider, and the scroll indicator line. The clamp keeps tiny terminals
 * near the legacy 5-row cap and huge terminals from turning the board into
 * a full-screen takeover.
 */
export const BOARD_VIEWPORT_CHROME_ROWS = 6;
export const BOARD_MIN_VIEWPORT_ROWS = 4;
export const BOARD_MAX_VIEWPORT_ROWS = 12;

/**
 * Board rows the stage can lend the panel, or undefined when the host
 * gave no terminal height (legacy callers). A third of the terminal —
 * the BTW panel's share — minus chrome, clamped to a calm range.
 */
export function computeBoardRowBudget(terminalRows?: () => number): number | undefined {
  const rows = terminalRows?.();
  if (rows === undefined || !Number.isFinite(rows) || rows <= 0) return undefined;
  const budget = Math.floor(rows / 3) - BOARD_VIEWPORT_CHROME_ROWS;
  return Math.min(BOARD_MAX_VIEWPORT_ROWS, Math.max(BOARD_MIN_VIEWPORT_ROWS, budget));
}

/** Rows the collapsed board may paint; undefined keeps the legacy selection. */
export function computeViewportBoardRows(
  total: number,
  budget: number | undefined,
): number | undefined {
  return budget === undefined ? undefined : Math.min(total, budget);
}

export function nextScrollOffset(
  currentOffset: number,
  action: TodoBoardScrollAction,
  viewport: number,
): number {
  switch (action) {
    case 'line-up':
      return currentOffset - 1;
    case 'line-down':
      return currentOffset + 1;
    case 'page-up':
      return currentOffset - Math.max(1, viewport - 1);
    case 'page-down':
      return currentOffset + Math.max(1, viewport - 1);
    case 'top':
      return 0;
    case 'bottom':
      return Number.MAX_SAFE_INTEGER;
  }
}

export function clampScrollOffset(offset: number, total: number, viewport: number): number {
  const maxOffset = total - viewport;
  return Math.min(maxOffset, Math.max(0, offset));
}
