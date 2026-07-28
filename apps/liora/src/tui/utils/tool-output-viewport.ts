import { RESULT_PREVIEW_LINES } from '#/tui/constant/rendering';

export const TOOL_OUTPUT_VIEWPORT_MIN_HEIGHT = RESULT_PREVIEW_LINES;
export const TOOL_OUTPUT_VIEWPORT_MAX_HEIGHT = 16;

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

export function toolOutputViewportMaxOffset(contentRows: number, viewportHeight: number): number {
  return Math.max(0, rows(contentRows) - height(viewportHeight));
}

export function createToolOutputViewportState(
  initial?: Partial<ToolOutputViewportState>,
): ToolOutputViewportState {
  const nextHeight = height(initial?.height ?? RESULT_PREVIEW_LINES);
  const contentRows = rows(initial?.contentRows ?? 0);
  return {
    offset: Math.min(Math.max(0, whole(initial?.offset ?? 0)), toolOutputViewportMaxOffset(contentRows, nextHeight)),
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
): ToolOutputViewportState {
  const maxOffset = toolOutputViewportMaxOffset(state.contentRows, state.height);
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
  const wasFollowingEnd = state.offset >= toolOutputViewportMaxOffset(state.contentRows, state.height);
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

export function projectToolOutputViewport(
  state: ToolOutputViewportState,
  expanded: boolean,
): ToolOutputViewportProjection {
  if (expanded) {
    return {
      startRow: 0,
      endRow: state.contentRows,
      visibleRows: state.contentRows,
      overflow: false,
    };
  }
  const visibleRows = Math.min(state.height, state.contentRows);
  return {
    startRow: state.offset,
    endRow: Math.min(state.contentRows, state.offset + visibleRows),
    visibleRows,
    overflow: state.contentRows > state.height,
  };
}

export function toolOutputViewportThumb(
  state: ToolOutputViewportState,
  trackRows: number,
): ToolOutputViewportThumb | undefined {
  const track = rows(trackRows);
  if (track === 0 || state.contentRows <= state.height) return undefined;
  const thumbRows = Math.max(1, Math.min(track, Math.floor((track * state.height) / state.contentRows)));
  const travel = track - thumbRows;
  const maxOffset = toolOutputViewportMaxOffset(state.contentRows, state.height);
  const startRow = maxOffset === 0 ? 0 : Math.round((travel * state.offset) / maxOffset);
  return { startRow, endRow: startRow + thumbRows };
}
