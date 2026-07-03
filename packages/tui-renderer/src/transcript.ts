import { Container, RendererWidthRenderCache } from './component-primitives';
import {
  renderRendererRightGutterLines,
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
  readonly isCacheEnabled?: () => boolean;
}

interface RendererTranscriptViewportRenderCache {
  width: number;
  childRefs: Component[];
  childRenderRefs: string[][];
  prefixed: string[][];
  out: string[];
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
  private readonly isCacheEnabled: () => boolean;
  private renderCache: RendererTranscriptViewportRenderCache | undefined;

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
    this.isCacheEnabled = options.isCacheEnabled ?? (() => true);
  }

  override invalidate(): void {
    this.renderCache = undefined;
    super.invalidate();
  }

  override render(width: number): string[] {
    return this.renderWithVisibleRows(width, this.getVisibleRows(width));
  }

  renderWithVisibleRows(width: number, visibleRows: number): string[] {
    const lines = this.renderChildren(width);
    const snapshot = this.viewport.sync(lines.length, visibleRows);
    const window = projectRendererViewportLineWindow({
      lines,
      viewportRows: snapshot.viewportRows,
      offsetFromBottom: snapshot.offsetFromBottom,
      followOutput: snapshot.followOutput,
    });
    if (!window.hasOverflow) return [...window.lines];
    if (!this.scrollbar || this.rightPad <= 0) return [...window.lines];
    return this.renderScrollbar(window.lines, width, window);
  }

  private renderChildren(width: number): string[] {
    const safeWidth = normalizeTranscriptWidth(width);
    const inner = Math.max(1, safeWidth - this.leftPad - this.rightPad);
    const lead = ' '.repeat(this.leftPad);
    const cache = this.renderCache;
    const cacheValid = this.isCacheEnabled() &&
      cache !== undefined &&
      cache.width === safeWidth &&
      cache.childRefs.length === this.children.length;

    const childRefs: Component[] = [];
    const childRenderRefs: string[][] = [];
    const prefixed: string[][] = [];
    let allReused = cacheValid;

    for (let i = 0; i < this.children.length; i++) {
      const child = this.children[i]!;
      const lines = child.render(inner);
      childRefs.push(child);
      childRenderRefs.push(lines);
      const reused = cacheValid &&
        cache.childRefs[i] === child &&
        cache.childRenderRefs[i] === lines;
      if (reused) {
        prefixed.push(cache.prefixed[i]!);
      } else {
        allReused = false;
        prefixed.push(lines.map((line) => this.paintCanvasLine(lead + line, safeWidth)));
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

  private paintCanvasLine(line: string, width: number): string {
    return this.paintLine?.(line, width) ?? line;
  }

  private renderScrollbar(
    lines: readonly string[],
    width: number,
    viewport: RendererViewportSnapshot,
  ): string[] {
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
    return renderRendererRightGutterLines({ lines, width, glyphs });
  }
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
