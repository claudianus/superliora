import { truncateToWidth, visibleWidth } from './text-component';
import { normalizeLineCount, normalizeRenderWidth } from './component-primitives-normalize';
import {
  type RendererScrollableLineViewportSnapshot,
  type RendererScrollableLineWindowProjection,
  type RendererScrollableLineViewport,
  type RendererStableScrollableLineViewport,
  type RendererStableScrollableLineWindowProjection,
} from './viewport';

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
