import type { RendererCell, RendererCellStyle } from './cell-buffer';
import { renderRendererDividerRow } from './component-primitives';
import type { RendererRect, RendererRegionLine } from './compositor';
import type { RendererFrameRegion } from './layout-frame';
import { measureDisplayWidth, textToCells, truncateDisplayText } from './text-metrics';

export type RendererOverlayPlacement =
  | 'top-left'
  | 'top-right'
  | 'bottom-left'
  | 'bottom-right'
  | 'top'
  | 'bottom'
  | 'center';

export interface RendererOverlayPanelStyle {
  readonly container?: RendererCellStyle;
  readonly border?: RendererCellStyle;
  readonly title?: RendererCellStyle;
  readonly body?: RendererCellStyle;
}

export type RendererOverlayPanelLineStyle = (
  line: string,
  index: number,
) => RendererCellStyle | undefined;

export interface RendererOverlayPanelOptions {
  readonly id?: string;
  readonly viewport: RendererRect;
  readonly lines: readonly string[];
  readonly title?: string;
  readonly width?: number;
  readonly minWidth?: number;
  readonly maxWidth?: number;
  readonly maxHeight?: number;
  readonly placement?: RendererOverlayPlacement;
  readonly marginX?: number;
  readonly marginY?: number;
  readonly zIndex?: number;
  readonly border?: boolean;
  readonly visible?: boolean;
  readonly style?: RendererOverlayPanelStyle;
  readonly lineStyle?: RendererOverlayPanelLineStyle;
  readonly background?: RendererCell;
  readonly truncateMark?: string;
}

export interface RendererOverlayPanelRegion extends RendererFrameRegion {
  readonly rect: RendererRect;
  readonly content: readonly RendererRegionLine[];
}

const DEFAULT_OVERLAY_Z_INDEX = 10_000;
const DEFAULT_OVERLAY_MARGIN = 1;
const DEFAULT_OVERLAY_MIN_WIDTH = 12;
const DEFAULT_OVERLAY_TRUNCATE_MARK = '...';

export function createRendererOverlayPanelRegion(
  options: RendererOverlayPanelOptions,
): RendererOverlayPanelRegion | undefined {
  const viewport = normalizeRect(options.viewport);
  if (viewport === undefined) return undefined;

  const marginX = normalizeMargin(options.marginX);
  const marginY = normalizeMargin(options.marginY);
  const availableWidth = Math.max(0, viewport.width - marginX * 2);
  const availableHeight = Math.max(0, viewport.height - marginY * 2);
  if (availableWidth <= 0 || availableHeight <= 0) return undefined;

  const border = options.border !== false;
  const maxWidth = Math.min(
    availableWidth,
    normalizeDimension(options.maxWidth) ?? availableWidth,
  );
  const maxHeight = Math.min(
    availableHeight,
    normalizeDimension(options.maxHeight) ?? availableHeight,
  );
  if (maxWidth <= 0 || maxHeight <= 0) return undefined;
  if (border && (maxWidth < 2 || maxHeight < 2)) return undefined;

  const minWidth = Math.min(
    maxWidth,
    Math.max(border ? 2 : 1, normalizeDimension(options.minWidth) ?? DEFAULT_OVERLAY_MIN_WIDTH),
  );
  const naturalWidth = measurePanelWidth(options.lines, options.title, border);
  const requestedWidth = normalizeDimension(options.width) ?? naturalWidth;
  const width = clamp(requestedWidth, minWidth, maxWidth);
  const contentWidth = border ? width - 2 : width;
  if (contentWidth <= 0) return undefined;

  const bodyCapacity = border ? Math.max(0, maxHeight - 2) : maxHeight;
  if (!border && bodyCapacity <= 0) return undefined;

  const truncateMark = options.truncateMark ?? DEFAULT_OVERLAY_TRUNCATE_MARK;
  const bodyLines = selectBodyLines(options.lines, bodyCapacity);
  const content = border
    ? renderBorderedPanelLines(bodyLines, options, width, contentWidth, truncateMark)
    : renderBodyLines(bodyLines, options, contentWidth, truncateMark);
  if (content.length === 0) return undefined;

  const rect = placeOverlayPanel(
    viewport,
    { width, height: content.length },
    options.placement ?? 'top-right',
    { x: marginX, y: marginY },
  );
  const containerStyle = options.style?.container;

  return {
    id: options.id,
    rect,
    content,
    zIndex: options.zIndex ?? DEFAULT_OVERLAY_Z_INDEX,
    visible: options.visible,
    clear: true,
    background: options.background ?? { char: ' ', style: containerStyle },
  };
}

function renderBorderedPanelLines(
  lines: readonly string[],
  options: RendererOverlayPanelOptions,
  width: number,
  contentWidth: number,
  truncateMark: string,
): readonly RendererRegionLine[] {
  return [
    renderPanelTopBorder(options.title, contentWidth, options.style, truncateMark),
    ...lines.map((line, index) => renderPanelBodyLine(line, index, options, contentWidth, truncateMark)),
    textToCells(
      `╰${renderRendererDividerRow({ width: width - 2 })}╯`,
      panelBorderStyle(options.style),
    ),
  ];
}

function renderBodyLines(
  lines: readonly string[],
  options: RendererOverlayPanelOptions,
  contentWidth: number,
  truncateMark: string,
): readonly RendererRegionLine[] {
  return lines.map((line, index) => textToCells(
    fitOverlayLine(line, contentWidth, truncateMark),
    panelBodyStyle(options.style, options.lineStyle?.(line, index)),
  ));
}

function renderPanelTopBorder(
  title: string | undefined,
  contentWidth: number,
  style: RendererOverlayPanelStyle | undefined,
  truncateMark: string,
): readonly RendererCell[] {
  const borderStyle = panelBorderStyle(style);
  const titleText = title?.trim() ?? '';
  if (titleText.length === 0) {
    return textToCells(
      `╭${renderRendererDividerRow({ width: contentWidth })}╮`,
      borderStyle,
    );
  }

  const label = truncateDisplayText(` ${titleText} `, contentWidth, truncateMark);
  const labelWidth = measureDisplayWidth(label);
  return [
    ...textToCells('╭', borderStyle),
    ...textToCells(label, panelTitleStyle(style)),
    ...textToCells(
      renderRendererDividerRow({ width: Math.max(0, contentWidth - labelWidth) }),
      borderStyle,
    ),
    ...textToCells('╮', borderStyle),
  ];
}

function renderPanelBodyLine(
  rawLine: RendererRegionLine,
  index: number,
  options: RendererOverlayPanelOptions,
  contentWidth: number,
  truncateMark: string,
): readonly RendererCell[] {
  const line = regionLineToString(rawLine);
  return [
    ...textToCells('│', panelBorderStyle(options.style)),
    ...textToCells(
      fitOverlayLine(line, contentWidth, truncateMark),
      panelBodyStyle(options.style, options.lineStyle?.(line, index)),
    ),
    ...textToCells('│', panelBorderStyle(options.style)),
  ];
}

function selectBodyLines(lines: readonly string[], capacity: number): readonly string[] {
  if (capacity <= 0) return [];
  if (lines.length <= capacity) return lines;
  const visible = lines.slice(0, capacity);
  visible[capacity - 1] = `+${String(lines.length - capacity + 1)} more`;
  return visible;
}

function measurePanelWidth(
  lines: readonly string[],
  title: string | undefined,
  border: boolean,
): number {
  const titleWidth = title === undefined || title.trim().length === 0
    ? 0
    : measureDisplayWidth(` ${title.trim()} `);
  const bodyWidth = lines.reduce(
    (maxWidth, line) => Math.max(maxWidth, measureDisplayWidth(line)),
    0,
  );
  return Math.max(1, Math.max(titleWidth, bodyWidth)) + (border ? 2 : 0);
}

function panelBorderStyle(style: RendererOverlayPanelStyle | undefined): RendererCellStyle | undefined {
  return mergeCellStyles(style?.container, style?.border);
}

function panelTitleStyle(style: RendererOverlayPanelStyle | undefined): RendererCellStyle | undefined {
  return mergeCellStyles(style?.container, style?.title ?? style?.border);
}

function panelBodyStyle(
  style: RendererOverlayPanelStyle | undefined,
  lineStyle: RendererCellStyle | undefined,
): RendererCellStyle | undefined {
  return mergeCellStyles(mergeCellStyles(style?.container, style?.body), lineStyle);
}

function mergeCellStyles(
  base: RendererCellStyle | undefined,
  overrides: RendererCellStyle | undefined,
): RendererCellStyle | undefined {
  if (base === undefined) return overrides;
  if (overrides === undefined) return base;
  return {
    fg: overrides.fg ?? base.fg,
    bg: overrides.bg ?? base.bg,
    bold: overrides.bold ?? base.bold,
    dim: overrides.dim ?? base.dim,
    italic: overrides.italic ?? base.italic,
    underline: overrides.underline ?? base.underline,
    inverse: overrides.inverse ?? base.inverse,
  };
}

function fitOverlayLine(line: string, width: number, truncateMark: string): string {
  const fitted = truncateDisplayText(line, width, truncateMark);
  return fitted + ' '.repeat(Math.max(0, width - measureDisplayWidth(fitted)));
}

function regionLineToString(line: RendererRegionLine): string {
  if (typeof line === 'string') return line;
  return line.map((cell) => cell.char).join('');
}

function placeOverlayPanel(
  viewport: RendererRect,
  size: { readonly width: number; readonly height: number },
  placement: RendererOverlayPlacement,
  margin: { readonly x: number; readonly y: number },
): RendererRect {
  const left = viewport.x + margin.x;
  const right = viewport.x + viewport.width - size.width - margin.x;
  const top = viewport.y + margin.y;
  const bottom = viewport.y + viewport.height - size.height - margin.y;
  const centerX = viewport.x + Math.floor((viewport.width - size.width) / 2);
  const centerY = viewport.y + Math.floor((viewport.height - size.height) / 2);

  let x = right;
  let y = top;
  if (placement === 'top-left') {
    x = left;
    y = top;
  } else if (placement === 'bottom-left') {
    x = left;
    y = bottom;
  } else if (placement === 'bottom-right') {
    x = right;
    y = bottom;
  } else if (placement === 'top') {
    x = centerX;
    y = top;
  } else if (placement === 'bottom') {
    x = centerX;
    y = bottom;
  } else if (placement === 'center') {
    x = centerX;
    y = centerY;
  }

  return {
    x: clamp(x, viewport.x, viewport.x + viewport.width - size.width),
    y: clamp(y, viewport.y, viewport.y + viewport.height - size.height),
    width: size.width,
    height: size.height,
  };
}

function normalizeRect(rect: RendererRect): RendererRect | undefined {
  if (!Number.isFinite(rect.x) || !Number.isFinite(rect.y)) return undefined;
  if (!Number.isFinite(rect.width) || !Number.isFinite(rect.height)) return undefined;
  const normalized = {
    x: Math.floor(rect.x),
    y: Math.floor(rect.y),
    width: Math.floor(rect.width),
    height: Math.floor(rect.height),
  };
  if (normalized.width <= 0 || normalized.height <= 0) return undefined;
  return normalized;
}

function normalizeMargin(value: number | undefined): number {
  if (value === undefined || !Number.isFinite(value) || value < 0) return DEFAULT_OVERLAY_MARGIN;
  return Math.floor(value);
}

function normalizeDimension(value: number | undefined): number | undefined {
  if (value === undefined || !Number.isFinite(value) || value <= 0) return undefined;
  return Math.floor(value);
}

function clamp(value: number, min: number, max: number): number {
  if (max < min) return min;
  return Math.min(max, Math.max(min, value));
}
