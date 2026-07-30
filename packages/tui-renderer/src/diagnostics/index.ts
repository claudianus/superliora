import type { NativeFrameStatsSnapshot } from '../frame-stats';
import type { RendererQualitySnapshot } from '../quality';
import { formatFrameBudgetSparkline } from './format';
import {
  collectRendererDiagnosticsIssues,
  maxDiagnosticsSeverity,
  resolveDominantPhase,
} from './issues';
import type {
  RendererDiagnosticsOptions,
  RendererDiagnosticsSnapshot,
} from './types';

export type {
  RendererDiagnosticsFormatOptions,
  RendererDiagnosticsIssue,
  RendererDiagnosticsIssueCode,
  RendererDiagnosticsLayout,
  RendererDiagnosticsOptions,
  RendererDiagnosticsOverlayOptions,
  RendererDiagnosticsPanelOptions,
  RendererDiagnosticsPhase,
  RendererDiagnosticsSeverity,
  RendererDiagnosticsSnapshot,
} from './types';

export {
  createRendererDiagnosticsOverlayRegion,
  formatRendererDiagnosticsPanel,
} from './panel';

export {
  formatRendererDiagnosticsLine,
  formatRendererDiagnosticsLines,
} from './format';

export function diagnoseNativeRendererStats(
  stats: NativeFrameStatsSnapshot,
  quality?: RendererQualitySnapshot,
  options: RendererDiagnosticsOptions = {},
): RendererDiagnosticsSnapshot {
  const dominantPhase = resolveDominantPhase(stats);
  const issues = collectRendererDiagnosticsIssues(stats, quality, dominantPhase, options);

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
