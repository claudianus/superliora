import { RESULT_PREVIEW_LINES } from '#/tui/constant/rendering';

export const TOOL_OUTPUT_VIEWPORT_MIN_HEIGHT = RESULT_PREVIEW_LINES;
export const TOOL_OUTPUT_VIEWPORT_MAX_HEIGHT = 16;

/**
 * Max visual rows a single *expanded* tool body may contribute to the
 * transcript. Unlimited unroll of full tool outputs is the main freeze
 * path under fast wheel scroll (geometry + paint of multi-k line bodies).
 * Nested windowing still lets the user scroll the rest inside the card.
 */
export const TOOL_OUTPUT_EXPANDED_MAX_HEIGHT = 40;

export interface ToolOutputViewportState {
  readonly offset: number;
  readonly height: number;
  readonly contentRows: number;
}

export interface ToolOutputViewportProjection {
  readonly startRow: number;
  readonly endRow: number;
  readonly visibleRows: number;
  readonly overflow: boolean;
}

export interface ToolOutputViewportThumb {
  readonly startRow: number;
  readonly endRow: number;
}

function whole(value: number, fallback = 0): number {
  return Number.isFinite(value) ? Math.floor(value) : fallback;
}

function rows(value: number): number {
  return Math.max(0, whole(value));
}

function height(value: number): number {
  return Math.max(TOOL_OUTPUT_VIEWPORT_MIN_HEIGHT, whole(value, RESULT_PREVIEW_LINES));
}

/** Visible window height for a tool body (taller when expanded, always bounded). */
export function toolOutputWindowHeight(
  state: ToolOutputViewportState,
  expanded: boolean,
): number {
  if (!expanded) {
    return Math.min(state.height, Math.max(0, state.contentRows));
  }
  return Math.min(
    Math.max(state.height, TOOL_OUTPUT_EXPANDED_MAX_HEIGHT),
    Math.max(0, state.contentRows),
  );
}

export function toolOutputViewportMaxOffset(
  contentRows: number,
  viewportHeight: number,
): number {
  return Math.max(0, rows(contentRows) - Math.max(0, whole(viewportHeight)));
}

export function createToolOutputViewportState(
  initial?: Partial<ToolOutputViewportState>,
): ToolOutputViewportState {
  const nextHeight = height(initial?.height ?? RESULT_PREVIEW_LINES);
  const contentRows = rows(initial?.contentRows ?? 0);
  return {
    offset: Math.min(
      Math.max(0, whole(initial?.offset ?? 0)),
      toolOutputViewportMaxOffset(contentRows, nextHeight),
    ),
    height: nextHeight,
    contentRows,
  };
}

export function syncToolOutputViewportContent(
  state: ToolOutputViewportState,
  nextContentRows: number,
): ToolOutputViewportState {
  const contentRows = rows(nextContentRows);
  const previousMaxOffset = toolOutputViewportMaxOffset(state.contentRows, state.height);
  const nextMaxOffset = toolOutputViewportMaxOffset(contentRows, state.height);
  const wasFollowingEnd = state.contentRows > 0 && state.offset >= previousMaxOffset;
  return {
    ...state,
    contentRows,
    offset: wasFollowingEnd ? nextMaxOffset : Math.min(Math.max(0, state.offset), nextMaxOffset),
  };
}

export function scrollToolOutputViewport(
  state: ToolOutputViewportState,
  deltaRows: number,
  expanded = false,
): ToolOutputViewportState {
  const windowHeight = toolOutputWindowHeight(state, expanded);
  const maxOffset = toolOutputViewportMaxOffset(state.contentRows, windowHeight);
  const offset = Math.min(maxOffset, Math.max(0, state.offset + whole(deltaRows)));
  return offset === state.offset ? state : { ...state, offset };
}

export function resizeToolOutputViewport(
  state: ToolOutputViewportState,
  requestedHeight: number,
  maxHeight: number,
): ToolOutputViewportState {
  const boundedMax = Math.max(TOOL_OUTPUT_VIEWPORT_MIN_HEIGHT, height(maxHeight));
  const nextHeight = Math.min(boundedMax, height(requestedHeight));
  const wasFollowingEnd =
    state.offset >= toolOutputViewportMaxOffset(state.contentRows, state.height);
  const nextMaxOffset = toolOutputViewportMaxOffset(state.contentRows, nextHeight);
  const offset = wasFollowingEnd ? nextMaxOffset : Math.min(state.offset, nextMaxOffset);
  if (nextHeight === state.height && offset === state.offset) return state;
  return { ...state, height: nextHeight, offset };
}

export function toolOutputViewportMaxHeight(transcriptVisibleRows: number): number {
  return Math.max(
    TOOL_OUTPUT_VIEWPORT_MIN_HEIGHT,
    Math.min(TOOL_OUTPUT_VIEWPORT_MAX_HEIGHT, Math.floor(rows(transcriptVisibleRows) / 2)),
  );
}

/**
 * Project the nested tool-output window.
 *
 * Expanded cards stay windowed (taller budget) — never dump unlimited
 * content rows into the transcript tree. That unbounded path froze the TUI
 * under fast scroll with many expanded tools.
 */
export function projectToolOutputViewport(
  state: ToolOutputViewportState,
  expanded: boolean,
): ToolOutputViewportProjection {
  const windowHeight = toolOutputWindowHeight(state, expanded);
  if (windowHeight <= 0 || state.contentRows <= 0) {
    return { startRow: 0, endRow: 0, visibleRows: 0, overflow: false };
  }
  const maxOffset = toolOutputViewportMaxOffset(state.contentRows, windowHeight);
  const startRow = Math.min(Math.max(0, state.offset), maxOffset);
  return {
    startRow,
    endRow: Math.min(state.contentRows, startRow + windowHeight),
    visibleRows: windowHeight,
    overflow: state.contentRows > windowHeight,
  };
}

export function toolOutputViewportThumb(
  state: ToolOutputViewportState,
  trackRows: number,
  expanded = false,
): ToolOutputViewportThumb | undefined {
  const track = rows(trackRows);
  const windowHeight = toolOutputWindowHeight(state, expanded);
  if (track === 0 || state.contentRows <= windowHeight) return undefined;
  const thumbRows = Math.max(
    1,
    Math.min(track, Math.floor((track * windowHeight) / state.contentRows)),
  );
  const travel = track - thumbRows;
  const maxOffset = toolOutputViewportMaxOffset(state.contentRows, windowHeight);
  const startRow = maxOffset === 0 ? 0 : Math.round((travel * state.offset) / maxOffset);
  return { startRow, endRow: startRow + thumbRows };
}
