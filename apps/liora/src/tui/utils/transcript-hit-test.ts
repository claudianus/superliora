import {
  measureRendererRegions,
  visibleWidth,
  type NativeInputMouseEvent,
  type RendererRect,
  type RendererRegionLine,
} from '#/tui/renderer';

import { CHROME_GUTTER } from '../constant/rendering';
import type { TUIState } from '../tui-state';
import {
  plainTextFromRegionLine,
  type TranscriptSelectionPoint,
} from './transcript-selection-model';

export interface TranscriptHitTestContext {
  readonly rect: RendererRect;
  readonly viewportStart: number;
  readonly visibleRows: number;
  readonly leftPad: number;
  readonly rightPad: number;
  readonly contentWidth: number;
  readonly visibleLines: readonly RendererRegionLine[];
}

export function resolveTranscriptHitTestContext(
  state: TUIState,
  width = state.terminal.columns,
  height = state.terminal.rows,
): TranscriptHitTestContext | undefined {
  const frameWidth = normalizeFrameSize(width);
  const frameHeight = normalizeFrameSize(height);
  const activityRows = state.activityContainer.render(frameWidth).length;
  const todoRows = state.todoPanelContainer.render(frameWidth).length;
  const queueRows = state.queueContainer.render(frameWidth).length;
  const btwRows = state.btwPanelContainer.render(frameWidth).length;
  const editorRows = state.editorContainer.render(frameWidth).length;
  const footerRows = state.footerContainer.render(frameWidth).length;
  const layout = measureRendererRegions({
    terminalRows: frameHeight,
    terminalColumns: frameWidth,
    heights: {
      activity: activityRows,
      todo: todoRows,
      queue: queueRows,
      btw: btwRows,
      editor: editorRows,
      footer: footerRows,
    },
  });
  const rect = layout.regions.find((region) => region.id === 'transcript')?.rect;
  if (rect === undefined) return undefined;

  const leftPad = CHROME_GUTTER;
  const rightPad = CHROME_GUTTER;
  const visibleRows = layout.transcriptRows;
  const visibleLines = state.transcriptContainer.renderWithVisibleRegionLines(
    frameWidth,
    visibleRows,
  );
  const contentWidth = Math.max(1, frameWidth - leftPad - rightPad);

  return {
    rect,
    viewportStart: state.transcriptViewport.start(),
    visibleRows,
    leftPad,
    rightPad,
    contentWidth,
    visibleLines,
  };
}

export function getTUIStateNativeTranscriptRect(
  state: TUIState,
  width = state.terminal.columns,
  height = state.terminal.rows,
): RendererRect | undefined {
  return resolveTranscriptHitTestContext(state, width, height)?.rect;
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
