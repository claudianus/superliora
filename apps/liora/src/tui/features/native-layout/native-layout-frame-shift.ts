import { resolveStageLayout } from '../../controllers/stage-layout';
import type { TUIState } from '../../tui-state';

export interface TUIStateNativeLayoutTracking {
  transcriptStart?: number;
  transcriptContentRows?: number;
  transcriptChildCount?: number;
  editorLayoutRows?: number;
}

export interface TUIStateNativeLayoutShift {
  readonly shifted: boolean;
  readonly viewportScrolled: boolean;
  /** Transcript content rows/children or editor geometry changed. */
  readonly structuralShift: boolean;
  /**
   * Editor (or other chrome geometry) row count changed — needs region
   * clear-fills so layout holes wipe. Transcript-only content growth does not
   * set this, so stage/letterbox can stay damage-only during streaming.
   */
  readonly geometryShift: boolean;
  /** Transcript grew (rows or children). Safe for damage-only stack paint. */
  readonly contentGrew: boolean;
  /** Transcript shrank — holes need clear-fills. */
  readonly contentShrunk: boolean;
  readonly next: TUIStateNativeLayoutTracking;
}

export function detectTUIStateNativeLayoutShift(
  state: TUIState,
  frameWidth: number,
  prior: TUIStateNativeLayoutTracking,
  frameHeight = state.terminal.rows,
): TUIStateNativeLayoutShift {
  const stageWidth = resolveStageLayout({
    width: frameWidth,
    height: frameHeight,
    userStageSize: state.userStageSize,
  }).stage.width;
  const transcriptStart = state.transcriptViewport.start();
  const transcriptContentRows = state.transcriptContainer.contentRowCount(stageWidth);
  const transcriptChildCount = state.transcriptContainer.children.length;
  const editorLayoutRows =
    state.editorContainer.children.includes(state.editor) &&
    state.editor.getNativeLayoutRowCount !== undefined
      ? state.editor.getNativeLayoutRowCount(stageWidth)
      : undefined;
  const viewportScrolled =
    prior.transcriptStart !== undefined && prior.transcriptStart !== transcriptStart;
  const rowsChanged =
    prior.transcriptContentRows !== undefined &&
    prior.transcriptContentRows !== transcriptContentRows;
  const childrenChanged =
    prior.transcriptChildCount !== undefined &&
    prior.transcriptChildCount !== transcriptChildCount;
  const contentShift = rowsChanged || childrenChanged;
  const contentGrew =
    (prior.transcriptContentRows !== undefined &&
      transcriptContentRows > prior.transcriptContentRows) ||
    (prior.transcriptChildCount !== undefined &&
      transcriptChildCount > prior.transcriptChildCount);
  const contentShrunk =
    (prior.transcriptContentRows !== undefined &&
      transcriptContentRows < prior.transcriptContentRows) ||
    (prior.transcriptChildCount !== undefined &&
      transcriptChildCount < prior.transcriptChildCount);
  const geometryShift =
    prior.editorLayoutRows !== undefined &&
    editorLayoutRows !== undefined &&
    prior.editorLayoutRows !== editorLayoutRows;
  const structuralShift = contentShift || geometryShift;
  const next: TUIStateNativeLayoutTracking = {
    transcriptStart,
    transcriptContentRows,
    transcriptChildCount,
  };
  if (editorLayoutRows !== undefined) next.editorLayoutRows = editorLayoutRows;
  return {
    shifted: viewportScrolled || structuralShift,
    viewportScrolled,
    structuralShift,
    geometryShift,
    contentGrew,
    contentShrunk,
    next,
  };
}
