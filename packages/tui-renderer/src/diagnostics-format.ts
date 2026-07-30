import type { RendererQualitySnapshot } from './quality';
import {
  FRAME_TIME_SPARKLINE_WIDTH,
  SPARKLINE_LEVELS,
  type RendererDiagnosticsFormatOptions,
  type RendererDiagnosticsLayout,
  type RendererDiagnosticsSnapshot,
} from './diagnostics-types';
import {
  formatBytes,
  formatIssueValue,
  formatNumber,
  formatPercent,
  formatScanStrategy,
  normalizeMaxIssues,
} from './diagnostics-format-utils';

export function formatFrameBudgetSparkline(samples: readonly number[]): string {
  if (samples.length === 0) return '';
  const visible = samples.slice(-FRAME_TIME_SPARKLINE_WIDTH);
  const maxSample = Math.max(1, ...visible);
  return visible.map((sample) => sparklineGlyph(sample, maxSample)).join('');
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

function sparklineGlyph(value: number, maxValue: number): string {
  if (!Number.isFinite(value) || value <= 0) return SPARKLINE_LEVELS[0]!;
  const normalized = Math.min(1, value / maxValue);
  const index = Math.min(
    SPARKLINE_LEVELS.length - 1,
    Math.max(0, Math.ceil(normalized * SPARKLINE_LEVELS.length) - 1),
  );
  return SPARKLINE_LEVELS[index]!;
}
