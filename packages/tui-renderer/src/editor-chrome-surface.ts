import type { RendererRegionLine } from './compositor';
import {
  renderRendererEditorFrame,
  renderRendererEditorOverlayLines,
} from './editor-chrome-frame';
import {
  normalizeEditorFrameCoordinate,
  normalizeEditorFrameSize,
  rendererRectContainsPoint,
} from './editor-chrome-internal';
import {
  projectRendererEditorArgumentHint,
  projectRendererEditorSlashToken,
} from './editor-chrome-text';
import {
  RENDERER_EDITOR_CONTENT_X,
  RENDERER_EDITOR_SCROLLBAR_THUMB,
  RENDERER_EDITOR_SCROLLBAR_TRACK,
  type RendererEditorSurfaceCursorProjectionOptions,
  type RendererEditorSurfaceLayoutOptions,
  type RendererEditorSurfaceLayoutResult,
  type RendererEditorSurfaceOptions,
  type RendererEditorSurfaceResult,
  type RendererEditorSurfaceScrollbarOptions,
  type RendererEditorSurfaceStyleOptions,
  type RendererEditorSurfaceStylePalette,
  type RendererEditorSurfaceStyles,
} from './editor-chrome-types';
import { renderRendererVerticalScrollbar } from './scrollbar';
import type { RendererCursorState } from './terminal-output';
import { rendererDarkTheme, type RendererTheme } from './theme';
import type { RendererTextInputRenderResult } from './text-input';

export function renderRendererEditorSurface(
  options: RendererEditorSurfaceOptions,
): RendererEditorSurfaceResult {
  const overlayLines = options.overlays ?? [];
  const hasOverlays = overlayLines.length > 0;
  // Overlays defer the bottom border, so the input frame is top + content only
  // (contentRows + 1), not the closed box height (contentRows + 2). Defaulting
  // to +2 left a blank content row between the prompt and slash suggestions.
  const defaultFrameRows =
    Math.max(1, options.content.lines.length) + (hasOverlays ? 1 : 2);
  const frameRows = normalizeEditorFrameSize(options.frameRows ?? defaultFrameRows);
  const bottomBorderRows = hasOverlays ? 0 : 1;
  const viewportRows = Math.max(0, frameRows - 1 - bottomBorderRows);
  const contentX = normalizeEditorFrameCoordinate(
    options.contentX,
    RENDERER_EDITOR_CONTENT_X,
  );
  const contentWidth = normalizeEditorFrameSize(
    options.argumentHint?.width ?? options.width - contentX - 2,
  );
  const argumentHint = options.argumentHint;
  let inputLines =
    argumentHint === undefined || argumentHint.enabled === false
      ? options.content.lines
      : projectRendererEditorArgumentHint(options.content.lines, {
          text: argumentHint.text,
          cursor: argumentHint.cursor,
          hints: argumentHint.hints,
          width: contentWidth,
          style: argumentHint.style,
        });
  if (options.slashTokenStyle !== undefined && inputLines.length > 0) {
    inputLines = projectRendererEditorSlashToken(inputLines, options.slashTokenStyle);
  }
  const scrollbarLines = options.scrollbarLines ?? renderRendererEditorSurfaceScrollbar(
    options.content,
    viewportRows,
    options.scrollbar,
  );
  const scrollbarOptions =
    options.scrollbar !== false && options.scrollbar !== undefined
      ? options.scrollbar
      : undefined;
  const frame = renderRendererEditorFrame({
    ...options,
    height: frameRows,
    inputLines,
    inputCursor: options.content.cursor,
    scrollbarLines,
    scrollbarTrackChar: scrollbarOptions?.trackChar ?? options.scrollbarTrackChar,
    scrollbarThumbChar: scrollbarOptions?.thumbChar ?? options.scrollbarThumbChar,
    omitBottomBorder: hasOverlays,
  });
  const renderedOverlays = hasOverlays
    ? renderRendererEditorOverlayLines({
        width: options.width,
        lines: overlayLines,
        borderStyle: options.borderStyle,
        surfaceStyle: options.surfaceStyle,
        textStyle: options.textStyle,
      })
    : [];
  const surface: {
    readonly lines: readonly RendererRegionLine[];
    readonly frameLines: readonly RendererRegionLine[];
    readonly overlayLines: readonly RendererRegionLine[];
    cursor?: RendererCursorState;
  } = {
    lines: [...frame.lines, ...renderedOverlays],
    frameLines: frame.lines,
    overlayLines,
  };
  if (frame.cursor !== undefined) surface.cursor = frame.cursor;
  return surface;
}

export function projectRendererEditorSurfaceCursor(
  options: RendererEditorSurfaceCursorProjectionOptions,
): RendererCursorState | undefined {
  const localCursor = options.surface.cursor;
  if (localCursor === undefined || localCursor.visible === false) return undefined;

  const cursor = {
    ...localCursor,
    x: Math.floor(options.rect.x + localCursor.x),
    y: Math.floor(options.rect.y + localCursor.y),
  };
  if (options.viewport !== undefined && !rendererRectContainsPoint(options.viewport, cursor.x, cursor.y)) {
    return undefined;
  }
  return cursor;
}

export function resolveRendererEditorSurfaceStyles(
  options: RendererEditorSurfaceStyleOptions = {},
): RendererEditorSurfaceStyles {
  const palette = options.palette ?? editorSurfacePaletteFromTheme(options.theme ?? rendererDarkTheme);
  const commandMode = options.commandMode === true;
  const focused = options.focused === true;
  return {
    borderStyle: { fg: commandMode ? palette.command : focused ? palette.borderFocus : palette.border },
    textStyle: { fg: palette.text },
    promptStyle: { fg: commandMode ? palette.command : palette.textStrong, bold: true },
    surfaceStyle: options.canvasBackground === true
      ? { fg: palette.text, bg: palette.background ?? palette.surfaceSunken }
      : { fg: palette.text },
    scrollbarTrackStyle: { fg: palette.textMuted, dim: true },
    scrollbarThumbStyle: { fg: palette.textStrong },
    placeholderStyle: { fg: palette.textMuted, dim: true },
    selectionStyle: { fg: palette.selectionText, bg: palette.selectionBg },
    autocompleteSelectedStyle: { fg: palette.textStrong, bold: true },
    autocompleteDescriptionStyle: { fg: palette.textMuted, dim: true },
    autocompleteScrollStyle: { fg: palette.textMuted, dim: true },
    slashTokenStyle: { fg: palette.textStrong, bold: true },
    ghostStyle: { fg: palette.ghostText ?? palette.textMuted, dim: true },
  };
}

export function measureRendererEditorSurfaceNaturalRows(
  overlays: readonly RendererRegionLine[] = [],
  contentRows = 1,
): number {
  const normalizedContentRows = Math.max(1, Math.floor(contentRows));
  if (overlays.length > 0) {
    // top border + input rows + suggestion rows + bottom border (on overlay chrome)
    return 1 + normalizedContentRows + overlays.length + 1;
  }
  return Math.max(3, 2 + normalizedContentRows);
}

export function measureRendererEditorSurfaceLayout(
  options: RendererEditorSurfaceLayoutOptions,
): RendererEditorSurfaceLayoutResult {
  const rows = normalizeEditorFrameSize(options.height);
  const overlays = options.overlays ?? [];
  if (overlays.length === 0) {
    const minFrameRows = Math.min(
      rows,
      normalizeEditorFrameSize(options.minFrameRows ?? 3),
    );
    const frameRows = rows === 0 ? 0 : Math.max(minFrameRows, rows);
    return {
      rows,
      frameRows,
      contentRows: Math.max(0, frameRows - 2),
      overlayRows: 0,
      overlayLines: [],
    };
  }

  // Keep the prompt/input frame (top + content) and shrink suggestions first.
  // frameRows is the open-top frame only (bottom border lives on overlay chrome).
  const minFrameRows = Math.min(
    rows,
    Math.max(2, normalizeEditorFrameSize(options.minFrameRows ?? 2)),
  );
  const overlayBottomRows = 1;
  // Reserve at least one row for the bottom border when height allows; if the
  // region is only 3 tall we still keep the prompt and drop suggestions.
  const frameRows =
    rows === 0 ? 0 : Math.min(minFrameRows, Math.max(2, rows - overlayBottomRows));
  const overlayRows = Math.min(
    overlays.length,
    Math.max(0, rows - frameRows - overlayBottomRows),
  );
  return {
    rows,
    frameRows,
    contentRows: Math.max(0, frameRows - 1),
    overlayRows,
    overlayLines: overlays.slice(0, overlayRows),
  };
}

function renderRendererEditorSurfaceScrollbar(
  content: RendererTextInputRenderResult,
  viewportRows: number,
  options: RendererEditorSurfaceScrollbarOptions | false | undefined,
): readonly string[] {
  if (options === false || viewportRows <= 0) return [];
  const maxViewportRow = Math.max(0, content.contentRows - viewportRows);
  return renderRendererVerticalScrollbar({
    contentRows: content.contentRows,
    viewportRows,
    offsetFromBottom: maxViewportRow - Math.min(content.viewportRow, maxViewportRow),
    trackRows: viewportRows,
    minThumbRows: options?.minThumbRows ?? 1,
    trackChar: options?.trackChar ?? RENDERER_EDITOR_SCROLLBAR_TRACK,
    thumbChar: options?.thumbChar ?? RENDERER_EDITOR_SCROLLBAR_THUMB,
  });
}

function editorSurfacePaletteFromTheme(theme: RendererTheme): RendererEditorSurfaceStylePalette {
  return {
    text: theme.palette.text,
    textMuted: theme.palette.textMuted,
    textStrong: theme.palette.text,
    border: theme.palette.border,
    borderFocus: theme.palette.borderFocus,
    command: theme.palette.accent,
    surfaceSunken: theme.palette.surfaceMuted,
    selectionBg: theme.palette.selection,
    selectionText: theme.palette.text,
  };
}
