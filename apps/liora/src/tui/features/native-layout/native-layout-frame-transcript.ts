import {
  promoteRendererRegionLinesToCells,
  resolveRendererEditorSurfaceStyles,
  visibleWidth,
  type RendererCell,
  type RendererCellStyle,
  type RendererRegionLine,
} from '#/tui/renderer';
import { currentTheme } from '#/tui/theme';

import { CHROME_GUTTER } from '../../constant/rendering';
import type { TUIState } from '../../tui-state';
import {
  cellSelectedAtColumn,
  type TranscriptSelectionRange,
} from '#/tui/features/transcript/transcript-selection';
import { withTranscriptPaintMode } from '#/tui/utils/render/transcript-paint-mode';

/**
 * Window-level promote cache: pure scroll often reuses the same painted string
 * lines (sparse format cache). When input line refs match the previous window
 * for the same start/width/selection, skip ANSI→cell re-parse for the whole
 * viewport.
 */
interface TranscriptPromoteWindowCache {
  start: number;
  width: number;
  selectionKey: string;
  defaultFg: string;
  input: readonly RendererRegionLine[];
  out: readonly RendererRegionLine[];
}

let promoteWindowCache: TranscriptPromoteWindowCache | undefined;

/** Test helper. */
export function resetTranscriptPromoteWindowCacheForTest(): void {
  promoteWindowCache = undefined;
}

/**
 * Parse transcript ANSI lines at frame-compose time (same path as footer chrome)
 * and backfill a theme text foreground when a visible cell only carries background.
 * Without an explicit fg, terminals fall back to their default foreground (often
 * bright white) after authoritative clears — which looked like "theme colors died"
 * in the transcript while footer strings kept their chalk hex colors.
 */
export function promoteTranscriptRegionLinesToCells(
  lines: readonly RendererRegionLine[],
): readonly RendererRegionLine[] {
  const defaultFg = currentTheme.palette.text;
  return promoteRendererRegionLinesToCells(lines).map((line) => {
    if (typeof line === 'string') return line;
    return backfillTranscriptLineForeground(line, defaultFg);
  });
}

/**
 * Promote with a viewport-window identity cache. When pure scroll reuses the
 * same formatted string[] line refs, return the previous cell lines O(1).
 */
export function promoteTranscriptRegionLinesToCellsCached(
  lines: readonly RendererRegionLine[],
  options: {
    readonly start: number;
    readonly width: number;
    readonly selectionKey: string;
  },
): readonly RendererRegionLine[] {
  const defaultFg = currentTheme.palette.text;
  const hit = promoteWindowCache;
  if (
    hit !== undefined &&
    hit.start === options.start &&
    hit.width === options.width &&
    hit.selectionKey === options.selectionKey &&
    hit.defaultFg === defaultFg &&
    hit.input.length === lines.length &&
    lineRefsEqual(hit.input, lines)
  ) {
    return hit.out;
  }
  const out = promoteTranscriptRegionLinesToCells(lines);
  promoteWindowCache = {
    start: options.start,
    width: options.width,
    selectionKey: options.selectionKey,
    defaultFg,
    input: lines,
    out,
  };
  return out;
}

function lineRefsEqual(
  a: readonly RendererRegionLine[],
  b: readonly RendererRegionLine[],
): boolean {
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

/**
 * Backfill a theme foreground onto cells that only carry a background. Returns
 * the *same* array reference when no cell changes, preserving the stable
 * cell-array identity from the promote cache so the compositor's reference-keyed
 * row-key memoization can skip re-serializing unchanged transcript rows.
 */
function backfillTranscriptLineForeground(
  line: readonly RendererCell[],
  defaultFg: string,
): readonly RendererCell[] {
  let changed = false;
  const result = line.map((cell) => {
    if (cell.style?.fg !== undefined || cell.char.trim().length === 0) return cell;
    changed = true;
    return { ...cell, style: { fg: defaultFg, ...cell.style } };
  });
  return changed ? result : line;
}

export function nativeTranscriptRegionLines(
  state: TUIState,
  width: number,
  visibleRows: number,
  options?: { readonly suppressLiveToolTicks?: boolean },
): readonly RendererRegionLine[] {
  return withTranscriptPaintMode(
    { suppressLiveToolTicks: options?.suppressLiveToolTicks === true },
    () => nativeTranscriptRegionLinesImpl(state, width, visibleRows),
  );
}

function nativeTranscriptRegionLinesImpl(
  state: TUIState,
  width: number,
  visibleRows: number,
): readonly RendererRegionLine[] {
  const container = state.transcriptContainer;
  const rawLines = typeof container.renderWithVisibleRegionLines === 'function'
    ? container.renderWithVisibleRegionLines(width, visibleRows)
    : container.renderWithVisibleRows(width, visibleRows);

  const range = state.transcriptSelection.rangeForRender();
  const selectionKey = range === undefined
    ? ''
    : `${range.start.globalLine}:${range.start.col}:${range.end.globalLine}:${range.end.col}`;
  const start = state.transcriptViewport.start();

  // String rows need ANSI→cell promote; already-cell lines pass through.
  // Window cache makes pure scroll over the same sparse-formatted lines free.
  const lines = promoteTranscriptRegionLinesToCellsCached(rawLines, {
    start,
    width,
    selectionKey,
  });

  if (range === undefined) return lines;
  const palette = currentTheme.palette;
  const editorStyles = resolveRendererEditorSurfaceStyles({
    palette: {
      text: palette.text,
      textMuted: palette.textMuted,
      textStrong: palette.textStrong,
      border: palette.border,
      borderFocus: palette.borderFocus,
      command: palette.shellMode,
      surfaceSunken: palette.surfaceSunken,
      background: palette.background,
      selectionBg: palette.selectionBg,
      selectionText: palette.selectionText,
      ghostText: palette.ghostText,
    },
    canvasBackground: currentTheme.canvasBackgroundEnabled,
  });
  return applyTranscriptSelectionOverlay(
    lines,
    start,
    range,
    editorStyles.selectionStyle,
  );
}

function applyTranscriptSelectionOverlay(
  lines: readonly RendererRegionLine[],
  viewportStart: number,
  range: TranscriptSelectionRange,
  selectionStyle: RendererCellStyle,
): readonly RendererRegionLine[] {
  return lines.map((line, rowIndex) =>
    applyTranscriptSelectionOverlayToLine(
      line,
      viewportStart + rowIndex,
      range,
      selectionStyle,
    ),
  );
}

function applyTranscriptSelectionOverlayToLine(
  line: RendererRegionLine,
  globalLine: number,
  range: TranscriptSelectionRange,
  selectionStyle: RendererCellStyle,
): RendererRegionLine {
  if (typeof line === 'string') {
    return applyTranscriptSelectionOverlayToLine(
      promoteRendererRegionLinesToCells([line])[0] ?? [],
      globalLine,
      range,
      selectionStyle,
    );
  }
  let col = 0;
  return line.map((cell) => {
    const cellWidth = Math.max(1, visibleWidth(cell.char));
    const selected = cellSelectedAtColumn(
      globalLine,
      col,
      col + cellWidth,
      range,
      CHROME_GUTTER,
    );
    col += cellWidth;
    if (!selected) return cell;
    return {
      ...cell,
      style: mergeTranscriptSelectionCellStyle(cell.style, selectionStyle),
    };
  });
}

function mergeTranscriptSelectionCellStyle(
  base: RendererCellStyle | undefined,
  overlay: RendererCellStyle,
): RendererCellStyle {
  if (base === undefined) return overlay;
  return { ...base, ...overlay };
}
