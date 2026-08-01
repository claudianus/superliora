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
  const lines = typeof container.renderWithVisibleRegionLines === 'function'
    ? container.renderWithVisibleRegionLines(width, visibleRows)
    : promoteRendererRegionLinesToCells(
        container.renderWithVisibleRows(width, visibleRows),
      );
  const range = state.transcriptSelection.rangeForRender();
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
    state.transcriptViewport.start(),
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
