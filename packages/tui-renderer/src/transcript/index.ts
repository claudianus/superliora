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

export { RendererTranscriptViewportComponent } from './viewport-component';

export {
  notifyTranscriptChildGeometryDirty,
  registerTranscriptGeometryParent,
  unregisterTranscriptGeometryParent,
  type RendererTranscriptGeometryParent,
} from './geometry-parent';

export { RendererPrefixedWrappedLine } from './prefixed-wrapped-line';

export {
  DEFAULT_RENDERER_TRUNCATED_OUTPUT_INDENT,
  DEFAULT_RENDERER_TRUNCATED_OUTPUT_LINES,
  RendererTruncatedOutputComponent,
} from './truncated-output';
