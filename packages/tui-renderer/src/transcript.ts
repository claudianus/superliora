import { Container, RendererWidthRenderCache } from './component-primitives';
import type { RendererRegionLine } from './compositor';
import {
  renderRendererRightGutterLines,
  renderRendererRightGutterRegionLines,
  renderRendererVerticalScrollbar,
} from './scrollbar';
import {
  projectRendererViewportLineWindow,
  type RendererTranscriptViewport,
  type RendererViewportSnapshot,
} from './viewport';
import {
  Text,
  truncateAnsiDisplayText,
  visibleWidth,
  wrapAnsiDisplayText,
  type Component,
  type RendererComponent,
} from './text-component';

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
  readonly paintLine?: RendererTranscriptViewportLinePainter;
  readonly paintRegionLine?: RendererTranscriptViewportRegionLinePainter;
  readonly isCacheEnabled?: () => boolean;
}

interface RendererTranscriptViewportRenderCache {
  width: number;
  childRefs: Component[];
  childRenderRefs: string[][];
  prefixed: RendererRegionLine[][];
  out: RendererRegionLine[];
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
  readonly formatText?: (
    text: string,
    context: RendererTruncatedOutputFormatContext,
  ) => string;
  readonly formatHint?: (hint: string) => string;
}

export const DEFAULT_RENDERER_TRUNCATED_OUTPUT_LINES = 3;
export const DEFAULT_RENDERER_TRUNCATED_OUTPUT_INDENT = 2;

export class RendererTranscriptViewportComponent extends Container {
  private readonly viewport: RendererTranscriptViewport;
  private readonly getVisibleRows: (width: number) => number;
  private readonly leftPad: number;
  private readonly rightPad: number;
  private readonly scrollbar: boolean;
  private readonly scrollbarTrackChar: string;
  private readonly scrollbarThumbChar: string;
  private readonly minScrollbarThumbRows: number;
  private readonly paintLine: RendererTranscriptViewportLinePainter | undefined;
  private readonly paintRegionLine: RendererTranscriptViewportRegionLinePainter | undefined;
  private readonly isCacheEnabled: () => boolean;
  private renderCache: RendererTranscriptViewportRenderCache | undefined;

  // ── Virtual-scroll line-count cache ────────────────────────────────────
  //
  // Every render needs the total content row count (to sync the viewport) and
  // the per-child row counts (to map a viewport line range back to the
  // children that occupy it).  Computing either requires rendering every
  // child — the dominant cost once the transcript grows past a few hundred
  // messages.  We cache the row counts keyed by inner width so that, after the
  // first render at a given width, subsequent renders only re-render the
  // children that actually changed (and only paint the visible ones).
  //
  // The cache is invalidated on invalidate(), on width change, and on child
  // count change.  Individual children that mutate call invalidate() which
  // propagates up, so stale counts are never served.
  private lineCountCacheWidth = -1;
  private lineCountCache: number[] = [];

  constructor(options: RendererTranscriptViewportComponentOptions) {
    super();
    this.viewport = options.viewport;
    this.getVisibleRows = options.getVisibleRows;
    this.leftPad = normalizeTranscriptPadding(options.leftPad);
    this.rightPad = normalizeTranscriptPadding(options.rightPad);
    this.scrollbar = options.scrollbar ?? true;
    this.scrollbarTrackChar = options.scrollbarTrackChar ?? '│';
    this.scrollbarThumbChar = options.scrollbarThumbChar ?? '█';
    this.minScrollbarThumbRows = normalizeTranscriptLineCount(
      options.minScrollbarThumbRows ?? 1,
    );
    this.paintLine = options.paintLine;
    this.paintRegionLine = options.paintRegionLine;
    this.isCacheEnabled = options.isCacheEnabled ?? (() => true);
  }

  override invalidate(): void {
    this.renderCache = undefined;
    this.lineCountCacheWidth = -1;
    this.lineCountCache = [];
    super.invalidate();
  }

  override render(width: number): string[] {
    return this.renderWithVisibleRows(width, this.getVisibleRows(width));
  }

  /**
   * Total number of rows the transcript content would occupy if rendered
   * without a viewport cap. Used by callers that want to size a container to
   * the actual content instead of always reserving the full viewport.
   *
   * Uses the cached per-child row counts so it does not re-render unchanged
   * children on every call.
   */
  contentRowCount(width: number): number {
    const inner = this.innerWidth(width);
    return this.resolveChildLineCounts(inner).reduce((sum, c) => sum + c, 0);
  }

  renderWithVisibleRows(width: number, visibleRows: number): string[] {
    return this.renderVisibleRegionLines(width, visibleRows).map(regionLineToTranscriptDisplayString);
  }

  renderWithVisibleRegionLines(width: number, visibleRows: number): RendererRegionLine[] {
    return this.renderVisibleRegionLines(width, visibleRows);
  }

  private renderVisibleRegionLines(width: number, visibleRows: number): RendererRegionLine[] {
    const safeWidth = normalizeTranscriptWidth(width);
    const inner = Math.max(1, safeWidth - this.leftPad - this.rightPad);

    // Phase 1 — resolve per-child row counts (cached).  This is the only
    // place that may render *all* children, and only on a cache miss; once
    // cached, subsequent frames skip children whose render output is reused.
    const childCounts = this.resolveChildLineCounts(inner);
    const totalLines = childCounts.reduce((sum, c) => sum + c, 0);

    // Phase 2 — sync the viewport with the total content size.
    const snapshot = this.viewport.sync(totalLines, visibleRows);

    // Phase 3 — when the content fits inside the viewport (no overflow) we
    // still need every child, but we can reuse the cached prefixed lines.
    if (!snapshot.hasOverflow) {
      return this.renderAllChildren(width, inner, safeWidth, childCounts);
    }

    // Phase 4 — overflow: render only the children that intersect the visible
    // line window.  This is the virtual-scroll fast path.
    const visibleLines = this.renderVisibleChildren(
      inner,
      safeWidth,
      childCounts,
      snapshot.start,
      snapshot.end,
    );

    // Phase 5 — attach a scrollbar gutter if configured.
    if (!this.scrollbar || this.rightPad <= 0) return visibleLines;
    return this.renderScrollbar(visibleLines, width, snapshot);
  }

  /** Returns the inner content width (total minus horizontal padding). */
  private innerWidth(width: number): number {
    const safeWidth = normalizeTranscriptWidth(width);
    return Math.max(1, safeWidth - this.leftPad - this.rightPad);
  }

  private resolveChildLineCounts(inner: number): number[] {
    const n = this.children.length;
    if (
      this.isCacheEnabled() &&
      this.lineCountCacheWidth === inner &&
      this.lineCountCache.length === n
    ) {
      return this.lineCountCache;
    }

    const counts = new Array<number>(n);
    for (let i = 0; i < n; i++) {
      counts[i] = this.children[i]!.render(inner).length;
    }
    if (this.isCacheEnabled()) {
      this.lineCountCacheWidth = inner;
      this.lineCountCache = counts;
    }
    return counts;
  }

  private formatCanvasLine(line: string, width: number): RendererRegionLine {
    if (this.paintRegionLine !== undefined) return this.paintRegionLine(line, width);
    if (this.paintLine !== undefined) return this.paintLine(line, width);
    return line;
  }

  private renderAllChildren(
    width: number,
    inner: number,
    safeWidth: number,
    _childCounts: number[],
  ): RendererRegionLine[] {
    const lead = ' '.repeat(this.leftPad);
    const cache = this.renderCache;
    const cacheValid =
      this.isCacheEnabled() &&
      cache !== undefined &&
      cache.width === safeWidth &&
      cache.childRefs.length === this.children.length;

    const childRefs: Component[] = [];
    const childRenderRefs: string[][] = [];
    const prefixed: RendererRegionLine[][] = [];
    let allReused = cacheValid;

    for (let i = 0; i < this.children.length; i++) {
      const child = this.children[i]!;
      const lines = child.render(inner);
      childRefs.push(child);
      childRenderRefs.push(lines);
      const reused =
        cacheValid &&
        cache.childRefs[i] === child &&
        cache.childRenderRefs[i] === lines;
      if (reused) {
        prefixed.push(cache.prefixed[i]!);
      } else {
        allReused = false;
        prefixed.push(lines.map((line) => this.formatCanvasLine(lead + line, safeWidth)));
      }
    }

    const out = allReused ? cache!.out : prefixed.flat();

    if (this.isCacheEnabled()) {
      this.renderCache = { width: safeWidth, childRefs, childRenderRefs, prefixed, out };
    } else {
      this.renderCache = undefined;
    }

    return out;
  }

  private renderVisibleChildren(
    inner: number,
    safeWidth: number,
    childCounts: number[],
    startLine: number,
    endLine: number,
  ): RendererRegionLine[] {
    const lead = ' '.repeat(this.leftPad);
    const out: RendererRegionLine[] = [];

    let lineOffset = 0;
    for (let i = 0; i < this.children.length; i++) {
      const childLines = childCounts[i]!;
      const childStart = lineOffset;
      const childEnd = lineOffset + childLines;

      if (childStart >= endLine) break;

      if (childEnd > startLine) {
        const lines = this.children[i]!.render(inner);
        const sliceStart = Math.max(0, startLine - childStart);
        const sliceEnd = Math.min(lines.length, endLine - childStart);
        for (let j = sliceStart; j < sliceEnd; j++) {
          out.push(this.formatCanvasLine(lead + lines[j]!, safeWidth));
        }
      }

      lineOffset = childEnd;
    }

    return out;
  }

  private renderScrollbar(
    lines: readonly RendererRegionLine[],
    width: number,
    viewport: RendererViewportSnapshot,
  ): RendererRegionLine[] {
    if (!viewport.hasOverflow || !Number.isFinite(viewport.viewportRows) || width < 2) {
      return [...lines];
    }

    const glyphs = renderRendererVerticalScrollbar({
      contentRows: viewport.contentRows,
      viewportRows: viewport.viewportRows,
      offsetFromBottom: viewport.offsetFromBottom,
      trackRows: lines.length,
      minThumbRows: this.minScrollbarThumbRows,
      trackChar: this.scrollbarTrackChar,
      thumbChar: this.scrollbarThumbChar,
    });
    if (glyphs.length === 0) return [...lines];
    return renderRendererRightGutterRegionLines({ lines, width, glyphs });
  }
}

function regionLineToTranscriptDisplayString(line: RendererRegionLine): string {
  if (typeof line === 'string') return line;
  return line.map((cell) => cell.char).join('');
}

export class RendererPrefixedWrappedLine implements RendererComponent {
  private readonly renderCache = new RendererWidthRenderCache();

  constructor(private readonly options: RendererPrefixedWrappedLineOptions) {}

  invalidate(): void {
    this.renderCache.clear();
  }

  render(width: number): string[] {
    const safeWidth = normalizeTranscriptWidth(width);
    if (safeWidth <= 0) return [''];

    return this.renderCache.render({
      width: safeWidth,
      render: () => {
        const prefixWidth = Math.max(
          visibleWidth(this.options.firstPrefix),
          visibleWidth(this.options.continuationPrefix),
        );
        const contentWidth = Math.max(1, safeWidth - prefixWidth);
        const wrapped = new Text(this.options.text, 0, 0).render(contentWidth);
        const tailLines = this.options.tailLines;
        const lines =
          tailLines !== undefined && wrapped.length > tailLines
            ? wrapped.slice(wrapped.length - tailLines)
            : wrapped;
        return renderRendererTranscriptLineBlock({
          width: safeWidth,
          prefix: this.options.firstPrefix,
          continuationPrefix: this.options.continuationPrefix,
          lines,
          truncateMark: this.options.truncateMark ?? '…',
        });
      },
    });
  }
}

export class RendererTruncatedOutputComponent implements RendererComponent {
  private readonly textComponent: Text;
  private readonly output: string;
  private readonly expanded: boolean;
  private readonly isError: boolean;
  private readonly maxLines: number;
  private readonly indent: number;
  private readonly expandHint: boolean;
  private readonly tail: boolean;
  private readonly truncateMark: string;
  private readonly formatText: (
    text: string,
    context: RendererTruncatedOutputFormatContext,
  ) => string;
  private readonly formatHint: (hint: string) => string;

  constructor(output: string, options: RendererTruncatedOutputOptions) {
    this.output = trimRendererTrailingEmptyLines(output.split('\n')).join('\n');
    this.expanded = options.expanded;
    this.isError = options.isError ?? false;
    this.maxLines = options.maxLines ?? DEFAULT_RENDERER_TRUNCATED_OUTPUT_LINES;
    this.indent = options.indent ?? DEFAULT_RENDERER_TRUNCATED_OUTPUT_INDENT;
    this.expandHint = options.expandHint ?? true;
    this.tail = options.tail ?? false;
    this.truncateMark = options.truncateMark ?? '…';
    this.formatText = options.formatText ?? ((text) => text);
    this.formatHint = options.formatHint ?? ((hint) => hint);
    this.textComponent = new Text(this.renderOutputText(), this.indent, 0);
  }

  invalidate(): void {
    this.textComponent.setText(this.renderOutputText());
    this.textComponent.invalidate();
  }

  render(width: number): string[] {
    const contentLines = this.textComponent.render(width);
    const preview = projectRendererLinePreview({
      lines: contentLines,
      expanded: this.expanded,
      maxLines: this.maxLines,
      tail: this.tail,
    });

    if (preview.hiddenLineCount <= 0) return [...preview.lines];

    const hint = this.tail
      ? `... (${String(preview.hiddenLineCount)} earlier lines)`
      : this.expandHint
        ? `... (${String(preview.hiddenLineCount)} more lines, ctrl+o to expand)`
        : `... (${String(preview.hiddenLineCount)} more lines)`;
    const hintLine = this.renderHint(width, hint);
    return preview.hintPosition === 'before'
      ? [hintLine, ...preview.lines]
      : [...preview.lines, hintLine];
  }

  private renderOutputText(): string {
    return this.formatText(this.output, { isError: this.isError });
  }

  private renderHint(width: number, hint: string): string {
    const safeWidth = normalizeTranscriptWidth(width);
    const indentWidth = Math.min(this.indent, safeWidth);
    const hintWidth = Math.max(0, safeWidth - indentWidth);
    const formatted = this.formatHint(hint);
    return ' '.repeat(indentWidth) +
      truncateAnsiDisplayText(formatted, hintWidth, this.truncateMark);
  }
}

export function trimRendererTrailingEmptyLines(lines: readonly string[]): string[] {
  let end = lines.length;
  while (end > 0) {
    const line = lines[end - 1];
    if (line === undefined || line.length > 0) break;
    end--;
  }
  return lines.slice(0, end);
}

export function measureRendererTranscriptContentWidth(
  options: RendererTranscriptContentWidthOptions,
): number {
  const width = normalizeTranscriptWidth(options.width);
  const minContentWidth = normalizeMinContentWidth(options.minContentWidth);
  if (width <= 0) return 0;
  return Math.max(minContentWidth, width - visibleWidth(options.prefix ?? ''));
}

export function renderRendererTranscriptLineBlock(
  options: RendererTranscriptLineBlockOptions,
): string[] {
  const width = normalizeTranscriptWidth(options.width);
  if (width <= 0) return [''];

  const prefix = options.prefix ?? '';
  const continuationPrefix = options.continuationPrefix ?? ' '.repeat(visibleWidth(prefix));
  const truncateMark = options.truncateMark ?? '...';
  const rendered: string[] = options.leadingBlank === true ? [''] : [];

  for (let i = 0; i < options.lines.length; i++) {
    const line = options.lines[i] ?? '';
    rendered.push((i === 0 ? prefix : continuationPrefix) + line);
  }

  return rendered.map((line, index) =>
    options.preserveLine?.(line, index) === true
      ? line
      : truncateAnsiDisplayText(line, width, truncateMark),
  );
}

export function projectRendererLinePreview(
  options: RendererLinePreviewOptions,
): RendererLinePreviewProjection {
  const maxLines = normalizePreviewLineCount(options.maxLines);
  if (options.expanded === true || options.lines.length <= maxLines) {
    return { lines: options.lines, hiddenLineCount: 0 };
  }

  const hiddenLineCount = options.lines.length - maxLines;
  if (options.tail === true) {
    return {
      lines: options.lines.slice(options.lines.length - maxLines),
      hiddenLineCount,
      hintPosition: 'before',
    };
  }

  return {
    lines: options.lines.slice(0, maxLines),
    hiddenLineCount,
    hintPosition: 'after',
  };
}

export function projectRendererLineWindow<TLine = string>(
  options: RendererLineWindowOptions<TLine>,
): RendererLineWindowProjection<TLine> {
  const maxLines = normalizeOptionalPreviewLineCount(options.maxLines);
  if (maxLines === undefined || options.lines.length <= maxLines) {
    return {
      lines: options.lines,
      hiddenLineCount: 0,
      startIndex: 0,
      endIndex: options.lines.length,
      anchor: 'all',
    };
  }

  if (maxLines <= 0) {
    const index = options.tail === true ? options.lines.length : 0;
    return {
      lines: [],
      hiddenLineCount: options.lines.length,
      startIndex: index,
      endIndex: index,
      anchor: options.tail === true ? 'tail' : 'head',
    };
  }

  if (options.tail === true) {
    const startIndex = Math.max(0, options.lines.length - maxLines);
    return {
      lines: options.lines.slice(startIndex),
      hiddenLineCount: startIndex,
      startIndex,
      endIndex: options.lines.length,
      anchor: 'tail',
    };
  }

  return {
    lines: options.lines.slice(0, maxLines),
    hiddenLineCount: options.lines.length - maxLines,
    startIndex: 0,
    endIndex: maxLines,
    anchor: 'head',
  };
}

export function projectRendererNonEmptyLineWindow(
  options: RendererNonEmptyLineWindowOptions,
): RendererNonEmptyLineWindowProjection {
  const lines =
    options.text.length === 0
      ? []
      : options.text
          .split('\n')
          .map((line) => options.trimEnd === false ? line : line.trimEnd())
          .filter((line) => line.trim().length > 0);
  const window = projectRendererLineWindow({
    lines,
    maxLines: options.maxLines,
    tail: options.tail,
  });
  return {
    ...window,
    totalLineCount: lines.length,
  };
}

export function projectRendererWrappedTextPreview(
  options: RendererWrappedTextPreviewOptions,
): RendererWrappedTextPreviewProjection {
  const width = normalizeTranscriptWidth(options.width);
  if (width <= 0) {
    return {
      lines: [''],
      hiddenLineCount: 0,
      startIndex: 0,
      endIndex: 1,
      anchor: 'all',
      wrappedLineCount: 1,
    };
  }

  const text =
    options.normalizeWhitespace === true
      ? options.text.replaceAll(/\s+/g, ' ').trim()
      : options.text;
  const wrapped = wrapAnsiDisplayText(text, width);
  const lines = wrapped.length > 0 ? wrapped : [''];
  const window = projectRendererLineWindow({
    lines,
    maxLines: options.maxLines,
    tail: options.tail,
  });
  const projected = [...window.lines];

  if (window.hiddenLineCount > 0 && options.tail !== true && projected.length > 0) {
    const truncateMark = options.truncateMark ?? '…';
    const lastIndex = projected.length - 1;
    projected[lastIndex] = truncateAnsiDisplayText(
      `${projected[lastIndex] ?? ''}${truncateMark}`,
      width,
      truncateMark,
    );
  }

  return {
    ...window,
    lines: projected,
    wrappedLineCount: lines.length,
  };
}

function normalizeTranscriptWidth(value: number): number {
  return Number.isFinite(value) && value > 0 ? Math.floor(value) : 0;
}

function normalizeTranscriptPadding(value: number | undefined): number {
  return Number.isFinite(value) && value !== undefined && value > 0 ? Math.floor(value) : 0;
}

function normalizeTranscriptLineCount(value: number): number {
  return Number.isFinite(value) && value > 0 ? Math.floor(value) : 1;
}

function normalizeMinContentWidth(value: number | undefined): number {
  return Number.isFinite(value) && value !== undefined && value > 0 ? Math.floor(value) : 1;
}

function normalizePreviewLineCount(value: number): number {
  return Number.isFinite(value) && value > 0 ? Math.floor(value) : 0;
}

function normalizeOptionalPreviewLineCount(value: number | undefined): number | undefined {
  return value === undefined ? undefined : normalizePreviewLineCount(value);
}
