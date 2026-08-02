import type { RendererRegionLine } from '../render/compositor';
import {
  renderRendererEditorFrame,
  renderRendererEditorOverlayLines,
} from './frame';
import {
  normalizeEditorFrameCoordinate,
  normalizeEditorFrameSize,
  rendererRectContainsPoint,
} from './internal';
import {
  projectRendererEditorArgumentHint,
  projectRendererEditorSlashToken,
} from './text';
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
} from './types';
import { renderRendererVerticalScrollbar } from '../scrollbar';
import type { RendererCursorState } from '../terminal/output';
import { rendererDarkTheme, type RendererTheme } from '../theme';
import type { RendererTextInputRenderResult } from '../text-input/index';

export function renderRendererEditorSurface(
  options: RendererEditorSurfaceOptions,
): RendererEditorSurfaceResult {
  const overlayLines = options.overlays ?? [];
  const hasOverlays = overlayLines.length > 0;
  // Product default: suggestions above the prompt so the input rides the
  // bottom-pinned editor edge (no jump when the region grows).
  const placement = options.overlayPlacement ?? 'above';
  const above = hasOverlays && placement !== 'below';
  // With overlays, one border is deferred to overlay chrome, so the input
  // frame is content + remaining border only (not a closed box).
  const defaultFrameRows =
    Math.max(1, options.content.lines.length) + (hasOverlays ? 1 : 2);
  const frameRows = normalizeEditorFrameSize(options.frameRows ?? defaultFrameRows);
  const topBorderRows = hasOverlays && above ? 0 : 1;
  const bottomBorderRows = hasOverlays && !above ? 0 : 1;
  const viewportRows = Math.max(0, frameRows - topBorderRows - bottomBorderRows);
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
    // Above: top border lives on overlay chrome. Below: bottom border does.
    omitTopBorder: hasOverlays && above,
    omitBottomBorder: hasOverlays && !above,
    // topLabel only paints on the frame top border; when overlays own the top
    // cap, skip it on the frame (shell mode rarely opens slash overlays).
    topLabel: hasOverlays && above ? undefined : options.topLabel,
  });
  const renderedOverlays = hasOverlays
    ? renderRendererEditorOverlayLines({
        width: options.width,
        lines: overlayLines,
        borderStyle: options.borderStyle,
        surfaceStyle: options.surfaceStyle,
        textStyle: options.textStyle,
        cap: above ? 'top' : 'bottom',
      })
    : [];
  // Local cursor is relative to the input frame; when suggestions sit above,
  // shift Y by the painted overlay chrome height so absolute projection works.
  const overlayOffsetY = above ? renderedOverlays.length : 0;
  let surfaceCursor = frame.cursor;
  if (surfaceCursor !== undefined && overlayOffsetY > 0) {
    surfaceCursor = { ...surfaceCursor, y: surfaceCursor.y + overlayOffsetY };
  }
  const surface: {
    readonly lines: readonly RendererRegionLine[];
    readonly frameLines: readonly RendererRegionLine[];
    readonly overlayLines: readonly RendererRegionLine[];
    cursor?: RendererCursorState;
  } = {
    lines: above
      ? [...renderedOverlays, ...frame.lines]
      : [...frame.lines, ...renderedOverlays],
    frameLines: frame.lines,
    overlayLines,
  };
  if (surfaceCursor !== undefined) surface.cursor = surfaceCursor;
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
    // One continuous box: cap border + input rows + suggestion rows + other border.
    // Placement (above/below) does not change total natural height.
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

  const placement = options.overlayPlacement ?? 'above';
  const above = placement !== 'below';
  // Keep the prompt/input frame and shrink suggestions first.
  // One border is deferred to overlay chrome:
  // - below: frame = top + content (omit bottom)
  // - above: frame = content + bottom (omit top)
  const minFrameRows = Math.min(
    rows,
    Math.max(2, normalizeEditorFrameSize(options.minFrameRows ?? 2)),
  );
  const overlayCapRows = 1;
  const frameRows =
    rows === 0 ? 0 : Math.min(minFrameRows, Math.max(2, rows - overlayCapRows));
  const overlayRows = Math.min(
    overlays.length,
    Math.max(0, rows - frameRows - overlayCapRows),
  );
  return {
    rows,
    frameRows,
    // above: frame has bottom only → contentRows = frameRows - 1
    // below: frame has top only → contentRows = frameRows - 1
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
