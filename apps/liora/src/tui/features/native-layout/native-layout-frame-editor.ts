import {
  measureRendererEditorSurfaceLayout,
  measureRendererEditorSurfaceNaturalRows,
  projectRendererCursorMarkerLines,
  projectRendererEditorSurfaceCursor,
  regionLinePresentKey,
  RENDERER_EDITOR_FRAME_TEXT_INPUT_GEOMETRY,
  RENDERER_EDITOR_SHELL_MODE_LABEL,
  rendererEditorContentHeight,
  rendererEditorContentWidth,
  renderRendererEditorSurface,
  resolveRendererEditorSurfaceStyles,
  type RendererCellStyle,
  type RendererCursorState,
  type RendererRect,
  type RendererRegionLine,
} from '#/tui/renderer';
import { currentTheme } from '#/tui/theme';
import { feedbackBorderGlowHex } from '#/tui/utils/render/feedback-vfx';
import { appearanceAnimationNow } from '#/tui/features/appearance/appearance-effects';

import type { TUIState } from '../../tui-state';

/**
 * Last presented editor region lines (content-hash skip).
 * Same idea as TranscriptVisibleLinePresenter: ambient ticks rebuild the
 * surface with fresh array identities even when glyphs are unchanged. Reusing
 * prior line refs keeps composition/present from flashing a blank prompt row
 * on ConPTY when letterbox/stage clear races the rewrite.
 */
let lastEditorPresent:
  | {
      readonly rectKey: string;
      readonly keys: readonly string[];
      readonly lines: readonly RendererRegionLine[];
    }
  | undefined;

/** Test helper — drop the editor present-hash cache. */
export function resetNativeEditorPresentCacheForTests(): void {
  lastEditorPresent = undefined;
}

/**
 * Minimum transcript rows the native layout must preserve when squeezing
 * space for a growing editor (autocomplete, multi-line input, etc.).
 */
export const NATIVE_LAYOUT_MIN_TRANSCRIPT_ROWS = 1;

export function nativeEditorRegionRowsForLayout(
  state: TUIState,
  editorRows: number,
  terminalRows: number,
  fixedRowsWithoutEditor: number,
  frameWidth: number,
): number {
  if (!state.editorContainer.children.includes(state.editor) || editorRows <= 0) {
    return editorRows;
  }

  const overlayLines = state.editor.getNativeOverlayLines?.(Math.floor(frameWidth)) ?? [];
  const desiredRows = state.editor.getNativeLayoutRowCount?.(Math.floor(frameWidth))
    ?? (overlayLines.length > 0
      ? measureRendererEditorSurfaceNaturalRows(overlayLines)
      : editorRows);
  // Closed box needs 3 rows; open autocomplete needs at least 4
  // (top + input + ≥1 suggestion + bottom). Capping the floor at 3 used to
  // clip slash suggestions in short terminals even when a 4th row was free.
  const minEditorRows = Math.min(
    desiredRows,
    overlayLines.length > 0 ? 4 : 3,
  );
  const availableRows = Math.max(
    0,
    Math.floor(terminalRows) - fixedRowsWithoutEditor - NATIVE_LAYOUT_MIN_TRANSCRIPT_ROWS,
  );
  return Math.min(desiredRows, Math.max(minEditorRows, availableRows));
}

export function projectNativeEditorRegion(
  state: TUIState,
  fallbackLines: readonly RendererRegionLine[],
  rect: RendererRect | undefined,
  terminalColumns: number,
  terminalRows: number,
): {
  readonly lines: readonly RendererRegionLine[];
  readonly cursor?: RendererCursorState;
} {
  if (rect === undefined || !state.editorContainer.children.includes(state.editor)) {
    return projectRendererCursorMarkerLines({
      lines: fallbackLines,
      rect,
      viewport: { x: 0, y: 0, width: terminalColumns, height: terminalRows },
    });
  }
  if (rect.width < 5 || rect.height < 3) {
    return projectRendererCursorMarkerLines({
      lines: fallbackLines,
      rect,
      viewport: { x: 0, y: 0, width: terminalColumns, height: terminalRows },
    });
  }

  const palette = currentTheme.palette;
  const isBash = state.editor.inputMode === 'bash';
  const editorStyles = resolveRendererEditorSurfaceStyles({
    commandMode: isBash,
    focused: state.editor.borderHighlighted,
    canvasBackground: currentTheme.canvasBackgroundEnabled,
    palette: {
      text: palette.text,
      textMuted: palette.textMuted,
      textStrong: palette.textStrong,
      border: palette.border,
      borderFocus: feedbackBorderGlowHex(
        palette.primary,
        palette.accent,
        appearanceAnimationNow(),
      ),
      command: palette.shellMode,
      surfaceSunken: palette.surfaceSunken,
      background: palette.background,
      selectionBg: palette.selectionBg,
      selectionText: palette.selectionText,
      ghostText: palette.ghostText,
    },
  });
  const overlayLines = state.editor.getNativeOverlayLines?.(Math.floor(rect.width), {
    text: editorStyles.textStyle,
    selected: editorStyles.autocompleteSelectedStyle,
    description: editorStyles.autocompleteDescriptionStyle,
    scroll: editorStyles.autocompleteScrollStyle,
  }) ?? [];
  // Default product placement: suggestions above the prompt (stable baseline).
  const overlayPlacement = 'above' as const;
  const surfaceLayout = measureRendererEditorSurfaceLayout({
    height: Math.floor(rect.height),
    overlays: overlayLines,
    overlayPlacement,
  });
  const editorFrameRect = { ...rect, height: surfaceLayout.frameRows };
  // Above overlays omit the frame top border → contentY=0, bottom inset=1.
  // Closed / below keep the stock geometry (top inset 1, bottom 1 or 0).
  const frameGeometry = overlayLines.length > 0 && overlayPlacement === 'above'
    ? {
        ...RENDERER_EDITOR_FRAME_TEXT_INPUT_GEOMETRY,
        contentY: 0,
        contentBottomInset: 1,
      }
    : overlayLines.length > 0
      ? {
          ...RENDERER_EDITOR_FRAME_TEXT_INPUT_GEOMETRY,
          contentY: 1,
          contentBottomInset: 0,
        }
      : RENDERER_EDITOR_FRAME_TEXT_INPUT_GEOMETRY;
  // Prefer the surface layout's contentRows so input viewport height matches
  // the painted frame (inset recompute via rendererEditorContentHeight can
  // disagree when overlay geometry omits a border, dropping the input row).
  const contentHeight = Math.max(
    1,
    surfaceLayout.contentRows > 0
      ? surfaceLayout.contentRows
      : (rendererEditorContentHeight(editorFrameRect, frameGeometry) ?? 1),
  );
  const contentWidth = rendererEditorContentWidth(
    editorFrameRect,
    frameGeometry,
  ) ?? 1;
  const input = state.nativeEditorTextInput.inputForEditor(state.editor, {
    focused: true,
    cursorShape: 'bar',
    cursorBlinking: true,
    layoutWidth: contentWidth,
    layoutHeight: contentHeight,
    style: editorStyles.textStyle,
    placeholderStyle: editorStyles.placeholderStyle,
    selectionStyle: editorStyles.selectionStyle,
  });
  const rendered = input.render({
    width: contentWidth,
    height: contentHeight,
    focused: true,
    style: editorStyles.textStyle,
    placeholderStyle: editorStyles.placeholderStyle,
    selectionStyle: editorStyles.selectionStyle,
    // Prompt-intelligence paints ghost via editor.setGhostText; the component
    // path (buildNativeTUIEditorSurface) already forwards it — native layout
    // must too or the on-screen prompt never shows the dim continuation.
    ghostText: state.editor.getGhostText?.(),
    ghostStyle: editorStyles.ghostStyle,
  });
  const surface = renderRendererEditorSurface({
    width: Math.floor(rect.width),
    frameRows: surfaceLayout.frameRows,
    content: rendered,
    prompt: isBash ? '!' : '>',
    topLabel: isBash ? RENDERER_EDITOR_SHELL_MODE_LABEL : undefined,
    overlays: surfaceLayout.overlayLines,
    overlayPlacement,
    scrollbar: {},
    connectedAbove: state.editor.connectedAbove && !state.editor.borderHighlighted,
    borderStyle: editorStyles.borderStyle,
    promptStyle: editorStyles.promptStyle,
    surfaceStyle: editorStyles.surfaceStyle,
    scrollbarTrackStyle: editorStyles.scrollbarTrackStyle,
    scrollbarThumbStyle: editorStyles.scrollbarThumbStyle,
    slashTokenStyle: isBash ? undefined : editorStyles.slashTokenStyle,
  });
  // Pad to the layout rect height so compositor never sees lines.length <
  // rect.height on the editor region (clear:false + short content → black gap).
  const targetRows = Math.max(0, Math.floor(rect.height));
  const painted =
    surface.lines.length >= targetRows
      ? surface.lines
      : padEditorRegionLines(surface.lines, targetRows, Math.floor(rect.width), editorStyles.surfaceStyle);
  // Hash-equal present skip (transcript already does this). Fresh array
  // identities every ambient tick used to recompose the whole editor rect and
  // flash blank/black rows under ConPTY when clear raced the rewrite.
  const lines = presentStableEditorLines(painted, rect);
  const cursor = projectRendererEditorSurfaceCursor({
    surface: { ...surface, lines },
    rect,
    viewport: { x: 0, y: 0, width: terminalColumns, height: terminalRows },
  });

  const projected: {
    readonly lines: readonly RendererRegionLine[];
    cursor?: RendererCursorState;
  } = {
    lines,
  };
  if (cursor !== undefined) projected.cursor = cursor;
  return projected;
}

/**
 * Keep prior editor line object identities when content hashes match.
 * Geometry (rect) changes always take the incoming lines.
 */
export function presentStableEditorLines(
  lines: readonly RendererRegionLine[],
  rect: RendererRect,
): readonly RendererRegionLine[] {
  const rectKey = [
    Math.floor(rect.x),
    Math.floor(rect.y),
    Math.floor(rect.width),
    Math.floor(rect.height),
  ].join(',');
  const keys = lines.map(regionLinePresentKey);
  const prev = lastEditorPresent;
  if (
    prev !== undefined &&
    prev.rectKey === rectKey &&
    prev.keys.length === keys.length &&
    prev.keys.every((key, i) => key === keys[i])
  ) {
    return prev.lines;
  }
  lastEditorPresent = { rectKey, keys, lines };
  return lines;
}

function padEditorRegionLines(
  lines: readonly RendererRegionLine[],
  targetRows: number,
  width: number,
  surfaceStyle: RendererCellStyle | undefined,
): readonly RendererRegionLine[] {
  if (lines.length >= targetRows) return lines;
  const blank: RendererRegionLine = Array.from({ length: Math.max(0, width) }, () => ({
    char: ' ',
    style: surfaceStyle,
  }));
  const out = lines.slice();
  while (out.length < targetRows) out.push(blank);
  return out;
}

export function nativeEditorFallbackRegionLines(
  state: TUIState,
  width: number,
): readonly RendererRegionLine[] {
  if (
    state.editorContainer.children.includes(state.editor) &&
    state.editor.getNativeRegionLines !== undefined
  ) {
    return state.editor.getNativeRegionLines(width);
  }
  return state.editorContainer.render(width);
}
