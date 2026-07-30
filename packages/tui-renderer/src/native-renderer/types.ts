import type { NativeFrameRenderer } from '../native/frame';
import type { NativeInputEvent } from '../input-events/index';
import type { NativeInputRouter } from '../input-events/router';
import type { NativeRenderFrame } from '../frame/render-loop';
import type { NativeTerminalSynchronizedOutputProbeResult } from '../terminal/probe';
import type {
  NativeTerminalKeyboardProtocol,
  NativeTerminalInput,
  NativeTerminalMouseTracking,
  NativeTerminalOutput,
  NativeTerminalScreenMode,
  NativeTerminalSize,
} from '../terminal/session';
import type { RendererCell } from '../cell-buffer/index';
import type { RendererCursorState, RendererTerminalOutputOptions } from '../terminal/output';
import type { RendererInlineImageProtocol } from '../terminal/graphics';
import type { RendererDamageScanStrategy } from '../render/damage';
import type { NativeTerminalFeatureInput } from '../terminal/features';
import type { NativeFrameStatsSnapshot } from '../frame/stats';
import type { RendererLineCellCache, RendererLineCellCacheOptions } from '../render/line-cache';
import type { RendererCompositionCache } from '../render/compositor';
import type {
  RendererQualityChangeReason,
  RendererQualityController,
  RendererQualityControllerOptions,
  RendererQualitySnapshot,
} from '../frame/quality';
import type {
  RendererTraceRecorder,
  RendererTraceRecorderOptions,
} from '../trace';
import type {
  RendererFrameOutputDecisionReason,
  RendererFrameOutputMode,
  RendererFrameOutputPolicyInput,
} from '../frame/output-policy';
import type { NativeRenderLoopScheduler } from '../frame/render-loop';
import type { NativeFramePresentResult } from '../native/frame';
import type { NativeTerminalRenderer } from './index';

export interface NativeTerminalRendererFrame {
  readonly frame: NativeRenderFrame;
  readonly renderer: NativeFrameRenderer;
  readonly runtime: NativeTerminalRenderer;
  readonly size: NativeTerminalSize;
  readonly lineCache?: RendererLineCellCache;
  readonly compositionCache?: RendererCompositionCache;
  readonly quality: RendererQualitySnapshot;
}

export type NativeTerminalRendererRender = (
  frame: NativeTerminalRendererFrame,
) => NativeFramePresentResult | void;

export type NativeTerminalRendererRegionVfxFramePolicy = 'auto' | 'always' | 'never';
export type NativeTerminalRendererAutoFrameHold = boolean | (() => boolean);

export interface NativeTerminalRendererOptions extends RendererTerminalOutputOptions {
  readonly features?: NativeTerminalFeatureInput;
  readonly input?: NativeTerminalInput;
  readonly output: NativeTerminalOutput;
  readonly screenMode?: NativeTerminalScreenMode;
  readonly keyboardProtocol?: NativeTerminalKeyboardProtocol;
  readonly mouseTracking?: NativeTerminalMouseTracking;
  readonly rawMode?: boolean;
  readonly bracketedPaste?: boolean;
  readonly focusEvents?: boolean;
  readonly clearOnStart?: boolean;
  readonly autoWrap?: boolean;
  readonly imageProtocol?: RendererInlineImageProtocol;
  readonly targetFps?: number;
  readonly unrefTimers?: boolean;
  readonly renderOnStart?: boolean;
  readonly scheduler?: NativeRenderLoopScheduler;
  readonly fill?: RendererCell;
  readonly autoBeginFrame?: boolean;
  readonly lineCache?: boolean | RendererLineCellCache | RendererLineCellCacheOptions;
  readonly compositionCache?: boolean | RendererCompositionCache;
  readonly adaptiveQuality?: boolean | RendererQualityController | RendererQualityControllerOptions;
  readonly trace?: boolean | RendererTraceRecorder | RendererTraceRecorderOptions;
  readonly outputPolicy?: RendererFrameOutputPolicyInput;
  readonly regionVfxFrames?: NativeTerminalRendererRegionVfxFramePolicy;
  readonly autoFrameHold?: NativeTerminalRendererAutoFrameHold;
  readonly deferFramesDuringBackpressure?: boolean;
  readonly synchronizedOutputProbe?: boolean;
  readonly synchronizedOutputProbeTimeoutMs?: number;
  readonly onSynchronizedOutputProbe?: (
    result: NativeTerminalSynchronizedOutputProbeResult,
  ) => void;
  readonly render: NativeTerminalRendererRender;
  readonly inputRouter?: NativeInputRouter;
  readonly onInput?: (data: string | Buffer) => void;
  readonly onInputEvent?: (event: NativeInputEvent) => void;
  readonly onResize?: (size: NativeTerminalSize) => void;
  readonly statsWindowSize?: number;
  readonly onFrame?: (
    result: NativeTerminalRendererRenderResult,
    stats: NativeFrameStatsSnapshot,
  ) => void;
  readonly onQualityChange?: (change: NativeTerminalRendererQualityChange) => void;
  /**
   * Lets the caller cap the internal frame buffer height below the real
   * terminal size, e.g. to grow the UI with its content instead of always
   * occupying the full viewport. Returning a value larger than the real
   * terminal row count, `undefined`, or a non-finite/non-positive number
   * falls back to the real terminal height. The result is clamped to
   * `size.rows`.
   */
  readonly measureFrameHeight?: (size: NativeTerminalSize) => number;
}

export interface NativeTerminalRendererFrameMetrics {
  readonly startedAt: number;
  readonly endedAt: number;
  readonly durationMs: number;
  readonly targetFrameMs: number;
  readonly overBudget: boolean;
  readonly renderCallbackDurationMs: number;
  readonly presentDurationMs: number;
  readonly diffDurationMs: number;
  readonly encodeDurationMs: number;
  readonly writeDurationMs: number;
  readonly qualityDurationMs: number;
  readonly outputBytes: number;
  readonly outputBackpressure: boolean;
  readonly outputCells: number;
  readonly outputRuns: number;
  readonly outputBridgedCells: number;
  readonly outputBridgedCellRatio: number;
  readonly cursorAbsoluteMoves: number;
  readonly cursorRelativeMoves: number;
  readonly cursorHorizontalAbsoluteMoves: number;
  readonly cursorMoveBytes: number;
  readonly cursorMoveAbsoluteBytes: number;
  readonly cursorMoveSavedBytes: number;
  readonly outputMode: RendererFrameOutputMode;
  readonly outputSynchronized: boolean;
  readonly outputLargeFrame: boolean;
  readonly outputPolicyReason: RendererFrameOutputDecisionReason;
  readonly outputEraseLine: boolean;
  readonly changedCells: number;
  readonly scannedCells: number;
  readonly scannedRows: number;
  readonly dirtyRows: number;
  readonly totalCells: number;
  readonly scanStrategy: RendererDamageScanStrategy;
  readonly scanRatio: number;
  readonly damageCells: number;
  readonly damageRatio: number;
  readonly compositionRowsVisited: number;
  readonly compositionRowsComposed: number;
  readonly compositionRowsReused: number;
  readonly compositionReuseRatio: number;
  readonly lineCacheHits: number;
  readonly lineCacheMisses: number;
  readonly lineCacheHitRatio: number;
  readonly lineCacheEvictions: number;
}

export interface NativeTerminalRendererQualityChange {
  readonly frame: NativeRenderFrame;
  readonly previous: RendererQualitySnapshot;
  readonly current: RendererQualitySnapshot;
  readonly reason: RendererQualityChangeReason;
  readonly metrics: NativeTerminalRendererFrameMetrics;
}

export interface NativeTerminalRendererRenderResult {
  readonly frame: NativeRenderFrame;
  readonly size: NativeTerminalSize;
  readonly present: NativeFramePresentResult | undefined;
  readonly metrics: NativeTerminalRendererFrameMetrics;
  readonly quality: RendererQualitySnapshot;
}

export interface NativeTerminalRendererLayoutFrameOptions {
  readonly clear?: boolean;
  readonly fill?: RendererCell;
  readonly force?: boolean;
  readonly forceCursor?: boolean;
  readonly cursor?: RendererCursorState;
  readonly scheduleRegionVfx?: boolean;
  readonly beforePresent?: (renderer: NativeFrameRenderer) => void;
}
