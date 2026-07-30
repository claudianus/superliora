import type { RendererRegionLine } from './compositor';
import type { RendererScrollbarGlyphRole, RendererScrollbarVariant } from './scrollbar';
import type { RendererTranscriptViewport } from './viewport';
import type { Component } from './text-component';

export interface RendererTranscriptContentWidthOptions {
  readonly width: number;
  readonly prefix?: string;
  readonly minContentWidth?: number;
}

export type RendererTranscriptViewportLinePainter = (
  line: string,
  width: number,
) => string;

export type RendererTranscriptViewportRegionLinePainter = (
  line: string,
  width: number,
) => RendererRegionLine;

export interface RendererTranscriptViewportComponentOptions {
  readonly viewport: RendererTranscriptViewport;
  readonly getVisibleRows: (width: number) => number;
  readonly leftPad?: number;
  readonly rightPad?: number;
  readonly scrollbar?: boolean;
  readonly scrollbarTrackChar?: string;
  readonly scrollbarThumbChar?: string;
  readonly minScrollbarThumbRows?: number;
  /** Visual recipe for the right-gutter scrollbar (`plain` default). */
  readonly scrollbarVariant?: RendererScrollbarVariant;
  /** Optional theme paint for scrollbar role glyphs (capsule/plain). */
  readonly paintScrollbarGlyph?: (
    role: RendererScrollbarGlyphRole,
    glyph: string,
  ) => string;
  readonly paintLine?: RendererTranscriptViewportLinePainter;
  readonly paintRegionLine?: RendererTranscriptViewportRegionLinePainter;
  readonly isCacheEnabled?: () => boolean;
  readonly getCacheEpoch?: () => number;
}

export interface RendererTranscriptChildRowRange {
  readonly child: Component;
  readonly childIndex: number;
  /** Width used to render this child inside transcript chrome. */
  readonly renderWidth: number;
  readonly startRow: number;
  /** Exclusive logical transcript row. */
  readonly endRow: number;
  readonly localRow: number;
}

export interface RendererTranscriptLineBlockOptions {
  readonly width: number;
  readonly lines: readonly string[];
  readonly prefix?: string;
  readonly continuationPrefix?: string;
  readonly leadingBlank?: boolean;
  readonly truncateMark?: string;
  readonly preserveLine?: (line: string, index: number) => boolean;
}

export interface RendererLinePreviewOptions {
  readonly lines: readonly string[];
  readonly expanded?: boolean;
  readonly maxLines: number;
  readonly tail?: boolean;
}

export interface RendererLinePreviewProjection {
  readonly lines: readonly string[];
  readonly hiddenLineCount: number;
  readonly hintPosition?: 'before' | 'after';
}

export interface RendererLineWindowOptions<TLine = string> {
  readonly lines: readonly TLine[];
  readonly maxLines?: number;
  readonly tail?: boolean;
}

export interface RendererLineWindowProjection<TLine = string> {
  readonly lines: readonly TLine[];
  readonly hiddenLineCount: number;
  readonly startIndex: number;
  readonly endIndex: number;
  readonly anchor: 'all' | 'head' | 'tail';
}

export interface RendererNonEmptyLineWindowOptions {
  readonly text: string;
  readonly maxLines?: number;
  readonly tail?: boolean;
  readonly trimEnd?: boolean;
}

export interface RendererNonEmptyLineWindowProjection extends RendererLineWindowProjection {
  readonly totalLineCount: number;
}

export interface RendererWrappedTextPreviewOptions {
  readonly text: string;
  readonly width: number;
  readonly maxLines: number;
  readonly tail?: boolean;
  readonly normalizeWhitespace?: boolean;
  readonly truncateMark?: string;
}

export interface RendererWrappedTextPreviewProjection extends RendererLineWindowProjection {
  readonly wrappedLineCount: number;
}

export interface RendererPrefixedWrappedLineOptions {
  readonly firstPrefix: string;
  readonly continuationPrefix: string;
  readonly text: string;
  readonly tailLines?: number;
  readonly minLines?: number;
  readonly truncateMark?: string;
}

export interface RendererTruncatedOutputFormatContext {
  readonly isError: boolean;
}

export interface RendererTruncatedOutputOptions {
  readonly expanded: boolean;
  readonly isError?: boolean;
  readonly maxLines?: number;
  readonly indent?: number;
  readonly expandHint?: boolean;
  readonly tail?: boolean;
  readonly truncateMark?: string;
  /**
   * Wording of the hidden-lines footer. `'key'` (default) advertises the
   * ctrl+o expansion hotkey and keeps the historical bytes; `'scroll'`
   * advertises scroll-to-reveal for transcripts whose viewport expands
   * truncated blocks while the user scrolls back through history.
   */
  readonly hintMode?: 'key' | 'scroll';
  readonly formatText?: (
    text: string,
    context: RendererTruncatedOutputFormatContext,
  ) => string;
  readonly formatHint?: (hint: string) => string;
}
