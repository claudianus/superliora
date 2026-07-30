import { truncateToWidth, visibleWidth } from './text-component';
import { normalizeLineCount, normalizeRenderWidth } from './component-primitives-normalize';

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
