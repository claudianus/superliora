import type { RendererCellStyle } from '../cell-buffer';
import { renderRendererDividerRow } from '../component-primitives';
import {
  DEFAULT_DIAGNOSTICS_PANEL_WIDTH,
  MIN_DIAGNOSTICS_PANEL_WIDTH,
  PANEL_TRUNCATION_MARK,
  type RendererDiagnosticsOverlayOptions,
  type RendererDiagnosticsPanelOptions,
  type RendererDiagnosticsSeverity,
  type RendererDiagnosticsSnapshot,
} from './types';
import { formatRendererDiagnosticsLines } from './format';
import {
  createRendererOverlayPanelRegion,
  type RendererOverlayPanelLineStyle,
  type RendererOverlayPanelRegion,
  type RendererOverlayPanelStyle,
} from '../overlay';
import { measureDisplayWidth, truncateDisplayText } from '../text-metrics';
import { rendererDarkTheme, rendererThemeStyle, type RendererTheme } from '../theme';

export function formatRendererDiagnosticsPanel(
  diagnostics: RendererDiagnosticsSnapshot,
  options: RendererDiagnosticsPanelOptions = {},
): readonly string[] {
  const width = normalizePanelWidth(options.width);
  const lines = formatRendererDiagnosticsLines(diagnostics, options);
  if (options.border === false) {
    return lines.map((line) => fitPanelLine(line, width));
  }

  const innerWidth = width - 2;
  return [
    formatPanelTopBorder(innerWidth, options.title ?? 'Renderer'),
    ...lines.map((line) => `│${fitPanelLine(line, innerWidth)}│`),
    `╰${renderRendererDividerRow({ width: innerWidth })}╯`,
  ];
}

export function createRendererDiagnosticsOverlayRegion(
  diagnostics: RendererDiagnosticsSnapshot,
  options: RendererDiagnosticsOverlayOptions,
): RendererOverlayPanelRegion | undefined {
  const theme = options.theme ?? rendererDarkTheme;
  return createRendererOverlayPanelRegion({
    id: options.id ?? 'renderer-diagnostics',
    viewport: options.viewport,
    lines: formatRendererDiagnosticsLines(diagnostics, {
      maxIssues: options.maxIssues,
      includeIssues: options.includeIssues,
      layout: options.layout,
    }),
    title: options.title ?? 'Renderer',
    width: options.width,
    minWidth: options.minWidth,
    maxWidth: options.maxWidth,
    maxHeight: options.maxHeight,
    placement: options.placement,
    marginX: options.marginX,
    marginY: options.marginY,
    zIndex: options.zIndex,
    border: options.border,
    visible: options.visible,
    style: options.style ?? rendererDiagnosticsOverlayStyle(theme, diagnostics.severity),
    lineStyle: options.lineStyle ?? rendererDiagnosticsLineStyle(theme),
    background: options.background,
    truncateMark: options.truncateMark,
  });
}

function normalizePanelWidth(value: number | undefined): number {
  if (value === undefined || !Number.isFinite(value)) return DEFAULT_DIAGNOSTICS_PANEL_WIDTH;
  return Math.max(MIN_DIAGNOSTICS_PANEL_WIDTH, Math.floor(value));
}

function formatPanelTopBorder(innerWidth: number, title: string): string {
  const normalizedTitle = title.trim();
  if (normalizedTitle.length === 0) {
    return `╭${renderRendererDividerRow({ width: innerWidth })}╮`;
  }
  const label = truncateDisplayText(` ${normalizedTitle} `, innerWidth, PANEL_TRUNCATION_MARK);
  const padding = Math.max(0, innerWidth - measureDisplayWidth(label));
  return `╭${label}${renderRendererDividerRow({ width: padding })}╮`;
}

function fitPanelLine(line: string, width: number): string {
  const fitted = truncateDisplayText(line, width, PANEL_TRUNCATION_MARK);
  const padding = Math.max(0, width - measureDisplayWidth(fitted));
  return fitted + ' '.repeat(padding);
}

function rendererDiagnosticsOverlayStyle(
  theme: RendererTheme,
  severity: RendererDiagnosticsSeverity,
): RendererOverlayPanelStyle {
  const severityToken = severity === 'degraded'
    ? 'danger'
    : severity === 'watch'
      ? 'warning'
      : 'success';
  return {
    container: rendererThemeStyle(theme, 'panelRaised'),
    border: rendererThemeStyle(theme, severityToken, { bg: 'surfaceRaised' }),
    title: rendererThemeStyle(theme, severityToken, { bg: 'surfaceRaised', bold: true }),
    body: rendererThemeStyle(theme, 'muted', { bg: 'surfaceRaised' }),
  };
}

function rendererDiagnosticsLineStyle(theme: RendererTheme): RendererOverlayPanelLineStyle {
  return (line): RendererCellStyle | undefined => {
    if (line.startsWith('degraded:')) {
      return rendererThemeStyle(theme, 'danger', { bg: 'surfaceRaised' });
    }
    if (line.startsWith('watch:')) {
      return rendererThemeStyle(theme, 'warning', { bg: 'surfaceRaised' });
    }
    return undefined;
  };
}
