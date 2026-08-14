import { resolveStageLayout } from '../../controllers/layout/stage-layout';
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
   * Editor-slot row count changed (prompt height, replacement panel, unmount,
   * restore). Transcript-only content growth does not set this. Policy keeps
   * these frames damage-only so stage/letterbox are not full-cleared.
   */
  readonly geometryShift: boolean;
  /** Transcript grew (rows or children). Safe for damage-only stack paint. */
  readonly contentGrew: boolean;
  /** Transcript shrank. Region overwrite covers holes; do not full-clear. */
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
  const editorLayoutRows = measureEditorSlotRows(state, stageWidth);
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
    prior.editorLayoutRows !== undefined && prior.editorLayoutRows !== editorLayoutRows;
  const structuralShift = contentShift || geometryShift;
  const next: TUIStateNativeLayoutTracking = {
    transcriptStart,
    transcriptContentRows,
    transcriptChildCount,
    editorLayoutRows,
  };
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

function measureEditorSlotRows(state: TUIState, stageWidth: number): number {
  if (
    state.editorContainer.children.includes(state.editor) &&
    state.editor.getNativeLayoutRowCount !== undefined
  ) {
    return state.editor.getNativeLayoutRowCount(stageWidth);
  }
  return state.editorContainer.measureContentRows(stageWidth);
}
