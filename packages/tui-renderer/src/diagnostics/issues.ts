import type { NativeFrameStatsSnapshot, NativeFrameStatsHealth } from '../frame-stats';
import type { RendererQualitySnapshot } from '../quality';
import {
  DEFAULT_CHANGED_CELL_RATIO_DEGRADED,
  DEFAULT_CHANGED_CELL_RATIO_WATCH,
  DEFAULT_COMPOSITION_REUSE_WATCH_BELOW,
  DEFAULT_DOMINANT_PHASE_RATIO_WATCH,
  DEFAULT_LINE_CACHE_HIT_WATCH_BELOW,
  DEFAULT_MIN_COMPOSITION_ROWS_FOR_CACHE_ISSUE,
  DEFAULT_MIN_LINE_CACHE_LOOKUPS_FOR_ISSUE,
  DEFAULT_OUTPUT_BYTES_DEGRADED,
  DEFAULT_OUTPUT_BYTES_WATCH,
  DEFAULT_PHASE_BUDGET_RATIO_DEGRADED,
  DEFAULT_PHASE_BUDGET_RATIO_WATCH,
  type RendererDiagnosticsDominantPhase,
  type RendererDiagnosticsIssue,
  type RendererDiagnosticsOptions,
  type RendererDiagnosticsPhase,
  type RendererDiagnosticsSeverity,
} from './types';
import { formatNumber, formatPercent } from './format-utils';

export function collectRendererDiagnosticsIssues(
  stats: NativeFrameStatsSnapshot,
  quality: RendererQualitySnapshot | undefined,
  dominantPhase: RendererDiagnosticsDominantPhase,
  options: RendererDiagnosticsOptions,
): readonly RendererDiagnosticsIssue[] {
  return [
    frameBudgetIssue(stats),
    phaseIssue(stats, dominantPhase, options),
    qualityIssue(quality),
    outputVolumeIssue(stats, options),
    outputBackpressureIssue(stats),
    terminalCapabilityIssue(options),
    compositionCacheIssue(stats, options),
    lineCacheIssue(stats, options),
  ].filter((issue): issue is RendererDiagnosticsIssue => issue !== undefined);
}

export function maxDiagnosticsSeverity(
  values: readonly (RendererDiagnosticsSeverity | NativeFrameStatsHealth)[],
): RendererDiagnosticsSeverity {
  if (values.includes('degraded')) return 'degraded';
  if (values.includes('watch')) return 'watch';
  return 'ok';
}

export function resolveDominantPhase(stats: NativeFrameStatsSnapshot): RendererDiagnosticsDominantPhase {
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

function formatRendererQualitySummary(quality: RendererQualitySnapshot): string {
  return [
    `quality ${quality.level}`,
    quality.lastChangeReason,
  ].filter((part): part is string => part !== undefined).join(' ');
}
