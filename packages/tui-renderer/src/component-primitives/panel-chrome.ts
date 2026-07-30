import { truncateToWidth } from '../text-component';
import {
  renderRendererDividerRow,
  type RendererDividerLineStyle,
} from './divider';
import { normalizeRenderWidth } from './normalize';
import {
  projectRendererScrollableLineWindow,
  type RendererScrollableLineWindowProjection,
} from '../viewport';

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
