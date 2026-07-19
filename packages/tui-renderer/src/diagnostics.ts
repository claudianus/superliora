import type { RendererCell, RendererCellStyle } from './cell-buffer';
import { renderRendererDividerRow } from './component-primitives';
import type { RendererRect } from './compositor';
import type { RendererDamageScanStrategy } from './damage';
import type {
  RendererFrameOutputDecisionReason,
  RendererFrameOutputMode,
} from './frame-output-policy';
import type { NativeFrameStatsSnapshot, NativeFrameStatsHealth } from './frame-stats';
import {
  createRendererOverlayPanelRegion,
  type RendererOverlayPanelLineStyle,
  type RendererOverlayPanelRegion,
  type RendererOverlayPanelStyle,
  type RendererOverlayPlacement,
} from './overlay';
import type { RendererQualitySnapshot } from './quality';
import { measureDisplayWidth, truncateDisplayText } from './text-metrics';
import type { NativeTerminalSynchronizedOutputProbeResult } from './terminal-probe';
import { rendererDarkTheme, rendererThemeStyle, type RendererTheme } from './theme';

export type RendererDiagnosticsSeverity = 'ok' | 'watch' | 'degraded';

export type RendererDiagnosticsIssueCode =
  | 'frame-budget'
  | 'phase'
  | 'quality'
  | 'output-volume'
  | 'output-backpressure'
  | 'terminal-capability'
  | 'composition-cache'
  | 'line-cache';

export interface RendererDiagnosticsIssue {
  readonly code: RendererDiagnosticsIssueCode;
  readonly severity: Exclude<RendererDiagnosticsSeverity, 'ok'>;
  readonly message: string;
  readonly value: number | string;
  readonly threshold?: number;
}

export interface RendererDiagnosticsOptions {
  readonly phaseBudgetRatioWatch?: number;
  readonly phaseBudgetRatioDegraded?: number;
  readonly dominantPhaseRatioWatch?: number;
  readonly outputBytesWatch?: number;
  readonly outputBytesDegraded?: number;
  readonly changedCellRatioWatch?: number;
  readonly changedCellRatioDegraded?: number;
  readonly minCompositionRowsForCacheIssue?: number;
  readonly compositionReuseWatchBelow?: number;
  readonly minLineCacheLookupsForIssue?: number;
  readonly lineCacheHitWatchBelow?: number;
  readonly synchronizedOutputProbeResult?: NativeTerminalSynchronizedOutputProbeResult;
  readonly synchronizedOutputEnabled?: boolean;
}

export interface RendererDiagnosticsSnapshot {
  readonly severity: RendererDiagnosticsSeverity;
  readonly health: NativeFrameStatsHealth;
  readonly frames: number;
  readonly windowFrames: number;
  readonly quality?: RendererQualitySnapshot;
  readonly avgDurationMs: number;
  readonly p95DurationMs: number;
  readonly p99DurationMs: number;
  readonly maxDurationMs: number;
  readonly avgRenderCallbackDurationMs: number;
  readonly maxRenderCallbackDurationMs: number;
  readonly avgPresentDurationMs: number;
  readonly maxPresentDurationMs: number;
  readonly avgDiffDurationMs: number;
  readonly maxDiffDurationMs: number;
  readonly avgEncodeDurationMs: number;
  readonly maxEncodeDurationMs: number;
  readonly avgWriteDurationMs: number;
  readonly maxWriteDurationMs: number;
  readonly avgQualityDurationMs: number;
  readonly maxQualityDurationMs: number;
  readonly dominantPhase: RendererDiagnosticsPhase;
  readonly dominantPhaseDurationMs: number;
  readonly dominantPhaseRatio: number;
  readonly avgFrameIntervalMs: number;
  readonly avgFps: number;
  readonly overBudgetRatio: number;
  readonly avgFrameBudgetRatio: number;
  readonly avgScanRatio: number;
  readonly maxScanRatio: number;
  readonly avgDamageRatio: number;
  readonly maxDamageRatio: number;
  readonly dominantScanStrategy: RendererDamageScanStrategy;
  readonly avgOutputBytes: number;
  readonly outputBackpressureFrames: number;
  readonly outputBackpressureRatio: number;
  readonly avgOutputCells: number;
  readonly avgOutputRuns: number;
  readonly avgOutputBridgedCells: number;
  readonly avgOutputBridgedCellRatio: number;
  readonly avgCursorAbsoluteMoves: number;
  readonly avgCursorRelativeMoves: number;
  readonly avgCursorHorizontalAbsoluteMoves: number;
  readonly avgCursorMoveBytes: number;
  readonly avgCursorMoveSavedBytes: number;
  readonly avgChangedCellRatio: number;
  readonly avgCompositionReuseRatio: number;
  readonly avgLineCacheHitRatio: number;
  readonly lastOutputMode?: RendererFrameOutputMode;
  readonly lastOutputSynchronized?: boolean;
  readonly lastOutputLargeFrame?: boolean;
  readonly lastOutputPolicyReason?: RendererFrameOutputDecisionReason;
  readonly lastOutputEraseLine?: boolean;
  readonly synchronizedOutputSupport?: NativeTerminalSynchronizedOutputProbeResult['support'];
  readonly synchronizedOutputProbeTimedOut?: boolean;
  readonly synchronizedOutputProbeAborted?: boolean;
  readonly synchronizedOutputEnabled?: boolean;
  readonly frameTimeSparkline: string;
  readonly issues: readonly RendererDiagnosticsIssue[];
}

export type RendererDiagnosticsLayout = 'compact' | 'expanded';

export interface RendererDiagnosticsFormatOptions {
  readonly maxIssues?: number;
  readonly includeIssues?: boolean;
  readonly layout?: RendererDiagnosticsLayout;
}

export interface RendererDiagnosticsPanelOptions extends RendererDiagnosticsFormatOptions {
  readonly width?: number;
  readonly title?: string;
  readonly border?: boolean;
}

export interface RendererDiagnosticsOverlayOptions extends RendererDiagnosticsFormatOptions {
  readonly id?: string;
  readonly viewport: RendererRect;
  readonly width?: number;
  readonly minWidth?: number;
  readonly maxWidth?: number;
  readonly maxHeight?: number;
  readonly placement?: RendererOverlayPlacement;
  readonly marginX?: number;
  readonly marginY?: number;
  readonly zIndex?: number;
  readonly title?: string;
  readonly border?: boolean;
  readonly visible?: boolean;
  readonly theme?: RendererTheme;
  readonly style?: RendererOverlayPanelStyle;
  readonly lineStyle?: RendererOverlayPanelLineStyle;
  readonly background?: RendererCell;
  readonly truncateMark?: string;
}

const DEFAULT_OUTPUT_BYTES_WATCH = 16 * 1024;
const DEFAULT_OUTPUT_BYTES_DEGRADED = 64 * 1024;
const DEFAULT_PHASE_BUDGET_RATIO_WATCH = 0.5;
const DEFAULT_PHASE_BUDGET_RATIO_DEGRADED = 0.85;
const DEFAULT_DOMINANT_PHASE_RATIO_WATCH = 0.6;
const DEFAULT_CHANGED_CELL_RATIO_WATCH = 0.5;
const DEFAULT_CHANGED_CELL_RATIO_DEGRADED = 0.85;
const DEFAULT_MIN_COMPOSITION_ROWS_FOR_CACHE_ISSUE = 24;
const DEFAULT_COMPOSITION_REUSE_WATCH_BELOW = 0.2;
const DEFAULT_MIN_LINE_CACHE_LOOKUPS_FOR_ISSUE = 24;
const DEFAULT_LINE_CACHE_HIT_WATCH_BELOW = 0.2;
const DEFAULT_DIAGNOSTICS_PANEL_WIDTH = 72;
const MIN_DIAGNOSTICS_PANEL_WIDTH = 12;
const PANEL_TRUNCATION_MARK = '...';
const FRAME_TIME_SPARKLINE_WIDTH = 16;
const SPARKLINE_LEVELS = '▁▂▃▄▅▆▇█';

export type RendererDiagnosticsPhase =
  | 'render'
  | 'present'
  | 'diff'
  | 'encode'
  | 'write'
  | 'quality'
  | 'none';

interface RendererDiagnosticsDominantPhase {
  readonly phase: RendererDiagnosticsPhase;
  readonly durationMs: number;
  readonly ratio: number;
}

export function diagnoseNativeRendererStats(
  stats: NativeFrameStatsSnapshot,
  quality?: RendererQualitySnapshot,
  options: RendererDiagnosticsOptions = {},
): RendererDiagnosticsSnapshot {
  const dominantPhase = resolveDominantPhase(stats);
  const issues = [
    frameBudgetIssue(stats),
    phaseIssue(stats, dominantPhase, options),
    qualityIssue(quality),
    outputVolumeIssue(stats, options),
    outputBackpressureIssue(stats),
    terminalCapabilityIssue(options),
    compositionCacheIssue(stats, options),
    lineCacheIssue(stats, options),
  ].filter((issue): issue is RendererDiagnosticsIssue => issue !== undefined);

  return {
    severity: maxDiagnosticsSeverity([stats.health, ...issues.map((issue) => issue.severity)]),
    health: stats.health,
    frames: stats.frames,
    windowFrames: stats.windowFrames,
    quality,
    avgDurationMs: stats.avgDurationMs,
    p95DurationMs: stats.p95DurationMs,
    p99DurationMs: stats.p99DurationMs,
    maxDurationMs: stats.maxDurationMs,
    avgRenderCallbackDurationMs: stats.avgRenderCallbackDurationMs,
    maxRenderCallbackDurationMs: stats.maxRenderCallbackDurationMs,
    avgPresentDurationMs: stats.avgPresentDurationMs,
    maxPresentDurationMs: stats.maxPresentDurationMs,
    avgDiffDurationMs: stats.avgDiffDurationMs,
    maxDiffDurationMs: stats.maxDiffDurationMs,
    avgEncodeDurationMs: stats.avgEncodeDurationMs,
    maxEncodeDurationMs: stats.maxEncodeDurationMs,
    avgWriteDurationMs: stats.avgWriteDurationMs,
    maxWriteDurationMs: stats.maxWriteDurationMs,
    avgQualityDurationMs: stats.avgQualityDurationMs,
    maxQualityDurationMs: stats.maxQualityDurationMs,
    dominantPhase: dominantPhase.phase,
    dominantPhaseDurationMs: dominantPhase.durationMs,
    dominantPhaseRatio: dominantPhase.ratio,
    avgFrameIntervalMs: stats.avgFrameIntervalMs,
    avgFps: stats.avgFps,
    overBudgetRatio: stats.overBudgetRatio,
    avgFrameBudgetRatio: stats.avgFrameBudgetRatio,
    avgScanRatio: stats.avgScanRatio,
    maxScanRatio: stats.maxScanRatio,
    avgDamageRatio: stats.avgDamageRatio,
    maxDamageRatio: stats.maxDamageRatio,
    dominantScanStrategy: stats.dominantScanStrategy,
    avgOutputBytes: stats.avgOutputBytes,
    outputBackpressureFrames: stats.outputBackpressureFrames,
    outputBackpressureRatio: stats.outputBackpressureRatio,
    avgOutputCells: stats.avgOutputCells,
    avgOutputRuns: stats.avgOutputRuns,
    avgOutputBridgedCells: stats.avgOutputBridgedCells,
    avgOutputBridgedCellRatio: stats.avgOutputBridgedCellRatio,
    avgCursorAbsoluteMoves: stats.avgCursorAbsoluteMoves,
    avgCursorRelativeMoves: stats.avgCursorRelativeMoves,
    avgCursorHorizontalAbsoluteMoves: stats.avgCursorHorizontalAbsoluteMoves,
    avgCursorMoveBytes: stats.avgCursorMoveBytes,
    avgCursorMoveSavedBytes: stats.avgCursorMoveSavedBytes,
    avgChangedCellRatio: stats.avgChangedCellRatio,
    avgCompositionReuseRatio: stats.avgCompositionReuseRatio,
    avgLineCacheHitRatio: stats.avgLineCacheHitRatio,
    lastOutputMode: stats.last?.outputMode,
    lastOutputSynchronized: stats.last?.outputSynchronized,
    lastOutputLargeFrame: stats.last?.outputLargeFrame,
    lastOutputPolicyReason: stats.last?.outputPolicyReason,
    lastOutputEraseLine: stats.last?.outputEraseLine,
    synchronizedOutputSupport: options.synchronizedOutputProbeResult?.support,
    synchronizedOutputProbeTimedOut: options.synchronizedOutputProbeResult?.timedOut,
    synchronizedOutputProbeAborted: options.synchronizedOutputProbeResult?.aborted,
    synchronizedOutputEnabled: options.synchronizedOutputEnabled,
    frameTimeSparkline: formatFrameBudgetSparkline(stats.frameBudgetRatioSamples),
    issues,
  };
}

export function diagnoseNativeRenderer(
  renderer: {
    readonly stats: NativeFrameStatsSnapshot;
    readonly quality: RendererQualitySnapshot;
  },
  options: RendererDiagnosticsOptions = {},
): RendererDiagnosticsSnapshot {
  return diagnoseNativeRendererStats(renderer.stats, renderer.quality, options);
}

export function formatRendererDiagnosticsLine(
  diagnostics: RendererDiagnosticsSnapshot,
): string {
  return [
    `renderer ${diagnostics.severity}`,
    diagnostics.avgFps <= 0 ? undefined : `${formatNumber(diagnostics.avgFps)} fps`,
    `${formatNumber(diagnostics.avgDurationMs)}ms avg`,
    `${formatNumber(diagnostics.p95DurationMs)}ms p95`,
    `${formatNumber(diagnostics.p99DurationMs)}ms p99`,
    `${formatNumber(diagnostics.maxDurationMs)}ms max`,
    diagnostics.frameTimeSparkline.length === 0
      ? undefined
      : `frames ${diagnostics.frameTimeSparkline}`,
    diagnostics.windowFrames === 0 ? undefined : formatRendererPhaseSummary(diagnostics),
    diagnostics.windowFrames === 0
      ? undefined
      : `scan ${formatPercent(diagnostics.avgScanRatio)}/${formatPercent(diagnostics.avgDamageRatio)} ${formatScanStrategy(diagnostics.dominantScanStrategy)}`,
    `${formatPercent(diagnostics.overBudgetRatio)} over`,
    `${formatBytes(diagnostics.avgOutputBytes)} avg out`,
    `${formatPercent(diagnostics.avgCompositionReuseRatio)} row cache`,
    `${formatPercent(diagnostics.avgLineCacheHitRatio)} line cache`,
    diagnostics.quality === undefined
      ? undefined
      : formatRendererQualitySummary(diagnostics.quality),
    formatRendererDiagnosticsOutputPolicyLine(diagnostics, 'compact'),
  ].filter((part): part is string => part !== undefined).join(' | ');
}

export function formatRendererDiagnosticsLines(
  diagnostics: RendererDiagnosticsSnapshot,
  options: RendererDiagnosticsFormatOptions = {},
): readonly string[] {
  const lines = options.layout === 'compact'
    ? [formatRendererDiagnosticsLine(diagnostics)]
    : formatRendererDiagnosticsExpandedLines(diagnostics);
  if (options.includeIssues === false) return lines;
  const maxIssues = normalizeMaxIssues(options.maxIssues);
  for (const issue of diagnostics.issues.slice(0, maxIssues)) {
    const threshold = issue.threshold === undefined ? '' : ` >= ${formatIssueValue(issue, issue.threshold)}`;
    lines.push(`${issue.severity}: ${issue.code} ${formatIssueValue(issue, issue.value)}${threshold}`);
  }
  return lines;
}

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

function frameBudgetIssue(stats: NativeFrameStatsSnapshot): RendererDiagnosticsIssue | undefined {
  if (stats.health === 'idle' || stats.health === 'healthy') return undefined;
  return {
    code: 'frame-budget',
    severity: stats.health === 'degraded' ? 'degraded' : 'watch',
    message: 'Renderer frame budget is under pressure.',
    value: stats.avgFrameBudgetRatio,
    threshold: stats.health === 'degraded' ? 0.9 : 0.65,
  };
}

function phaseIssue(
  stats: NativeFrameStatsSnapshot,
  phase: RendererDiagnosticsDominantPhase,
  options: RendererDiagnosticsOptions,
): RendererDiagnosticsIssue | undefined {
  if (stats.windowFrames === 0 || phase.phase === 'none') return undefined;
  const watch = options.phaseBudgetRatioWatch ?? DEFAULT_PHASE_BUDGET_RATIO_WATCH;
  const degraded = options.phaseBudgetRatioDegraded ?? DEFAULT_PHASE_BUDGET_RATIO_DEGRADED;
  const dominantRatioWatch = options.dominantPhaseRatioWatch ?? DEFAULT_DOMINANT_PHASE_RATIO_WATCH;
  const phaseBudgetRatio = phaseBudgetRatioForStats(stats, phase.durationMs);
  const dominantPressure =
    stats.health === 'healthy' || stats.health === 'idle'
      ? 0
      : phase.ratio >= dominantRatioWatch ? watch : 0;
  const pressure = Math.max(phaseBudgetRatio, dominantPressure);
  if (pressure < watch) return undefined;
  return {
    code: 'phase',
    severity: pressure >= degraded ? 'degraded' : 'watch',
    message: `Renderer ${phase.phase} phase is dominating frame time.`,
    value: `${phase.phase} ${formatNumber(phase.durationMs)}ms`,
    threshold: pressure >= degraded ? degraded : watch,
  };
}

function qualityIssue(
  quality: RendererQualitySnapshot | undefined,
): RendererDiagnosticsIssue | undefined {
  if (quality === undefined || quality.level === 'full') return undefined;
  return {
    code: 'quality',
    severity: quality.level === 'minimal' ? 'degraded' : 'watch',
    message: 'Adaptive quality controller has reduced rendering quality.',
    value: formatRendererQualitySummary(quality),
  };
}

function outputVolumeIssue(
  stats: NativeFrameStatsSnapshot,
  options: RendererDiagnosticsOptions,
): RendererDiagnosticsIssue | undefined {
  const watch = options.outputBytesWatch ?? DEFAULT_OUTPUT_BYTES_WATCH;
  const degraded = options.outputBytesDegraded ?? DEFAULT_OUTPUT_BYTES_DEGRADED;
  const changedWatch = options.changedCellRatioWatch ?? DEFAULT_CHANGED_CELL_RATIO_WATCH;
  const changedDegraded = options.changedCellRatioDegraded ?? DEFAULT_CHANGED_CELL_RATIO_DEGRADED;
  if (stats.avgOutputBytes >= degraded) {
    return {
      code: 'output-volume',
      severity: 'degraded',
      message: 'Renderer is writing many bytes each frame.',
      value: stats.avgOutputBytes,
      threshold: degraded,
    };
  }
  if (stats.avgChangedCellRatio >= changedDegraded) {
    return {
      code: 'output-volume',
      severity: 'degraded',
      message: 'Renderer is changing a large portion of terminal cells each frame.',
      value: stats.avgChangedCellRatio,
      threshold: changedDegraded,
    };
  }
  if (stats.avgOutputBytes >= watch) {
    return {
      code: 'output-volume',
      severity: 'watch',
      message: 'Renderer output bytes are elevated.',
      value: stats.avgOutputBytes,
      threshold: watch,
    };
  }
  if (stats.avgChangedCellRatio >= changedWatch) {
    return {
      code: 'output-volume',
      severity: 'watch',
      message: 'Renderer changed-cell ratio is elevated.',
      value: stats.avgChangedCellRatio,
      threshold: changedWatch,
    };
  }
  return undefined;
}

function outputBackpressureIssue(
  stats: NativeFrameStatsSnapshot,
): RendererDiagnosticsIssue | undefined {
  if (stats.outputBackpressureRatio <= 0) return undefined;
  return {
    code: 'output-backpressure',
    severity: stats.outputBackpressureRatio >= 0.5 ? 'degraded' : 'watch',
    message: 'Terminal output stream signaled backpressure.',
    value: stats.outputBackpressureRatio,
    threshold: 0,
  };
}

function terminalCapabilityIssue(
  options: RendererDiagnosticsOptions,
): RendererDiagnosticsIssue | undefined {
  const result = options.synchronizedOutputProbeResult;
  if (result === undefined || result.aborted === true || result.support === 'supported') {
    return undefined;
  }
  if (result.support === 'unsupported') {
    return {
      code: 'terminal-capability',
      severity: 'watch',
      message: 'Terminal synchronized output is unsupported; renderer disabled sync output.',
      value: 'sync unsupported',
    };
  }
  if (result.timedOut) {
    // Timeout no longer disables sync — only surface a watch note when sync
    // stayed on from terminal heuristics / prior enablement.
    if (options.synchronizedOutputEnabled === true) {
      return {
        code: 'terminal-capability',
        severity: 'watch',
        message: 'Terminal synchronized-output probe timed out; kept sync enabled.',
        value: 'sync probe timeout',
      };
    }
    return {
      code: 'terminal-capability',
      severity: 'watch',
      message: 'Terminal synchronized-output probe timed out; sync output is off.',
      value: 'sync unknown',
    };
  }
  return undefined;
}

function compositionCacheIssue(
  stats: NativeFrameStatsSnapshot,
  options: RendererDiagnosticsOptions,
): RendererDiagnosticsIssue | undefined {
  const rows = stats.totalCompositionRowsComposed + stats.totalCompositionRowsReused;
  const minRows = options.minCompositionRowsForCacheIssue ??
    DEFAULT_MIN_COMPOSITION_ROWS_FOR_CACHE_ISSUE;
  const threshold = options.compositionReuseWatchBelow ?? DEFAULT_COMPOSITION_REUSE_WATCH_BELOW;
  if (rows < minRows || stats.avgCompositionReuseRatio >= threshold) return undefined;
  return {
    code: 'composition-cache',
    severity: 'watch',
    message: 'Retained row cache is seeing low reuse.',
    value: stats.avgCompositionReuseRatio,
    threshold,
  };
}

function lineCacheIssue(
  stats: NativeFrameStatsSnapshot,
  options: RendererDiagnosticsOptions,
): RendererDiagnosticsIssue | undefined {
  const lookups = stats.totalLineCacheHits + stats.totalLineCacheMisses;
  const minLookups = options.minLineCacheLookupsForIssue ?? DEFAULT_MIN_LINE_CACHE_LOOKUPS_FOR_ISSUE;
  const threshold = options.lineCacheHitWatchBelow ?? DEFAULT_LINE_CACHE_HIT_WATCH_BELOW;
  if (lookups < minLookups || stats.avgLineCacheHitRatio >= threshold) return undefined;
  return {
    code: 'line-cache',
    severity: 'watch',
    message: 'Line-cell cache is seeing low hit rate.',
    value: stats.avgLineCacheHitRatio,
    threshold,
  };
}

function maxDiagnosticsSeverity(
  values: readonly (RendererDiagnosticsSeverity | NativeFrameStatsHealth)[],
): RendererDiagnosticsSeverity {
  if (values.includes('degraded')) return 'degraded';
  if (values.includes('watch')) return 'watch';
  return 'ok';
}

function normalizeMaxIssues(value: number | undefined): number {
  if (value === undefined || !Number.isFinite(value)) return 3;
  return Math.max(0, Math.floor(value));
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

function formatFrameBudgetSparkline(samples: readonly number[]): string {
  if (samples.length === 0) return '';
  const visible = samples.slice(-FRAME_TIME_SPARKLINE_WIDTH);
  const maxSample = Math.max(1, ...visible);
  return visible.map((sample) => sparklineGlyph(sample, maxSample)).join('');
}

function sparklineGlyph(value: number, maxValue: number): string {
  if (!Number.isFinite(value) || value <= 0) return SPARKLINE_LEVELS[0]!;
  const normalized = Math.min(1, value / maxValue);
  const index = Math.min(
    SPARKLINE_LEVELS.length - 1,
    Math.max(0, Math.ceil(normalized * SPARKLINE_LEVELS.length) - 1),
  );
  return SPARKLINE_LEVELS[index]!;
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

function formatIssueValue(issue: RendererDiagnosticsIssue, value: number | string): string {
  if (typeof value === 'string') return value;
  if (
    issue.code === 'frame-budget' ||
    issue.code === 'phase' ||
    issue.code === 'output-backpressure' ||
    issue.code === 'composition-cache' ||
    issue.code === 'line-cache' ||
    (issue.code === 'output-volume' && value <= 1)
  ) {
    return formatPercent(value);
  }
  if (Math.abs(value) >= 1000) return formatNumber(value);
  return formatNumber(value);
}

function formatPercent(value: number): string {
  return `${formatNumber(value * 100)}%`;
}

function formatScanStrategy(strategy: RendererDamageScanStrategy): string {
  switch (strategy) {
    case 'none':
      return 'none';
    case 'dirty-rows':
      return 'dirty';
    case 'damage-rect':
      return 'rect';
    case 'full-frame':
      return 'full';
  }
}

function formatRendererPhaseSummary(diagnostics: RendererDiagnosticsSnapshot): string {
  return [
    `phase top ${diagnostics.dominantPhase} ${formatNumber(diagnostics.dominantPhaseDurationMs)}ms`,
    `render ${formatNumber(diagnostics.avgRenderCallbackDurationMs)}ms`,
    `present ${formatNumber(diagnostics.avgPresentDurationMs)}ms`,
    `write ${formatNumber(diagnostics.avgWriteDurationMs)}ms`,
  ].join(' | ');
}

function formatRendererDiagnosticsExpandedLines(
  diagnostics: RendererDiagnosticsSnapshot,
): string[] {
  const lines = [
    formatRendererDiagnosticsSummaryLine(diagnostics),
    formatRendererDiagnosticsWorkLine(diagnostics),
    formatRendererDiagnosticsOutputPolicyLine(diagnostics, 'expanded'),
    diagnostics.windowFrames === 0 ? undefined : formatRendererPhaseSummary(diagnostics),
    formatRendererDiagnosticsCacheLine(diagnostics),
  ].filter((line): line is string => line !== undefined && line.length > 0);
  return lines;
}

function formatRendererDiagnosticsSummaryLine(
  diagnostics: RendererDiagnosticsSnapshot,
): string {
  return [
    `renderer ${diagnostics.severity}`,
    `${formatNumber(diagnostics.avgDurationMs)}ms avg`,
    `${formatNumber(diagnostics.p95DurationMs)}ms p95`,
    `${formatNumber(diagnostics.p99DurationMs)}ms p99`,
    `${formatNumber(diagnostics.maxDurationMs)}ms max`,
    `${formatPercent(diagnostics.overBudgetRatio)} over`,
    diagnostics.avgFps <= 0 ? undefined : `${formatNumber(diagnostics.avgFps)} fps`,
  ].filter((part): part is string => part !== undefined).join(' | ');
}

function formatRendererDiagnosticsWorkLine(
  diagnostics: RendererDiagnosticsSnapshot,
): string {
  return [
    diagnostics.frameTimeSparkline.length === 0
      ? undefined
      : `frames ${diagnostics.frameTimeSparkline}`,
    diagnostics.windowFrames === 0
      ? undefined
      : `scan ${formatPercent(diagnostics.avgScanRatio)}/${formatPercent(diagnostics.avgDamageRatio)} ${formatScanStrategy(diagnostics.dominantScanStrategy)}`,
    `changed ${formatPercent(diagnostics.avgChangedCellRatio)}`,
    `${formatBytes(diagnostics.avgOutputBytes)} avg out`,
    diagnostics.outputBackpressureRatio <= 0
      ? undefined
      : `backpressure ${formatPercent(diagnostics.outputBackpressureRatio)}`,
    formatRendererDiagnosticsRunSummary(diagnostics),
    formatRendererDiagnosticsCursorMotionSummary(diagnostics),
  ].filter((part): part is string => part !== undefined).join(' | ');
}

function formatRendererDiagnosticsRunSummary(
  diagnostics: RendererDiagnosticsSnapshot,
): string | undefined {
  if (diagnostics.avgOutputCells <= 0 && diagnostics.avgOutputRuns <= 0) return undefined;
  return [
    `runs ${formatNumber(diagnostics.avgOutputRuns)}`,
    `out-cells ${formatNumber(diagnostics.avgOutputCells)}`,
    diagnostics.avgOutputBridgedCells <= 0
      ? undefined
      : `bridged ${formatNumber(diagnostics.avgOutputBridgedCells)} ${formatPercent(diagnostics.avgOutputBridgedCellRatio)}`,
  ].filter((part): part is string => part !== undefined).join(' ');
}

function formatRendererDiagnosticsCursorMotionSummary(
  diagnostics: RendererDiagnosticsSnapshot,
): string | undefined {
  const moves =
    diagnostics.avgCursorAbsoluteMoves +
    diagnostics.avgCursorRelativeMoves +
    diagnostics.avgCursorHorizontalAbsoluteMoves;
  if (moves <= 0 && diagnostics.avgCursorMoveSavedBytes <= 0) return undefined;
  return [
    `cursor abs ${formatNumber(diagnostics.avgCursorAbsoluteMoves)}`,
    `rel ${formatNumber(diagnostics.avgCursorRelativeMoves)}`,
    `cha ${formatNumber(diagnostics.avgCursorHorizontalAbsoluteMoves)}`,
    diagnostics.avgCursorMoveSavedBytes <= 0
      ? undefined
      : `saved ${formatBytes(diagnostics.avgCursorMoveSavedBytes)}`,
  ].filter((part): part is string => part !== undefined).join(' ');
}

function formatRendererDiagnosticsOutputPolicyLine(
  diagnostics: RendererDiagnosticsSnapshot,
  layout: RendererDiagnosticsLayout,
): string | undefined {
  if (diagnostics.lastOutputMode === undefined) return undefined;
  const synchronized = diagnostics.lastOutputSynchronized === true ? 'on' : 'off';
  const large = diagnostics.lastOutputLargeFrame === true ? 'yes' : 'no';
  const eraseLine = diagnostics.lastOutputEraseLine === true ? 'on' : 'off';
  const reason = diagnostics.lastOutputPolicyReason ?? 'unknown';
  const support = formatSynchronizedOutputSupport(diagnostics);
  if (layout === 'compact') {
    return `output ${diagnostics.lastOutputMode} sync ${synchronized}${support} el ${eraseLine}`;
  }
  return [
    `output ${diagnostics.lastOutputMode}`,
    `sync ${synchronized}${support}`,
    `large ${large}`,
    `erase-line ${eraseLine}`,
    `reason ${reason}`,
  ].join(' | ');
}

function formatSynchronizedOutputSupport(
  diagnostics: RendererDiagnosticsSnapshot,
): string {
  const support = diagnostics.synchronizedOutputSupport;
  if (support === undefined) return '';
  if (diagnostics.synchronizedOutputProbeAborted === true) return ' probe aborted';
  if (diagnostics.synchronizedOutputProbeTimedOut === true) return ' probe timeout';
  return ` probe ${support}`;
}

function formatRendererDiagnosticsCacheLine(
  diagnostics: RendererDiagnosticsSnapshot,
): string {
  return [
    `cache rows ${formatPercent(diagnostics.avgCompositionReuseRatio)}`,
    `lines ${formatPercent(diagnostics.avgLineCacheHitRatio)}`,
    diagnostics.quality === undefined
      ? undefined
      : formatRendererQualitySummary(diagnostics.quality),
  ].filter((part): part is string => part !== undefined).join(' | ');
}

function formatRendererQualitySummary(quality: RendererQualitySnapshot): string {
  return [
    `quality ${quality.level}`,
    quality.lastChangeReason,
  ].filter((part): part is string => part !== undefined).join(' ');
}

function resolveDominantPhase(stats: NativeFrameStatsSnapshot): RendererDiagnosticsDominantPhase {
  const phases: readonly RendererDiagnosticsDominantPhase[] = [
    phaseValue('render', stats.avgRenderCallbackDurationMs, stats.avgDurationMs),
    phaseValue('present', stats.avgPresentDurationMs, stats.avgDurationMs),
    phaseValue('diff', stats.avgDiffDurationMs, stats.avgDurationMs),
    phaseValue('encode', stats.avgEncodeDurationMs, stats.avgDurationMs),
    phaseValue('write', stats.avgWriteDurationMs, stats.avgDurationMs),
    phaseValue('quality', stats.avgQualityDurationMs, stats.avgDurationMs),
  ];
  return phases.reduce<RendererDiagnosticsDominantPhase>(
    (dominant, phase) => phase.durationMs > dominant.durationMs ? phase : dominant,
    { phase: 'none', durationMs: 0, ratio: 0 },
  );
}

function phaseValue(
  phase: RendererDiagnosticsPhase,
  durationMs: number,
  frameDurationMs: number,
): RendererDiagnosticsDominantPhase {
  return {
    phase,
    durationMs,
    ratio: frameDurationMs <= 0 ? 0 : durationMs / frameDurationMs,
  };
}

function phaseBudgetRatioForStats(
  stats: NativeFrameStatsSnapshot,
  durationMs: number,
): number {
  const targetFrameMs = stats.avgDurationMs / Math.max(0.000_001, stats.avgFrameBudgetRatio);
  if (!Number.isFinite(targetFrameMs) || targetFrameMs <= 0) return 0;
  return durationMs / targetFrameMs;
}

function formatBytes(value: number): string {
  if (value >= 1024 * 1024) return `${formatNumber(value / (1024 * 1024))} MiB`;
  if (value >= 1024) return `${formatNumber(value / 1024)} KiB`;
  return `${formatNumber(value)} B`;
}

function formatNumber(value: number): string {
  if (!Number.isFinite(value)) return '0';
  if (Math.abs(value) >= 100) return String(Math.round(value));
  if (Math.abs(value) >= 10) return value.toFixed(1).replace(/\.0$/, '');
  return value.toFixed(2).replace(/0+$/, '').replace(/\.$/, '');
}
