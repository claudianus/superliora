import {
  measureRendererEditorSurfaceLayout,
  measureRendererEditorSurfaceNaturalRows,
  projectRendererCursorMarkerLines,
  projectRendererEditorSurfaceCursor,
  RENDERER_EDITOR_FRAME_TEXT_INPUT_GEOMETRY,
  RENDERER_EDITOR_SHELL_MODE_LABEL,
  rendererEditorContentHeight,
  rendererEditorContentWidth,
  renderRendererEditorSurface,
  resolveRendererEditorSurfaceStyles,
  type RendererCursorState,
  type RendererRect,
  type RendererRegionLine,
} from '#/tui/renderer';
import { currentTheme } from '#/tui/theme';
import { feedbackBorderGlowHex } from '#/tui/utils/render/feedback-vfx';
import {
  appearanceAnimationNow,
  motionEffectsAllowed,
  resolveUltraworkBorderGlowHex,
  resolveUltraworkEditorBorderStyle,
} from '#/tui/features/appearance/appearance-effects';

import type { TUIState } from '../../tui-state';

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
  const ultraworkGlow =
    state.appState.ultraworkMode === true && motionEffectsAllowed();
  const ultraworkBorderStyle = ultraworkGlow
    ? resolveUltraworkEditorBorderStyle(appearanceAnimationNow())
    : undefined;
  const editorStyles = resolveRendererEditorSurfaceStyles({
    commandMode: isBash,
    focused: state.editor.borderHighlighted || ultraworkGlow,
    canvasBackground: currentTheme.canvasBackgroundEnabled,
    palette: {
      text: palette.text,
      textMuted: palette.textMuted,
      textStrong: palette.textStrong,
      border: palette.border,
      // Ultrawork replaces the static focus color with a liquid multi-hue base;
      // paintUltraworkEditorBorderGlow then adds the perimeter chase on top.
      borderFocus: ultraworkGlow
        ? resolveUltraworkBorderGlowHex(appearanceAnimationNow())
        : feedbackBorderGlowHex(
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
  const contentHeight = rendererEditorContentHeight(
    editorFrameRect,
    frameGeometry,
  ) ?? 1;
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
    connectedAbove: state.editor.connectedAbove && !state.editor.borderHighlighted && !ultraworkGlow,
    borderStyle: ultraworkBorderStyle ?? editorStyles.borderStyle,
    promptStyle: editorStyles.promptStyle,
    surfaceStyle: editorStyles.surfaceStyle,
    scrollbarTrackStyle: editorStyles.scrollbarTrackStyle,
    scrollbarThumbStyle: editorStyles.scrollbarThumbStyle,
    slashTokenStyle: isBash ? undefined : editorStyles.slashTokenStyle,
  });
  const cursor = projectRendererEditorSurfaceCursor({
    surface,
    rect,
    viewport: { x: 0, y: 0, width: terminalColumns, height: terminalRows },
  });

  const projected: {
    readonly lines: readonly RendererRegionLine[];
    cursor?: RendererCursorState;
  } = {
    lines: surface.lines,
  };
  if (cursor !== undefined) projected.cursor = cursor;
  return projected;
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
