import {
  NativeFrameRenderer,
  type NativeFramePresentResult,
  type NativeFrameRendererOptions,
} from './native-frame';
import { NativeInputDecoder, type NativeInputEvent } from './input-events';
import type { NativeInputRouter } from './input-router';
import {
  NativeRenderLoop,
  type NativeAnimationFrameCallback,
  type NativeRenderCause,
  type NativeRenderFrame,
  type NativeRenderLoopScheduler,
} from './render-loop';
import {
  NativeTerminalSession,
  type NativeTerminalKeyboardProtocol,
  type NativeTerminalInput,
  type NativeTerminalMouseTracking,
  type NativeTerminalOutput,
  type NativeTerminalScreenMode,
  type NativeTerminalSize,
} from './terminal-session';
import {
  probeNativeSynchronizedOutputSupport,
  type NativeTerminalSynchronizedOutputProbeResult,
} from './terminal-probe';
import type { RendererCell } from './cell-buffer';
import {
  encodeTerminalClearBelowRow,
  type RendererCursorState,
  type RendererTerminalOutputOptions,
} from './terminal-output';
import type { RendererInlineImageProtocol } from './terminal-graphics';
import {
  diagnoseNativeRendererStats,
  type RendererDiagnosticsSnapshot,
} from './diagnostics';
import type { RendererDamageScanStrategy } from './damage';
import {
  mergeNativeTerminalFeatureOptions,
  type NativeTerminalFeatureInput,
} from './terminal-features';
import { NativeFrameStats, type NativeFrameStatsSnapshot } from './frame-stats';
import { RendererLineCellCache, type RendererLineCellCacheOptions } from './line-cache';
import { RendererCompositionCache, type RendererCompositionStats } from './compositor';
import {
  renderNativeLayoutFrame,
  type NativeLayoutFrameResult,
  type RendererFrameRegion,
} from './layout-frame';
import {
  RendererQualityController,
  type RendererQualityChangeReason,
  type RendererQualityControllerOptions,
  type RendererQualitySnapshot,
} from './quality';
import {
  RendererRegionVfxAnimationScheduler,
  type RendererRegionVfxAnimationSource,
} from './region-vfx';
import {
  RendererTraceRecorder,
  type RendererChromeTraceFile,
  type RendererChromeTraceOptions,
  type RendererTraceInputData,
  type RendererTraceRecorderOptions,
  type RendererTraceSnapshot,
} from './trace';
import type {
  RendererFrameOutputDecisionReason,
  RendererFrameOutputMode,
  RendererFrameOutputPolicyInput,
} from './frame-output-policy';
import type { RendererAnimationFrameCallback } from './animation';

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
}

export class NativeTerminalRenderer {
  readonly session: NativeTerminalSession;
  readonly frameRenderer: NativeFrameRenderer;
  readonly loop: NativeRenderLoop;
  readonly frameStats: NativeFrameStats;
  readonly lineCache: RendererLineCellCache | undefined;
  readonly compositionCache: RendererCompositionCache | undefined;
  readonly qualityController: RendererQualityController;
  readonly trace: RendererTraceRecorder;

  private started = false;
  private readonly inputDecoder = new NativeInputDecoder();
  private lastRenderResult: NativeTerminalRendererRenderResult | undefined;
  private readonly options: NativeTerminalRendererOptions;
  private readonly adaptiveQualityEnabled: boolean;
  private regionVfxScheduler: RendererRegionVfxAnimationScheduler | undefined;
  private currentSynchronized: boolean | undefined;
  private synchronizedOutputProbeResultValue:
    | NativeTerminalSynchronizedOutputProbeResult
    | undefined;
  private synchronizedOutputProbePromise:
    | Promise<NativeTerminalSynchronizedOutputProbeResult>
    | undefined;
  private synchronizedOutputProbeAbort: AbortController | undefined;
  private outputBackpressured = false;
  private outputDrainListener: (() => void) | undefined;
  private readonly deferredRenderCauses = new Set<NativeRenderCause>();
  private readonly deferredAnimationCallbacks = new Map<number, NativeAnimationFrameCallback>();
  private nextDeferredAnimationFrameId = -1;
  private autoFrameHoldOverride: boolean | undefined;
  private measureFrameHeightOverride: ((size: NativeTerminalSize) => number) | undefined;
  private autoFrameHeld = false;
  private releasingHeldAutoFrames = false;
  private readonly heldRenderCauses = new Set<NativeRenderCause>();
  private readonly heldAnimationCallbacks = new Map<number, NativeAnimationFrameCallback>();
  private nextHeldAnimationFrameId = -1_000_000;

  constructor(options: NativeTerminalRendererOptions) {
    this.options = mergeNativeTerminalFeatureOptions(options.features, options);
    this.currentSynchronized = this.options.synchronized;
    this.frameStats = new NativeFrameStats({ windowSize: this.options.statsWindowSize });
    this.lineCache = createLineCache(this.options.lineCache);
    this.compositionCache = createCompositionCache(this.options.compositionCache);
    this.qualityController = createQualityController(this.options.adaptiveQuality);
    this.trace = createTraceRecorder(this.options.trace);
    this.adaptiveQualityEnabled = this.options.adaptiveQuality !== false;
    this.session = new NativeTerminalSession({
      input: this.options.input,
      output: this.options.output,
      screenMode: this.options.screenMode,
      keyboardProtocol: this.options.keyboardProtocol,
      mouseTracking: this.options.mouseTracking,
      rawMode: this.options.rawMode,
      bracketedPaste: this.options.bracketedPaste,
      focusEvents: this.options.focusEvents,
      clearOnStart: this.options.clearOnStart,
      autoWrap: this.options.autoWrap,
      hideCursor: this.options.hideCursor,
      showCursor: this.options.showCursor,
      synchronized: this.currentSynchronized,
      originX: this.options.originX,
      originY: this.options.originY,
      imageProtocol: this.options.imageProtocol,
      onInput: (data) => {
        this.options.onInput?.(data);
        if (
          this.trace.enabled ||
          this.options.onInputEvent !== undefined ||
          this.options.inputRouter !== undefined
        ) {
          for (const event of this.inputDecoder.decode(data)) {
            this.trace.recordInput({
              timestampMs: this.loop.now(),
              input: nativeInputTraceData(event),
            });
            this.options.onInputEvent?.(event);
            this.options.inputRouter?.dispatch(event);
          }
        }
      },
      onResize: (size) => {
        this.handleResize(size);
      },
    });
    this.frameRenderer = new NativeFrameRenderer(this.createFrameRendererOptions(this.session.size));
    this.loop = new NativeRenderLoop({
      targetFps: this.options.targetFps,
      unrefTimers: this.options.unrefTimers,
      renderOnStart: this.options.renderOnStart,
      scheduler: this.options.scheduler,
      render: (frame) => {
        this.lastRenderResult = this.renderFrame(frame);
        const stats = this.frameStats.record(this.lastRenderResult.metrics);
        this.trace.recordFrame({
          frameIndex: this.lastRenderResult.frame.frame,
          causes: this.lastRenderResult.frame.causes,
          size: this.lastRenderResult.size,
          health: stats.health,
          qualityLevel: this.lastRenderResult.quality.level,
          metrics: this.lastRenderResult.metrics,
        });
        this.options.onFrame?.(this.lastRenderResult, stats);
      },
    });
  }

  get isStarted(): boolean {
    return this.started;
  }

  get size(): NativeTerminalSize {
    return this.session.size;
  }

  get lastFrame(): NativeTerminalRendererRenderResult | undefined {
    return this.lastRenderResult;
  }

  get synchronizedOutputEnabled(): boolean {
    return this.currentSynchronized === true;
  }

  get synchronizedOutputProbeResult(): NativeTerminalSynchronizedOutputProbeResult | undefined {
    return this.synchronizedOutputProbeResultValue;
  }

  get isOutputBackpressured(): boolean {
    return this.outputBackpressured;
  }

  get areAutoFramesHeld(): boolean {
    return this.shouldHoldAutoFrames();
  }

  get stats(): NativeFrameStatsSnapshot {
    return this.frameStats.snapshot();
  }

  get quality(): RendererQualitySnapshot {
    return this.qualityController.snapshot();
  }

  get diagnostics(): RendererDiagnosticsSnapshot {
    return diagnoseNativeRendererStats(this.stats, this.quality, {
      synchronizedOutputProbeResult: this.synchronizedOutputProbeResultValue,
      synchronizedOutputEnabled: this.synchronizedOutputEnabled,
    });
  }

  get traceSnapshot(): RendererTraceSnapshot {
    return this.trace.snapshot();
  }

  start(): void {
    if (this.started) return;
    this.started = true;
    this.session.start();
    this.startSynchronizedOutputProbe();
    this.frameRenderer.resize(this.size.columns, this.size.rows);
    this.loop.start();
  }

  stop(): void {
    if (!this.started) return;
    this.started = false;
    this.abortSynchronizedOutputProbe();
    this.clearOutputBackpressure();
    this.clearAutoFrameHold();
    this.loop.stop();
    this.session.stop();
  }

  requestRender(cause: NativeRenderCause = 'request'): void {
    if (this.shouldHoldAutoFrameCause(cause)) {
      this.holdRenderCause(cause);
      return;
    }
    this.releaseHeldAutoFramesIfReady();
    if (this.shouldDeferFrameForBackpressure()) {
      this.deferredRenderCauses.add(cause);
      return;
    }
    this.loop.requestRender(cause);
  }

  resetStats(): void {
    this.frameStats.reset();
  }

  resetTrace(): void {
    this.trace.reset();
  }

  exportTrace(options?: RendererChromeTraceOptions): RendererChromeTraceFile {
    return this.trace.toChromeTraceFile(options);
  }

  requestAnimationFrame(callback: NativeAnimationFrameCallback): number {
    if (this.shouldHoldAutoFrameCause('animation')) {
      const id = this.nextHeldAnimationFrameId--;
      this.heldAnimationCallbacks.set(id, callback);
      this.holdRenderCause('animation');
      return id;
    }
    this.releaseHeldAutoFramesIfReady();
    if (this.shouldDeferFrameForBackpressure()) {
      const id = this.nextDeferredAnimationFrameId--;
      this.deferredAnimationCallbacks.set(id, callback);
      this.deferredRenderCauses.add('animation');
      return id;
    }
    return this.loop.requestAnimationFrame(callback);
  }

  cancelAnimationFrame(id: number): void {
    if (this.heldAnimationCallbacks.delete(id)) {
      if (this.heldAnimationCallbacks.size === 0) {
        this.heldRenderCauses.delete('animation');
      }
      if (this.heldRenderCauses.size === 0) this.clearAutoFrameHold();
      return;
    }
    if (this.deferredAnimationCallbacks.delete(id)) {
      if (this.deferredAnimationCallbacks.size === 0) {
        this.deferredRenderCauses.delete('animation');
      }
      return;
    }
    this.loop.cancelAnimationFrame(id);
  }

  setAutoFrameHold(held: boolean): void {
    this.autoFrameHoldOverride = held;
    if (!held) this.releaseHeldAutoFrames();
  }

  /**
   * Overrides (or clears, when `undefined`) the `measureFrameHeight` option
   * after construction. Useful for callers that must finish building
   * application state before they can compute a content-driven height.
   */
  setMeasureFrameHeight(measure: ((size: NativeTerminalSize) => number) | undefined): void {
    this.measureFrameHeightOverride = measure;
  }

  clearAutoFrameHoldOverride(): void {
    this.autoFrameHoldOverride = undefined;
    this.releaseHeldAutoFramesIfReady();
  }

  releaseHeldAutoFrames(): void {
    const deferredCauses = Array.from(this.heldRenderCauses);
    const deferredCallbacks = Array.from(this.heldAnimationCallbacks.values());
    this.clearAutoFrameHold();
    if (deferredCauses.length === 0 && deferredCallbacks.length === 0) return;
    this.trace.recordMarker({
      timestampMs: this.loop.now(),
      name: 'renderer.auto_frame_release',
      args: {
        deferredCauses: deferredCauses.join(','),
        deferredAnimations: deferredCallbacks.length,
      },
    });
    this.releasingHeldAutoFrames = true;
    try {
      for (const callback of deferredCallbacks) this.requestAnimationFrame(callback);
      for (const cause of deferredCauses) {
        if (cause === 'animation') continue;
        this.requestRender(cause);
      }
    } finally {
      this.releasingHeldAutoFrames = false;
    }
  }

  requestAnimationFrameForRegions(
    regions: readonly RendererRegionVfxAnimationSource[],
    callback?: RendererAnimationFrameCallback,
  ): boolean {
    if (!this.shouldScheduleRegionVfxFrames()) return false;
    this.regionVfxScheduler ??= new RendererRegionVfxAnimationScheduler({ clock: this });
    return this.regionVfxScheduler.requestForRegions(regions, callback);
  }

  cancelRegionAnimationFrame(): void {
    this.regionVfxScheduler?.cancel();
  }

  setSynchronizedOutput(synchronized: boolean | undefined): void {
    if (this.currentSynchronized === synchronized) return;
    this.currentSynchronized = synchronized;
    this.frameRenderer.setSynchronizedOutput(synchronized);
    if (synchronized !== true) this.cancelRegionAnimationFrame();
    if (this.started) this.loop.requestRender('request');
  }

  renderLayoutFrame(
    regions: readonly RendererFrameRegion[],
    options: NativeTerminalRendererLayoutFrameOptions = {},
  ): NativeLayoutFrameResult {
    const result = renderNativeLayoutFrame(this.frameRenderer, regions, {
      clear: options.clear,
      fill: options.fill ?? this.options.fill,
      force: options.force,
      forceCursor: options.forceCursor,
      cursor: options.cursor,
      composition: {
        lineCache: this.lineCache,
        cache: this.compositionCache,
      },
    });
    if (options.scheduleRegionVfx !== false) this.requestAnimationFrameForRegions(regions);
    return result;
  }

  private handleResize(size: NativeTerminalSize): void {
    const previousRows = this.frameRenderer.height;
    this.frameRenderer.resize(size.columns, size.rows);
    this.clearStaleFrameRowsOnShrink(size.rows, previousRows);
    this.trace.recordResize({
      timestampMs: this.loop.now(),
      size,
    });
    this.options.onResize?.(size);
    this.loop.requestRender('resize');
  }

  private resolveFrameHeight(size: NativeTerminalSize): number {
    const measure = this.measureFrameHeightOverride ?? this.options.measureFrameHeight;
    const measured = measure?.(size);
    if (measured === undefined || !Number.isFinite(measured) || measured <= 0) return size.rows;
    return Math.min(size.rows, Math.floor(measured));
  }

  private clearStaleFrameRowsOnShrink(height: number, previousHeight: number): void {
    if (this.options.screenMode === 'alternate' || height >= previousHeight) return;
    this.session.write(
      encodeTerminalClearBelowRow(height, this.options.originX ?? 0, this.options.originY ?? 0),
    );
  }

  private shouldScheduleRegionVfxFrames(): boolean {
    if (this.shouldHoldAutoFrameCause('animation')) return false;
    if (this.shouldDeferFrameForBackpressure()) return false;
    const policy = this.options.regionVfxFrames ?? 'auto';
    switch (policy) {
      case 'always':
        return true;
      case 'never':
        return false;
      case 'auto':
        return (
          this.currentSynchronized === true ||
          this.options.screenMode === 'alternate' ||
          this.options.synchronized === true
        );
    }
  }

  private shouldHoldAutoFrameCause(cause: NativeRenderCause): boolean {
    if (this.releasingHeldAutoFrames) return false;
    if (!isAutoFrameHoldCause(cause)) return false;
    return this.shouldHoldAutoFrames();
  }

  private shouldHoldAutoFrames(): boolean {
    const override = this.autoFrameHoldOverride;
    if (override !== undefined) return override;
    const hold = this.options.autoFrameHold;
    return typeof hold === 'function' ? hold() : hold === true;
  }

  private holdRenderCause(cause: NativeRenderCause): void {
    this.heldRenderCauses.add(cause);
    this.cancelRegionAnimationFrame();
    if (this.autoFrameHeld) return;
    this.autoFrameHeld = true;
    this.trace.recordMarker({
      timestampMs: this.loop.now(),
      name: 'renderer.auto_frame_hold',
      args: { cause },
    });
  }

  private releaseHeldAutoFramesIfReady(): void {
    if (this.shouldHoldAutoFrames()) return;
    this.releaseHeldAutoFrames();
  }

  private clearAutoFrameHold(): void {
    this.autoFrameHeld = false;
    this.heldRenderCauses.clear();
    this.heldAnimationCallbacks.clear();
  }

  private shouldDeferFrameForBackpressure(): boolean {
    return this.options.deferFramesDuringBackpressure !== false && this.outputBackpressured;
  }

  private handleOutputBackpressure(): void {
    if (this.options.deferFramesDuringBackpressure === false) return;
    if (this.outputBackpressured) return;
    if (this.options.output.on === undefined) return;
    this.outputBackpressured = true;
    this.cancelRegionAnimationFrame();
    const listener = () => {
      this.handleOutputDrain();
    };
    this.outputDrainListener = listener;
    this.options.output.on('drain', listener);
    this.trace.recordMarker({
      timestampMs: this.loop.now(),
      name: 'terminal.output_backpressure',
    });
  }

  private handleOutputDrain(): void {
    if (!this.outputBackpressured) return;
    const deferredCauses = Array.from(this.deferredRenderCauses);
    const deferredCallbacks = Array.from(this.deferredAnimationCallbacks.values());
    this.clearOutputBackpressure();
    this.trace.recordMarker({
      timestampMs: this.loop.now(),
      name: 'terminal.output_drain',
      args: {
        deferredCauses: deferredCauses.join(','),
        deferredAnimations: deferredCallbacks.length,
      },
    });
    for (const callback of deferredCallbacks) this.loop.requestAnimationFrame(callback);
    for (const cause of deferredCauses) {
      if (cause === 'animation') continue;
      this.loop.requestRender(cause);
    }
  }

  private clearOutputBackpressure(): void {
    if (this.outputDrainListener !== undefined) {
      if (this.options.output.off !== undefined) {
        this.options.output.off('drain', this.outputDrainListener);
      } else {
        this.options.output.removeListener?.('drain', this.outputDrainListener);
      }
      this.outputDrainListener = undefined;
    }
    this.outputBackpressured = false;
    this.deferredRenderCauses.clear();
    this.deferredAnimationCallbacks.clear();
  }

  private startSynchronizedOutputProbe(): void {
    if (this.options.synchronizedOutputProbe !== true) return;
    if (this.options.input === undefined || this.currentSynchronized !== true) return;
    if (this.synchronizedOutputProbePromise !== undefined) return;

    this.synchronizedOutputProbeAbort = new AbortController();
    const promise = probeNativeSynchronizedOutputSupport({
      input: this.options.input,
      output: this.options.output,
      timeoutMs: this.options.synchronizedOutputProbeTimeoutMs,
      unrefTimer: this.options.unrefTimers,
      signal: this.synchronizedOutputProbeAbort.signal,
    });
    this.synchronizedOutputProbePromise = promise;
    void promise.then((result) => {
      if (this.synchronizedOutputProbePromise !== promise) return;
      this.synchronizedOutputProbePromise = undefined;
      this.synchronizedOutputProbeAbort = undefined;
      this.synchronizedOutputProbeResultValue = result;
      if (result.aborted === true) return;
      this.trace.recordMarker({
        timestampMs: this.loop.now(),
        name: 'terminal.synchronized_output_probe',
        args: {
          support: result.support,
          timedOut: result.timedOut,
          enabled: result.support === 'supported',
        },
      });
      this.options.onSynchronizedOutputProbe?.(result);
      this.setSynchronizedOutput(result.support === 'supported');
    }, () => {
      if (this.synchronizedOutputProbePromise !== promise) return;
      this.synchronizedOutputProbePromise = undefined;
      this.synchronizedOutputProbeAbort = undefined;
    });
  }

  private abortSynchronizedOutputProbe(): void {
    this.synchronizedOutputProbePromise = undefined;
    this.synchronizedOutputProbeAbort?.abort();
    this.synchronizedOutputProbeAbort = undefined;
  }

  private renderFrame(frame: NativeRenderFrame): NativeTerminalRendererRenderResult {
    const startedAt = this.loop.now();
    const size = this.size;
    const qualityBeforeRender = this.qualityController.snapshot();
    const previousHeight = this.frameRenderer.height;
    const frameHeight = this.resolveFrameHeight(size);
    this.frameRenderer.resize(size.columns, frameHeight);
    if (!frame.causes.includes('start')) {
      this.clearStaleFrameRowsOnShrink(frameHeight, previousHeight);
    }
    if (this.options.autoBeginFrame !== false) {
      this.frameRenderer.beginFrame({ fill: this.options.fill });
    }
    const renderCallbackStartedAt = this.loop.now();
    const renderResult = this.options.render({
      frame,
      renderer: this.frameRenderer,
      runtime: this,
      size,
      lineCache: this.lineCache,
      compositionCache: this.compositionCache,
      quality: qualityBeforeRender,
    });
    const renderCallbackEndedAt = this.loop.now();
    const present = renderResult ?? this.frameRenderer.present();
    const endedAt = this.loop.now();
    const metricsBeforeQuality = createFrameMetrics(
      startedAt,
      endedAt,
      this.loop.frameIntervalMs,
      present,
      size,
      {
        renderCallbackDurationMs: duration(renderCallbackStartedAt, renderCallbackEndedAt),
      },
    );
    if (present?.backpressure) this.handleOutputBackpressure();
    const qualityStartedAt = this.loop.now();
    const previousQuality = this.qualityController.snapshot();
    const quality = this.adaptiveQualityEnabled
      ? this.qualityController.record(metricsBeforeQuality)
      : this.qualityController.snapshot();
    const qualityEndedAt = this.loop.now();
    const metrics = {
      ...metricsBeforeQuality,
      qualityDurationMs: duration(qualityStartedAt, qualityEndedAt),
    };
    if (quality.changes !== previousQuality.changes) {
      this.handleQualityChange(frame, previousQuality, quality, metrics);
    }
    return { frame, size, present, metrics, quality };
  }

  private handleQualityChange(
    frame: NativeRenderFrame,
    previous: RendererQualitySnapshot,
    current: RendererQualitySnapshot,
    metrics: NativeTerminalRendererFrameMetrics,
  ): void {
    const reason = current.lastChangeReason;
    if (reason === undefined) return;
    this.trace.recordMarker({
      timestampMs: metrics.endedAt,
      name: 'renderer.quality_change',
      args: {
        frame: frame.frame,
        previous: previous.level,
        current: current.level,
        reason,
        outputBytes: metrics.outputBytes,
        outputBackpressure: metrics.outputBackpressure,
        changedCells: metrics.changedCells,
        totalCells: metrics.totalCells,
      },
    });
    this.options.onQualityChange?.({
      frame,
      previous,
      current,
      reason,
      metrics,
    });
    this.requestRender('quality');
  }

  private createFrameRendererOptions(size: NativeTerminalSize): NativeFrameRendererOptions {
    return {
      width: size.columns,
      height: size.rows,
      output: this.session,
      synchronized: this.currentSynchronized,
      resetStyle: this.options.resetStyle,
      originX: this.options.originX,
      originY: this.options.originY,
      eraseLine: this.options.eraseLine,
      colorMode: this.options.colorMode,
      inlineImageProtocol: this.options.imageProtocol,
      outputPolicy: this.options.outputPolicy,
      now: () => this.loop.now(),
    };
  }
}

function createLineCache(
  option: boolean | RendererLineCellCache | RendererLineCellCacheOptions | undefined,
): RendererLineCellCache | undefined {
  if (option instanceof RendererLineCellCache) return option;
  if (option === false) return undefined;
  if (option === true || option === undefined) return new RendererLineCellCache();
  return new RendererLineCellCache(option);
}

function createCompositionCache(
  option: boolean | RendererCompositionCache | undefined,
): RendererCompositionCache | undefined {
  if (option instanceof RendererCompositionCache) return option;
  return option === false ? undefined : new RendererCompositionCache();
}

function createQualityController(
  option: boolean | RendererQualityController | RendererQualityControllerOptions | undefined,
): RendererQualityController {
  if (option instanceof RendererQualityController) return option;
  if (option === true || option === false || option === undefined) return new RendererQualityController();
  return new RendererQualityController(option);
}

function createTraceRecorder(
  option: boolean | RendererTraceRecorder | RendererTraceRecorderOptions | undefined,
): RendererTraceRecorder {
  if (option instanceof RendererTraceRecorder) return option;
  if (option === false) return new RendererTraceRecorder({ enabled: false });
  if (option === true || option === undefined) return new RendererTraceRecorder();
  return new RendererTraceRecorder(option);
}

function isAutoFrameHoldCause(cause: NativeRenderCause): boolean {
  return cause === 'request' || cause === 'animation' || cause === 'quality';
  // 'input' is intentionally excluded: editor keystrokes must repaint even while
  // transcript auto-frame hold is active (for example after scrolling up).
}

function nativeInputTraceData(event: NativeInputEvent): RendererTraceInputData {
  switch (event.type) {
    case 'key':
      return {
        type: 'key',
        key: event.key,
        ctrl: event.ctrl,
        alt: event.alt,
        shift: event.shift,
      };
    case 'mouse':
      return {
        type: 'mouse',
        button: event.button,
        action: event.action,
        x: event.x,
        y: event.y,
        ctrl: event.ctrl,
        alt: event.alt,
        shift: event.shift,
      };
    case 'focus':
      return {
        type: 'focus',
        action: event.focused ? 'in' : 'out',
      };
    case 'paste':
      return {
        type: 'paste',
      };
    case 'terminal-mode-report':
      return {
        type: 'terminal-mode-report',
      };
    case 'unknown':
      return {
        type: 'unknown',
      };
  }
}

function createFrameMetrics(
  startedAt: number,
  endedAt: number,
  targetFrameMs: number,
  present: NativeFramePresentResult | undefined,
  size: NativeTerminalSize,
  phases: {
    readonly renderCallbackDurationMs: number;
  },
): NativeTerminalRendererFrameMetrics {
  const durationMs = Math.max(0, endedAt - startedAt);
  const composition = compositionStatsFromPresent(present);
  const diff = present?.diff;
  const timing = present?.timing;
  const lineCacheFrame = composition?.lineCacheFrame;
  return {
    startedAt,
    endedAt,
    durationMs,
    targetFrameMs,
    overBudget: durationMs > targetFrameMs || present?.backpressure === true,
    renderCallbackDurationMs: phases.renderCallbackDurationMs,
    presentDurationMs: timing?.totalDurationMs ?? 0,
    diffDurationMs: timing?.diffDurationMs ?? 0,
    encodeDurationMs: timing?.encodeDurationMs ?? 0,
    writeDurationMs: timing?.writeDurationMs ?? 0,
    qualityDurationMs: 0,
    outputBytes: present?.bytes ?? 0,
    outputBackpressure: present?.backpressure ?? false,
    outputCells: diff?.outputCells ?? diff?.changedCells ?? 0,
    outputRuns: diff?.renderRuns ?? 0,
    outputBridgedCells: diff?.bridgedCells ?? 0,
    outputBridgedCellRatio: ratio(diff?.bridgedCells ?? 0, diff?.outputCells ?? 0),
    cursorAbsoluteMoves: present?.cursorMotion.absoluteMoves ?? 0,
    cursorRelativeMoves: present?.cursorMotion.relativeMoves ?? 0,
    cursorHorizontalAbsoluteMoves: present?.cursorMotion.horizontalAbsoluteMoves ?? 0,
    cursorMoveBytes: present?.cursorMotion.moveBytes ?? 0,
    cursorMoveAbsoluteBytes: present?.cursorMotion.absoluteMoveBytes ?? 0,
    cursorMoveSavedBytes: present?.cursorMotion.savedBytes ?? 0,
    outputMode: present?.outputPolicy.mode ?? 'empty',
    outputSynchronized: present?.outputPolicy.synchronized ?? false,
    outputLargeFrame: present?.outputPolicy.largeFrame ?? false,
    outputPolicyReason: present?.outputPolicy.reason ?? 'empty',
    outputEraseLine: present?.outputPolicy.eraseLine ?? false,
    changedCells: present?.diff.changedCells ?? 0,
    scannedCells: present?.diff.scannedCells ?? 0,
    scannedRows: present?.diff.scannedRows ?? 0,
    dirtyRows: present?.diff.dirtyRows ?? 0,
    totalCells: present?.diff.totalCells ?? size.columns * size.rows,
    scanStrategy: diff?.scanStrategy ?? 'none',
    scanRatio: diff?.scanRatio ?? 0,
    damageCells: diff?.damageCells ?? 0,
    damageRatio: diff?.damageRatio ?? 0,
    compositionRowsVisited: composition?.rowsVisited ?? 0,
    compositionRowsComposed: composition?.rowsComposed ?? 0,
    compositionRowsReused: composition?.rowsReused ?? 0,
    compositionReuseRatio: ratio(
      composition?.rowsReused ?? 0,
      (composition?.rowsComposed ?? 0) + (composition?.rowsReused ?? 0),
    ),
    lineCacheHits: lineCacheFrame?.hits ?? 0,
    lineCacheMisses: lineCacheFrame?.misses ?? 0,
    lineCacheHitRatio: lineCacheFrame?.hitRatio ?? 0,
    lineCacheEvictions: lineCacheFrame?.evictions ?? 0,
  };
}

function compositionStatsFromPresent(
  present: NativeFramePresentResult | undefined,
): RendererCompositionStats | undefined {
  if (present === undefined) return undefined;
  if (!('composition' in present)) return undefined;
  const composition = present.composition;
  if (typeof composition !== 'object' || composition === null) return undefined;
  return composition as RendererCompositionStats;
}

function ratio(value: number, total: number): number {
  return total <= 0 ? 0 : value / total;
}

function duration(startedAt: number, endedAt: number): number {
  return Math.max(0, endedAt - startedAt);
}
