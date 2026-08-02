export type {
  RendererLinePreviewOptions,
  RendererLinePreviewProjection,
  RendererLineWindowOptions,
  RendererLineWindowProjection,
  RendererNonEmptyLineWindowOptions,
  RendererNonEmptyLineWindowProjection,
  RendererPrefixedWrappedLineOptions,
  RendererTranscriptChildRowRange,
  RendererTranscriptContentWidthOptions,
  RendererTranscriptLineBlockOptions,
  RendererTranscriptViewportComponentOptions,
  RendererTranscriptViewportLinePainter,
  RendererTranscriptViewportRegionLinePainter,
  RendererTruncatedOutputFormatContext,
  RendererTruncatedOutputOptions,
  RendererWrappedTextPreviewOptions,
  RendererWrappedTextPreviewProjection,
} from './types';

export {
  measureRendererTranscriptContentWidth,
  renderRendererTranscriptLineBlock,
  trimRendererTrailingEmptyLines,
} from './line-block';

export {
  projectRendererLinePreview,
  projectRendererLineWindow,
  projectRendererNonEmptyLineWindow,
  projectRendererWrappedTextPreview,
} from './line-projection';

export {
  RendererTranscriptViewportComponent,
  TRANSCRIPT_CONTENT_MATERIALIZE_BUDGET,
  TRANSCRIPT_OVERFLOW_MAX_RETAINED_CHILDREN,
} from './viewport-component';

export {
  TranscriptVisibleLinePresenter,
  regionLinePresentKey,
  type TranscriptPresentResult,
} from './incremental-present';

export {
  notifyTranscriptChildGeometryDirty,
  registerTranscriptGeometryParent,
  unregisterTranscriptGeometryParent,
  type RendererTranscriptGeometryParent,
} from './geometry-parent';

export {
  TRANSCRIPT_MEASURE_FULL_WRAP_CHAR_CAP,
  TRANSCRIPT_SCROLL_STORM_GAP_MS,
  estimateTranscriptWrappedRowCount,
  isTranscriptCheapPaintMode,
  isTranscriptMeasureMode,
  isTranscriptScrollStorm,
  lastTranscriptPureScrollPaintAt,
  measurePlaceholderLines,
  noteTranscriptPureScrollPaint,
  resetTranscriptMeasureModeForTest,
  shouldSkipExpensiveTranscriptFormat,
  withTranscriptCheapPaintMode,
  withTranscriptMeasureMode,
} from './measure-mode';
export { RendererPrefixedWrappedLine } from './prefixed-wrapped-line';

export {
  DEFAULT_RENDERER_TRUNCATED_OUTPUT_INDENT,
  DEFAULT_RENDERER_TRUNCATED_OUTPUT_LINES,
  RENDERER_TRUNCATED_OUTPUT_DEFER_CHARS,
  RENDERER_TRUNCATED_OUTPUT_EXPANDED_VISUAL_CAP,
  RENDERER_TRUNCATED_OUTPUT_HARD_CAP_LINES,
  RendererTruncatedOutputComponent,
  capRawOutputLines,
} from './truncated-output';
