import {
  visibleWidth,
  type NativeInputMouseEvent,
  type RendererRect,
  type RendererRegionLine,
} from '#/tui/renderer';

import { CHROME_GUTTER } from '../../constant/rendering';
import type { TUIState } from '../../tui-state';
import { planTUINativeStage } from '#/tui/features/native-layout/native-stage-plan';
import {
  missionFallbackActive,
  missionWorkspaceCenterRect,
} from '#/tui/features/mission-control/dock';
import {
  plainTextFromRegionLine,
  type TranscriptSelectionPoint,
} from '#/tui/features/transcript/transcript-selection-model';

export interface TranscriptLayoutContext {
  readonly rect: RendererRect;
  readonly viewportStart: number;
  readonly visibleRows: number;
  readonly stageWidth: number;
  readonly leftPad: number;
  readonly rightPad: number;
  readonly contentWidth: number;
}

export interface TranscriptHitTestContext extends TranscriptLayoutContext {
  readonly visibleLines: readonly RendererRegionLine[];
}

/**
 * Bust the transcript/todo hit-test layout cache. Call when chrome that
 * affects region geometry mounts, unmounts, or changes height (Mission
 * Control fallback, Todo board). Without this, mouse clicks keep using
 * stale rects after a panel appears mid-session.
 */
export function invalidateTranscriptHitTestCache(state: TUIState): void {
  state.cachedTranscriptRect = undefined;
  state.cachedTranscriptVisibleRows = undefined;
  state.cachedTranscriptStageWidth = undefined;
  state.cachedTranscriptColumns = undefined;
  state.cachedTranscriptRows = undefined;
  state.cachedTranscriptLineCount = undefined;
  state.cachedHitTestChromeSig = undefined;
  state.cachedTodoRect = undefined;
}

/** Cheap chrome signature — mission/todo mount + content counts drive region height. */
export function hitTestChromeSignature(state: TUIState): string {
  const view = state.missionControlPanel.currentView;
  const missionMounted = missionFallbackActive(state, state.terminal.columns) ? 1 : 0;
  const missionRows =
    view.snapshot.workers.length + view.snapshot.ops.length + (view.jobs?.jobs.length ?? 0);
  const todoEmpty = state.todoPanel.isEmpty() ? 1 : 0;
  return `m${String(missionMounted)}r${String(missionRows)}t${String(todoEmpty)}`;
}

export function resolveTranscriptLayoutContext(
  state: TUIState,
  width = state.terminal.columns,
  height = state.terminal.rows,
): TranscriptLayoutContext | undefined {
  const frameWidth = normalizeFrameSize(width);
  const frameHeight = normalizeFrameSize(height);
  // Cheap editor line-count probe for cache invalidation (same key as the
  // editor rect cache in getTUIStateNativeEditorRect).
  const editorLineCount = state.editor.getNativeLayoutRowCount?.(frameWidth) ?? -1;
  const chromeSig = hitTestChromeSignature(state);
  let rect: RendererRect | undefined;
  let visibleRows: number;
  let stageWidth: number;
  // Fast path: reuse cached transcript layout when the key matches.
  if (
    state.cachedTranscriptRect !== undefined &&
    state.cachedTranscriptColumns === frameWidth &&
    state.cachedTranscriptRows === frameHeight &&
    state.cachedTranscriptLineCount === editorLineCount &&
    state.cachedHitTestChromeSig === chromeSig
  ) {
    rect = state.cachedTranscriptRect;
    visibleRows = state.cachedTranscriptVisibleRows ?? 0;
    stageWidth = state.cachedTranscriptStageWidth ?? frameWidth;
  } else {
    // Slow path: full layout computation. The Mission Control dock shrinks
    // the stage via workspaceCenter — hit tests must agree with the paint.
    const plan = planTUINativeStage(state, frameWidth, frameHeight, {
      workspaceCenter: missionWorkspaceCenterRect(state, frameWidth, frameHeight),
      resolveEditorFallbackLines: (contentWidth) => state.editorContainer.render(contentWidth),
      resolveEditorRows: ({ editorLineCount: elc, contentHeight, fixedRowsWithoutEditor }) =>
        Math.min(
          elc,
          Math.max(1, contentHeight - fixedRowsWithoutEditor - 1),
        ),
    });
    rect = plan.layout.regions.find((region) => region.id === 'transcript')?.rect;
    visibleRows = plan.layout.transcriptRows;
    stageWidth = plan.stage.stage.width;
    // Cache for subsequent calls.
    state.cachedTranscriptRect = rect;
    state.cachedTranscriptVisibleRows = visibleRows;
    state.cachedTranscriptStageWidth = stageWidth;
    state.cachedTranscriptColumns = frameWidth;
    state.cachedTranscriptRows = frameHeight;
    state.cachedTranscriptLineCount = editorLineCount;
    state.cachedHitTestChromeSig = chromeSig;
    state.cachedTodoRect = plan.layout.regions.find((region) => region.id === 'todo')?.rect;
  }
  if (rect === undefined) return undefined;

  const leftPad = CHROME_GUTTER;
  const rightPad = CHROME_GUTTER;
  return {
    rect,
    viewportStart: state.transcriptViewport.start(),
    visibleRows,
    stageWidth,
    leftPad,
    rightPad,
    contentWidth: Math.max(1, stageWidth - leftPad - rightPad),
  };
}

export function resolveTranscriptHitTestContext(
  state: TUIState,
  width = state.terminal.columns,
  height = state.terminal.rows,
): TranscriptHitTestContext | undefined {
  const layout = resolveTranscriptLayoutContext(state, width, height);
  if (layout === undefined) return undefined;
  return {
    ...layout,
    visibleLines: state.transcriptContainer.renderWithVisibleRegionLines(
      layout.stageWidth,
      layout.visibleRows,
    ),
  };
}

export function getTUIStateNativeTranscriptRect(
  state: TUIState,
  width = state.terminal.columns,
  height = state.terminal.rows,
): RendererRect | undefined {
  return resolveTranscriptHitTestContext(state, width, height)?.rect;
}

/**
 * Rect of the todo board region, reused from the transcript hit-test cache
 * (same stage plan, same invalidation key). Wheel events landing inside it
 * scroll the board instead of the transcript.
 */
export function getTUIStateNativeTodoRect(
  state: TUIState,
  width = state.terminal.columns,
  height = state.terminal.rows,
): RendererRect | undefined {
  resolveTranscriptHitTestContext(state, width, height);
  return state.cachedTodoRect;
}

export function transcriptPointForMouse(
  event: NativeInputMouseEvent,
  context: TranscriptHitTestContext,
): TranscriptSelectionPoint | undefined {
  const { rect, leftPad, rightPad, viewportStart, visibleRows, visibleLines, contentWidth } =
    context;
  if (event.x < rect.x || event.x >= rect.x + rect.width) return undefined;
  if (event.y < rect.y || event.y >= rect.y + rect.height) return undefined;

  const localX = event.x - rect.x;
  const localY = event.y - rect.y;
  if (localX < leftPad || localX >= rect.width - rightPad) return undefined;
  if (localY < 0 || localY >= visibleRows) return undefined;

  const globalLine = viewportStart + localY;
  const contentX = localX - leftPad;
  const line = visibleLines[localY];
  if (line === undefined) return undefined;

  const col = columnForContentX(line, contentWidth, contentX);
  return { globalLine, col };
}

export function isMouseInTranscriptRect(
  event: NativeInputMouseEvent,
  rect: RendererRect | undefined,
): boolean {
  if (rect === undefined) return false;
  return (
    event.x >= rect.x
    && event.x < rect.x + rect.width
    && event.y >= rect.y
    && event.y < rect.y + rect.height
  );
}

function columnForContentX(
  line: RendererRegionLine,
  contentWidth: number,
  contentX: number,
): number {
  const clampedX = Math.max(0, Math.min(contentWidth, Math.floor(contentX)));
  if (typeof line === 'string') {
    return Math.min(clampedX, visibleWidth(line));
  }

  let col = 0;
  for (const cell of line) {
    const width = Math.max(1, visibleWidth(cell.char));
    if (clampedX < col + width) return clampedX;
    col += width;
  }
  const lineWidth = visibleWidth(plainTextFromRegionLine(line));
  return Math.min(clampedX, lineWidth);
}

function normalizeFrameSize(value: number): number {
  if (!Number.isFinite(value) || value <= 0) return 80;
  return Math.floor(value);
}
