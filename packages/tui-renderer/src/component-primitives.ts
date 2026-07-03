import {
  type Component,
  type RendererTextBackgroundFn,
  truncateToWidth,
  visibleWidth,
} from './text-component';
import {
  projectRendererScrollableLineWindow,
  type RendererScrollableLineWindowProjection,
  RendererScrollableLineViewport,
  type RendererScrollableLineViewportSnapshot,
  type RendererStableScrollableLineWindowProjection,
  RendererStableScrollableLineViewport,
} from './viewport';

export interface Focusable {
  focused: boolean;
}

export const CURSOR_MARKER = '\u001B_pi:c\u0007';

export function isFocusable(component: Component | null): component is Component & Focusable {
  return component !== null && 'focused' in component;
}

export class Container implements Component {
  children: Component[] = [];

  addChild(component: Component): void {
    this.children.push(component);
  }

  removeChild(component: Component): void {
    const index = this.children.indexOf(component);
    if (index !== -1) this.children.splice(index, 1);
  }

  clear(): void {
    this.children = [];
  }

  invalidate(): void {
    for (const child of this.children) {
      child.invalidate?.();
    }
  }

  render(width: number): string[] {
    const lines: string[] = [];
    for (const child of this.children) {
      lines.push(...child.render(width));
    }
    return lines;
  }
}

export interface RendererChildrenRenderCacheOptions {
  readonly width: number;
  readonly children: readonly Component[];
  readonly isCacheEnabled?: () => boolean;
  readonly renderChild?: (
    child: Component,
    width: number,
    index: number,
  ) => readonly string[];
  readonly projectChildLines?: (
    lines: readonly string[],
    child: Component,
    width: number,
    index: number,
  ) => readonly string[];
}

interface RendererChildrenRenderCacheSnapshot {
  width: number;
  childRefs: Component[];
  childRenderRefs: ReadonlyArray<readonly string[]>;
  projectedLines: ReadonlyArray<readonly string[]>;
  out: string[];
}

export class RendererChildrenRenderCache {
  private cache: RendererChildrenRenderCacheSnapshot | undefined;

  clear(): void {
    this.cache = undefined;
  }

  render(options: RendererChildrenRenderCacheOptions): string[] {
    const width = options.width;
    const cacheEnabled = options.isCacheEnabled?.() ?? true;
    const cache = this.cache;
    const cacheValid = cacheEnabled &&
      cache !== undefined &&
      cache.width === width &&
      cache.childRefs.length === options.children.length;

    const childRefs: Component[] = [];
    const childRenderRefs: Array<readonly string[]> = [];
    const projectedLines: Array<readonly string[]> = [];
    let allReused = cacheValid;

    for (let i = 0; i < options.children.length; i++) {
      const child = options.children[i]!;
      const lines = options.renderChild?.(child, width, i) ?? child.render(width);
      childRefs.push(child);
      childRenderRefs.push(lines);
      const reused = cacheValid &&
        cache.childRefs[i] === child &&
        cache.childRenderRefs[i] === lines;
      if (reused) {
        projectedLines.push(cache.projectedLines[i]!);
      } else {
        allReused = false;
        projectedLines.push(options.projectChildLines?.(lines, child, width, i) ?? lines);
      }
    }

    const out = allReused ? cache!.out : projectedLines.flat();
    if (cacheEnabled) {
      this.cache = { width, childRefs, childRenderRefs, projectedLines, out };
    } else {
      this.cache = undefined;
    }
    return out;
  }
}

export interface RendererWidthRenderCacheOptions {
  readonly width: number;
  readonly isCacheEnabled?: () => boolean;
  readonly render: (width: number) => string[];
}

interface RendererWidthRenderCacheSnapshot {
  width: number;
  out: string[];
}

export class RendererWidthRenderCache {
  private cache: RendererWidthRenderCacheSnapshot | undefined;

  clear(): void {
    this.cache = undefined;
  }

  render(options: RendererWidthRenderCacheOptions): string[] {
    const cacheEnabled = options.isCacheEnabled?.() ?? true;
    if (
      cacheEnabled &&
      this.cache !== undefined &&
      this.cache.width === options.width
    ) {
      return this.cache.out;
    }

    const out = options.render(options.width);
    if (cacheEnabled) {
      this.cache = { width: options.width, out };
    } else {
      this.cache = undefined;
    }
    return out;
  }
}

export type RendererGutterLinePainter = (line: string, width: number) => string;

export interface RendererGutterContainerOptions {
  readonly leftPad?: number;
  readonly rightPad?: number;
  readonly paintLine?: RendererGutterLinePainter;
  readonly isCacheEnabled?: () => boolean;
}

interface RendererGutterContainerRenderCache {
  width: number;
  childRefs: Component[];
  childRenderRefs: string[][];
  prefixed: string[][];
  out: string[];
}

export class RendererGutterContainer extends Container {
  private readonly leftPad: number;
  private readonly rightPad: number;
  private readonly paintLine: RendererGutterLinePainter | undefined;
  private readonly isCacheEnabled: () => boolean;
  private renderCache: RendererGutterContainerRenderCache | undefined;

  constructor(options: RendererGutterContainerOptions = {}) {
    super();
    this.leftPad = normalizeLineCount(options.leftPad ?? 0);
    this.rightPad = normalizeLineCount(options.rightPad ?? 0);
    this.paintLine = options.paintLine;
    this.isCacheEnabled = options.isCacheEnabled ?? (() => true);
  }

  override invalidate(): void {
    this.renderCache = undefined;
    super.invalidate();
  }

  override render(width: number): string[] {
    const safeWidth = normalizeRenderWidth(width);
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
}

export class Spacer implements Component {
  constructor(private lines = 1) {}

  setLines(lines: number): void {
    this.lines = normalizeLineCount(lines);
  }

  invalidate(): void {}

  render(_width: number): string[] {
    return Array.from({ length: normalizeLineCount(this.lines) }, () => '');
  }
}

export class Box implements Component {
  children: Component[] = [];
  private cache?: {
    readonly width: number;
    readonly bgSample: string | undefined;
    readonly childLines: readonly string[];
    readonly lines: string[];
  };

  constructor(
    private readonly paddingX = 1,
    private readonly paddingY = 1,
    private bgFn?: RendererTextBackgroundFn,
  ) {}

  addChild(component: Component): void {
    this.children.push(component);
    this.invalidateCache();
  }

  removeChild(component: Component): void {
    const index = this.children.indexOf(component);
    if (index === -1) return;
    this.children.splice(index, 1);
    this.invalidateCache();
  }

  clear(): void {
    this.children = [];
    this.invalidateCache();
  }

  setBgFn(bgFn?: RendererTextBackgroundFn): void {
    this.bgFn = bgFn;
  }

  invalidate(): void {
    this.invalidateCache();
    for (const child of this.children) {
      child.invalidate?.();
    }
  }

  render(width: number): string[] {
    if (this.children.length === 0) return [];

    const safeWidth = normalizeRenderWidth(width);
    const paddingX = normalizeLineCount(this.paddingX);
    const paddingY = normalizeLineCount(this.paddingY);
    const contentWidth = Math.max(1, safeWidth - paddingX * 2);
    const leftPad = ' '.repeat(paddingX);
    const childLines = this.children.flatMap((child) =>
      child.render(contentWidth).map((line) => leftPad + line),
    );
    if (childLines.length === 0) return [];

    const bgSample = this.bgFn?.('test');
    if (this.cacheMatches(safeWidth, childLines, bgSample)) return this.cache!.lines;

    const emptyLine = this.applyBg('', safeWidth);
    const result = [
      ...Array.from({ length: paddingY }, () => emptyLine),
      ...childLines.map((line) => this.applyBg(line, safeWidth)),
      ...Array.from({ length: paddingY }, () => emptyLine),
    ];
    this.cache = { width: safeWidth, bgSample, childLines, lines: result };
    return result;
  }

  private applyBg(line: string, width: number): string {
    const padding = ' '.repeat(Math.max(0, width - visibleWidth(line)));
    const padded = line + padding;
    return this.bgFn === undefined ? padded : this.bgFn(padded);
  }

  private cacheMatches(
    width: number,
    childLines: readonly string[],
    bgSample: string | undefined,
  ): boolean {
    return (
      this.cache !== undefined &&
      this.cache.width === width &&
      this.cache.bgSample === bgSample &&
      this.cache.childLines.length === childLines.length &&
      this.cache.childLines.every((line, index) => line === childLines[index])
    );
  }

  private invalidateCache(): void {
    this.cache = undefined;
  }
}

export interface RendererDividerRowOptions {
  readonly width: number;
  readonly lineStyle?: RendererDividerLineStyle;
  readonly char?: string;
  readonly style?: (text: string) => string;
}

export type RendererDividerLineStyle =
  | 'solid'
  | 'heavy'
  | 'double'
  | 'dashed'
  | 'ascii'
  | 'thick';

const RENDERER_DIVIDER_LINE_STYLE_CHAR: Record<RendererDividerLineStyle, string> = {
  solid: '─',
  heavy: '━',
  double: '═',
  dashed: '╍',
  ascii: '-',
  thick: '█',
};

export function renderRendererDividerRow(options: RendererDividerRowOptions): string {
  const width = normalizeRenderWidth(options.width);
  if (width <= 0) return '';
  const char =
    options.char ?? RENDERER_DIVIDER_LINE_STYLE_CHAR[options.lineStyle ?? 'solid'];
  const plain = fillRendererDividerRow(char, width);
  return options.style === undefined ? plain : options.style(plain);
}

function fillRendererDividerRow(char: string, width: number): string {
  const unit = visibleWidth(char) > 0 ? char : '─';
  let output = '';
  while (visibleWidth(output) < width) {
    output += unit;
  }
  if (visibleWidth(output) > width) return truncateToWidth(output, width, '');
  return output;
}

export interface RendererLabeledDividerRowOptions {
  readonly width: number;
  readonly label: string;
  readonly leadingDividerWidth?: number;
  readonly leadingGap?: string;
  readonly trailingGap?: string;
  readonly dividerLineStyle?: RendererDividerLineStyle;
  readonly dividerChar?: string;
  readonly dividerStyle?: (text: string) => string;
  readonly labelStyle?: (text: string) => string;
  readonly ellipsis?: string;
}

export function renderRendererLabeledDividerRow(
  options: RendererLabeledDividerRowOptions,
): string {
  const width = normalizeRenderWidth(options.width);
  if (width <= 0) return '';

  const leadingDividerWidth = Math.min(
    Math.max(0, normalizeLineCount(options.leadingDividerWidth ?? 1)),
    width,
  );
  const rule = (text: string): string => options.dividerStyle?.(text) ?? text;
  const divider = (dividerWidth: number): string =>
    renderRendererDividerRow({
      width: dividerWidth,
      lineStyle: options.dividerLineStyle,
      char: options.dividerChar,
      style: options.dividerStyle,
    });
  const leadingGap = normalizeVisibleGap(options.leadingGap ?? ' ');
  const trailingGap = normalizeVisibleGap(options.trailingGap ?? ' ');
  const prefix = divider(leadingDividerWidth) + rule(leadingGap);
  const prefixWidth = visibleWidth(prefix);
  if (prefixWidth >= width) return truncateToWidth(prefix, width, '');

  const trailingGapWidth = visibleWidth(trailingGap);
  const rawLabel = options.labelStyle?.(options.label) ?? options.label;
  const labelWidth = Math.max(0, width - prefixWidth - trailingGapWidth);
  const label = truncateToWidth(rawLabel, labelWidth, options.ellipsis);
  const suffixWidth = Math.max(0, width - prefixWidth - visibleWidth(label));
  const suffix = renderRendererLabeledDividerSuffix({
    width: suffixWidth,
    gap: trailingGap,
    divider,
    rule,
  });
  return truncateToWidth(prefix + label + suffix, width, '');
}

function renderRendererLabeledDividerSuffix(options: {
  readonly width: number;
  readonly gap: string;
  readonly divider: (width: number) => string;
  readonly rule: (text: string) => string;
}): string {
  if (options.width <= 0) return '';
  const gapWidth = visibleWidth(options.gap);
  if (gapWidth <= 0) return options.divider(options.width);
  if (options.width <= gapWidth) {
    return options.rule(truncateToWidth(options.gap, options.width, ''));
  }
  return options.rule(options.gap) + options.divider(options.width - gapWidth);
}

function normalizeVisibleGap(value: string): string {
  return visibleWidth(value) > 0 ? value : ' ';
}

export interface RendererPanelChromeRowsOptions {
  readonly width: number;
  readonly title: string;
  readonly titleSuffix?: string;
  readonly hint?: string;
  readonly body?: readonly string[];
  readonly footer?: readonly string[];
  readonly bodyTopGap?: boolean;
  readonly footerTopGap?: boolean;
  readonly dividerLineStyle?: RendererDividerLineStyle;
  readonly dividerStyle?: (text: string) => string;
  readonly titleStyle?: (text: string) => string;
  readonly hintStyle?: (text: string) => string;
  readonly ellipsis?: string;
}

export function renderRendererPanelChromeRows(
  options: RendererPanelChromeRowsOptions,
): string[] {
  const width = normalizeRenderWidth(options.width);
  if (width <= 0) return [];

  const divider = renderRendererDividerRow({
    width,
    lineStyle: options.dividerLineStyle,
    style: options.dividerStyle,
  });
  const title = (options.titleStyle?.(options.title) ?? options.title) +
    (options.titleSuffix ?? '');
  const rows = [divider, title];
  if (options.hint !== undefined) {
    rows.push(options.hintStyle?.(options.hint) ?? options.hint);
  }
  if (options.bodyTopGap ?? true) rows.push('');
  rows.push(...(options.body ?? []));
  if (options.footerTopGap ?? true) rows.push('');
  rows.push(...(options.footer ?? []));
  rows.push(divider);
  return rows.map((row) => truncateToWidth(row, width, options.ellipsis));
}

export interface RendererScrollablePanelChromeRowsOptions
  extends Omit<RendererPanelChromeRowsOptions, 'body'> {
  readonly body: readonly string[];
  readonly viewportRows: number;
  readonly scrollTop?: number;
  readonly followTail?: boolean;
  readonly fill?: string;
  readonly scrollFooter?: (
    projection: RendererScrollableLineWindowProjection,
  ) => string | undefined;
  readonly scrollFooterStyle?: (text: string) => string;
}

export interface RendererScrollablePanelChromeRowsProjection
  extends RendererScrollableLineWindowProjection {
  readonly rows: readonly string[];
}

export function renderRendererScrollablePanelChromeRows(
  options: RendererScrollablePanelChromeRowsOptions,
): RendererScrollablePanelChromeRowsProjection {
  const projection = projectRendererScrollableLineWindow({
    lines: options.body,
    viewportRows: options.viewportRows,
    scrollTop: options.scrollTop,
    followTail: options.followTail,
    fill: options.fill,
  });
  const scrollFooter = options.scrollFooter?.(projection);
  const footer = [
    ...(options.footer ?? []),
    ...(scrollFooter === undefined
      ? []
      : [options.scrollFooterStyle?.(scrollFooter) ?? scrollFooter]),
  ];
  const rows = renderRendererPanelChromeRows({
    width: options.width,
    title: options.title,
    titleSuffix: options.titleSuffix,
    hint: options.hint,
    body: projection.lines,
    footer,
    bodyTopGap: options.bodyTopGap,
    footerTopGap: options.footerTopGap,
    dividerLineStyle: options.dividerLineStyle,
    dividerStyle: options.dividerStyle,
    titleStyle: options.titleStyle,
    hintStyle: options.hintStyle,
    ellipsis: options.ellipsis,
  });
  return {
    ...projection,
    rows,
  };
}

export interface RendererFrameRowsOptions {
  readonly title?: string;
  readonly content: readonly string[];
  readonly width: number;
  readonly height: number;
  readonly borderKind?: RendererFrameBorderKind;
  readonly paddingX?: number;
  readonly paddingLeft?: number;
  readonly paddingRight?: number;
  readonly titlePlacement?: RendererFrameTitlePlacement;
  readonly bottomBorder?: boolean;
  readonly borderStyle?: (text: string) => string;
  readonly titleStyle?: (text: string) => string;
  readonly ellipsis?: string;
}

export type RendererFrameBorderKind = 'square' | 'rounded';
export type RendererFrameTitlePlacement = 'inset' | 'flush';

export interface RendererScrollableFrameRowsFormatContext<TLine = string> {
  readonly line: TLine;
  readonly index: number;
  readonly sourceIndex: number;
  readonly contentWidth: number;
  readonly projection: RendererScrollableLineWindowProjection<TLine>;
}

export interface RendererScrollableFrameRowsOptions<TLine = string>
  extends Omit<RendererFrameRowsOptions, 'content'> {
  readonly viewport: RendererScrollableLineViewport;
  readonly body: readonly TLine[];
  readonly viewportRows?: number;
  readonly fill?: TLine;
  readonly formatLine?: (
    context: RendererScrollableFrameRowsFormatContext<TLine>,
  ) => string;
}

export interface RendererScrollableFrameRowsProjection<TLine = string>
  extends RendererScrollableLineWindowProjection<TLine> {
  readonly rows: readonly string[];
  readonly contentWidth: number;
}

export interface RendererStableScrollableFrameRowsOptions
  extends Omit<RendererFrameRowsOptions, 'content' | 'height' | 'title'> {
  readonly viewport: RendererStableScrollableLineViewport;
  readonly body: readonly string[];
  readonly maxViewportRows?: number;
  readonly fill?: string;
  readonly title?:
    | string
    | ((context: RendererStableScrollableFrameTitleContext) => string | undefined);
}

export interface RendererStableScrollableFrameTitleContext
  extends RendererStableScrollableLineWindowProjection {
  readonly projection: RendererStableScrollableLineWindowProjection;
  readonly frameWidth: number;
  readonly titleWidth: number;
}

export interface RendererStableScrollableFrameRowsProjection
  extends RendererStableScrollableLineWindowProjection {
  readonly rows: readonly string[];
}

interface RendererFrameBorderGlyphs {
  readonly topLeft: string;
  readonly topRight: string;
  readonly bottomLeft: string;
  readonly bottomRight: string;
  readonly horizontal: string;
  readonly vertical: string;
}

const RENDERER_FRAME_BORDERS: Record<RendererFrameBorderKind, RendererFrameBorderGlyphs> = {
  square: {
    topLeft: '┌',
    topRight: '┐',
    bottomLeft: '└',
    bottomRight: '┘',
    horizontal: '─',
    vertical: '│',
  },
  rounded: {
    topLeft: '╭',
    topRight: '╮',
    bottomLeft: '╰',
    bottomRight: '╯',
    horizontal: '─',
    vertical: '│',
  },
};

export function renderRendererFrameRows(options: RendererFrameRowsOptions): string[] {
  const width = normalizeRenderWidth(options.width);
  const height = normalizeLineCount(options.height);
  if (height <= 0) return [];
  const bottomBorder = options.bottomBorder ?? true;
  const minimumHeight = bottomBorder ? 2 : 1;
  if (height < minimumHeight || width < 4) {
    return Array.from({ length: height }, () => ' '.repeat(width));
  }

  const border = options.borderStyle ?? ((text: string) => text);
  const glyphs = RENDERER_FRAME_BORDERS[options.borderKind ?? 'square'];
  const innerWidth = width - 2;
  const innerHeight = height - (bottomBorder ? 2 : 1);
  const { contentWidth, leftPaddingWidth, rightPaddingWidth } =
    resolveRendererFrameHorizontalMetrics(options);
  const horizontal = glyphs.horizontal;
  const leftPadding = ' '.repeat(leftPaddingWidth);
  const rightPadding = ' '.repeat(rightPaddingWidth);
  const title = options.title ?? '';
  const titleStyled = title.length > 0 ? options.titleStyle?.(title) ?? title : '';
  const topMiddle = renderRendererFrameTopMiddle({
    border,
    horizontal,
    innerWidth,
    titleStyled,
    titlePlacement: options.titlePlacement ?? 'inset',
  });
  const lines = [border(glyphs.topLeft) + topMiddle + border(glyphs.topRight)];

  for (let index = 0; index < innerHeight; index++) {
    const inner = fitRendererFrameRow(options.content[index] ?? '', contentWidth, options.ellipsis);
    lines.push(border(glyphs.vertical) + leftPadding + inner + rightPadding + border(glyphs.vertical));
  }
  if (bottomBorder) {
    lines.push(border(glyphs.bottomLeft + horizontal.repeat(innerWidth) + glyphs.bottomRight));
  }
  return lines;
}

export function fitRendererFrameTitle(title: string, width: number, ellipsis = ''): string {
  const safeWidth = normalizeRenderWidth(width);
  if (safeWidth <= 0) return '';
  return visibleWidth(title) > safeWidth ? truncateToWidth(title, safeWidth, ellipsis) : title;
}

export function fitRendererLineToWidth(line: string, width: number, ellipsis = ''): string {
  if (width <= 0) return '';
  let output = line;
  if (visibleWidth(output) > width) output = truncateToWidth(output, width, ellipsis);
  return output + ' '.repeat(Math.max(0, width - visibleWidth(output)));
}

export function formatRendererScrollPosition(
  window: Pick<
    RendererScrollableLineViewportSnapshot,
    'lineFrom' | 'lineTo' | 'contentRows' | 'scrollPercent'
  >,
): string {
  return ` ${String(window.lineFrom)}-${String(window.lineTo)} / ${String(window.contentRows)} (${String(window.scrollPercent)}%) `;
}

export function renderRendererFooterRow(options: {
  readonly width: number;
  readonly left: string;
  readonly right?: string;
  readonly minGap?: number;
  readonly ellipsis?: string;
}): string {
  const width = normalizeRenderWidth(options.width);
  if (width <= 0) return '';
  const right = options.right ?? '';
  const gap = normalizeLineCount(options.minGap ?? 2);
  const leftWidth = visibleWidth(options.left);
  const rightWidth = visibleWidth(right);
  if (right.length > 0 && leftWidth + gap + rightWidth <= width) {
    return options.left + ' '.repeat(width - leftWidth - rightWidth) + right;
  }
  return fitRendererLineToWidth(options.left, width, options.ellipsis);
}

export function renderRendererScrollableFrameRows<TLine = string>(
  options: RendererScrollableFrameRowsOptions<TLine>,
): RendererScrollableFrameRowsProjection<TLine> {
  const height = normalizeLineCount(options.height);
  const bottomBorder = options.bottomBorder ?? true;
  const viewportRows = options.viewportRows ?? Math.max(0, height - (bottomBorder ? 2 : 1));
  const projection = options.viewport.project({
    lines: options.body,
    viewportRows,
    fill: options.fill,
  });
  const { contentWidth } = resolveRendererFrameHorizontalMetrics(options);
  const content = projection.lines.map((line, index) => {
    const formatted = options.formatLine?.({
      line,
      index,
      sourceIndex: projection.start + index,
      contentWidth,
      projection,
    });
    return formatted ?? String(line);
  });
  const rows = renderRendererFrameRows({
    ...options,
    content,
  });
  return {
    ...projection,
    rows,
    contentWidth,
  };
}

export function renderRendererStableScrollableFrameRows(
  options: RendererStableScrollableFrameRowsOptions,
): RendererStableScrollableFrameRowsProjection {
  const projection = options.viewport.project({
    lines: options.body,
    maxViewportRows: options.maxViewportRows,
    fill: options.fill,
  });
  const bottomBorder = options.bottomBorder ?? true;
  const frameWidth = normalizeRenderWidth(options.width);
  const titleWidth = Math.max(0, frameWidth - 2);
  const title = typeof options.title === 'function'
    ? options.title({ ...projection, projection, frameWidth, titleWidth })
    : options.title;
  const rows = renderRendererFrameRows({
    ...options,
    title,
    content: projection.lines,
    height: projection.lines.length + (bottomBorder ? 2 : 1),
  });
  return {
    ...projection,
    rows,
  };
}

function renderRendererFrameTopMiddle(options: {
  readonly border: (text: string) => string;
  readonly horizontal: string;
  readonly innerWidth: number;
  readonly titleStyled: string;
  readonly titlePlacement: RendererFrameTitlePlacement;
}): string {
  if (options.titleStyled.length === 0) return options.border(options.horizontal.repeat(options.innerWidth));

  if (options.titlePlacement === 'flush') {
    const titleWidth = visibleWidth(options.titleStyled);
    if (titleWidth > options.innerWidth) return options.border(options.horizontal.repeat(options.innerWidth));
    return (
      options.titleStyled +
      options.border(options.horizontal.repeat(Math.max(0, options.innerWidth - titleWidth)))
    );
  }

  const titleSegmentWidth = visibleWidth(`${options.horizontal} `) + visibleWidth(options.titleStyled) + 1;
  if (titleSegmentWidth > options.innerWidth) {
    return options.border(options.horizontal.repeat(options.innerWidth));
  }
  return (
    options.border(`${options.horizontal} `) +
    options.titleStyled +
    ' ' +
    options.border(options.horizontal.repeat(Math.max(0, options.innerWidth - titleSegmentWidth)))
  );
}

function fitRendererFrameRow(line: string, width: number, ellipsis = ''): string {
  return fitRendererLineToWidth(line, width, ellipsis);
}

function resolveRendererFrameHorizontalMetrics(options: {
  readonly width: number;
  readonly paddingX?: number;
  readonly paddingLeft?: number;
  readonly paddingRight?: number;
}): {
  readonly contentWidth: number;
  readonly leftPaddingWidth: number;
  readonly rightPaddingWidth: number;
} {
  const width = normalizeRenderWidth(options.width);
  const innerWidth = Math.max(0, width - 2);
  const paddingX = normalizeLineCount(options.paddingX ?? 0);
  const leftPaddingWidth = Math.min(
    normalizeLineCount(options.paddingLeft ?? paddingX),
    innerWidth,
  );
  const rightPaddingWidth = Math.min(
    normalizeLineCount(options.paddingRight ?? paddingX),
    Math.max(0, innerWidth - leftPaddingWidth),
  );
  return {
    contentWidth: Math.max(0, innerWidth - leftPaddingWidth - rightPaddingWidth),
    leftPaddingWidth,
    rightPaddingWidth,
  };
}

function normalizeLineCount(value: number): number {
  return Number.isFinite(value) && value > 0 ? Math.floor(value) : 0;
}

function normalizeRenderWidth(value: number): number {
  return Number.isFinite(value) && value > 0 ? Math.floor(value) : 0;
}
