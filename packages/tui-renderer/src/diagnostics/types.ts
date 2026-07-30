import type { RendererCell } from '../cell-buffer';
import type { RendererRect } from '../compositor';
import type { RendererDamageScanStrategy } from '../damage';
import type {
  RendererFrameOutputDecisionReason,
  RendererFrameOutputMode,
} from '../frame-output-policy';
import type { NativeFrameStatsHealth } from '../frame-stats';
import type {
  RendererOverlayPanelLineStyle,
  RendererOverlayPanelStyle,
  RendererOverlayPlacement,
} from '../overlay';
import type { RendererQualitySnapshot } from '../quality';
import type { NativeTerminalSynchronizedOutputProbeResult } from '../terminal-probe';
import type { RendererTheme } from '../theme';

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

export type RendererDiagnosticsPhase =
  | 'render'
  | 'present'
  | 'diff'
  | 'encode'
  | 'write'
  | 'quality'
  | 'none';

export interface RendererDiagnosticsDominantPhase {
  readonly phase: RendererDiagnosticsPhase;
  readonly durationMs: number;
  readonly ratio: number;
}

export const DEFAULT_OUTPUT_BYTES_WATCH = 16 * 1024;
export const DEFAULT_OUTPUT_BYTES_DEGRADED = 64 * 1024;
export const DEFAULT_PHASE_BUDGET_RATIO_WATCH = 0.5;
export const DEFAULT_PHASE_BUDGET_RATIO_DEGRADED = 0.85;
export const DEFAULT_DOMINANT_PHASE_RATIO_WATCH = 0.6;
export const DEFAULT_CHANGED_CELL_RATIO_WATCH = 0.5;
export const DEFAULT_CHANGED_CELL_RATIO_DEGRADED = 0.85;
export const DEFAULT_MIN_COMPOSITION_ROWS_FOR_CACHE_ISSUE = 24;
export const DEFAULT_COMPOSITION_REUSE_WATCH_BELOW = 0.2;
export const DEFAULT_MIN_LINE_CACHE_LOOKUPS_FOR_ISSUE = 24;
export const DEFAULT_LINE_CACHE_HIT_WATCH_BELOW = 0.2;
export const DEFAULT_DIAGNOSTICS_PANEL_WIDTH = 72;
export const MIN_DIAGNOSTICS_PANEL_WIDTH = 12;
export const PANEL_TRUNCATION_MARK = '...';
export const FRAME_TIME_SPARKLINE_WIDTH = 16;
export const SPARKLINE_LEVELS = '▁▂▃▄▅▆▇█';
