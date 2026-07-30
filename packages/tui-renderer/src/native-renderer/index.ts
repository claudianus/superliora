import { NativeFrameRenderer } from '../native/frame';
import { NativeInputDecoder, type NativeInputEvent } from '../input-events/index';
import {
  NativeRenderLoop,
  type NativeAnimationFrameCallback,
  type NativeRenderCause,
  type NativeRenderFrame,
} from '../frame/render-loop';
import {
  NativeTerminalSession,
  type NativeTerminalSize,
} from '../terminal/session';
import type { NativeTerminalSynchronizedOutputProbeResult } from '../terminal/probe';
import {
  diagnoseNativeRendererStats,
  type RendererDiagnosticsSnapshot,
} from '../diagnostics/index';
import {
  mergeNativeTerminalFeatureOptions,
} from '../terminal/features';
import { NativeFrameStats, type NativeFrameStatsSnapshot } from '../frame/stats';
import { RendererLineCellCache } from '../render/line-cache';
import { RendererCompositionCache } from '../render/compositor';
import {
  renderNativeLayoutFrame,
  type NativeLayoutFrameResult,
  type RendererFrameRegion,
} from '../layout/layout-frame';
import {
  RendererQualityController,
  type RendererQualitySnapshot,
} from '../frame/quality';
import {
  RendererRegionVfxAnimationScheduler,
  type RendererRegionVfxAnimationSource,
} from '../region-vfx';
import {
  RendererTraceRecorder,
  type RendererChromeTraceFile,
  type RendererChromeTraceOptions,
  type RendererTraceSnapshot,
} from '../trace';
import type { RendererAnimationFrameCallback } from '../motion/animation';
import {
  RendererAmbientSchedule,
  type RendererAmbientScheduleOptions,
} from '../motion/ambient-schedule';
import {
  createCompositionCache,
  createLineCache,
  createQualityController,
  createTraceRecorder,
  nativeInputTraceData,
} from './support';
import { NativeRendererAutoFrameHold } from './auto-frame-hold';
import { NativeRendererBackpressure } from './backpressure';
import { NativeRendererSyncProbe } from './sync-probe';
import { handleNativeRendererTerminalResize } from './resize';
import {
  createNativeFrameRendererOptions,
  executeNativeRendererFrame,
  shouldScheduleNativeRendererRegionVfxFrames,
} from './frame-pipeline';
import type {
  NativeTerminalRendererAutoFrameHold,
  NativeTerminalRendererFrameMetrics,
  NativeTerminalRendererLayoutFrameOptions,
  NativeTerminalRendererOptions,
  NativeTerminalRendererQualityChange,
  NativeTerminalRendererRegionVfxFramePolicy,
  NativeTerminalRendererRender,
  NativeTerminalRendererRenderResult,
} from './types';

export type {
  NativeTerminalRendererAutoFrameHold,
  NativeTerminalRendererFrame,
  NativeTerminalRendererFrameMetrics,
  NativeTerminalRendererLayoutFrameOptions,
  NativeTerminalRendererOptions,
  NativeTerminalRendererQualityChange,
  NativeTerminalRendererRegionVfxFramePolicy,
  NativeTerminalRendererRender,
  NativeTerminalRendererRenderResult,
} from './types';

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
  private readonly inputDecoder = new NativeInputDecoder({
    onResolvedEvents: (events) => {
      this.dispatchDecodedInputEvents(events);
    },
  });
  private lastRenderResult: NativeTerminalRendererRenderResult | undefined;
  private readonly options: NativeTerminalRendererOptions;
  private readonly adaptiveQualityEnabled: boolean;
  private regionVfxScheduler: RendererRegionVfxAnimationScheduler | undefined;
  private currentSynchronized: boolean | undefined;
  private measureFrameHeightOverride: ((size: NativeTerminalSize) => number) | undefined;
  private ambientSchedule!: RendererAmbientSchedule;
  private readonly autoFrameHold: NativeRendererAutoFrameHold;
  private readonly backpressure: NativeRendererBackpressure;
  private readonly syncProbe: NativeRendererSyncProbe;

  constructor(options: NativeTerminalRendererOptions) {
    this.options = mergeNativeTerminalFeatureOptions(options.features, options);
    this.currentSynchronized = this.options.synchronized;
    this.frameStats = new NativeFrameStats({ windowSize: this.options.statsWindowSize });
    this.lineCache = createLineCache(this.options.lineCache);
    this.compositionCache = createCompositionCache(this.options.compositionCache);
    this.qualityController = createQualityController(this.options.adaptiveQuality);
    this.trace = createTraceRecorder(this.options.trace);
    this.adaptiveQualityEnabled = this.options.adaptiveQuality !== false;
    this.backpressure = new NativeRendererBackpressure(
      this.options.output,
      this.options.deferFramesDuringBackpressure,
      {
        now: () => this.loop.now(),
        recordMarker: (name, args) => {
          this.trace.recordMarker({ timestampMs: this.loop.now(), name, args });
        },
        cancelRegionAnimationFrame: () => this.cancelRegionAnimationFrame(),
        loopRequestRender: (cause) => this.loop.requestRender(cause),
        loopRequestAnimationFrame: (callback) => this.loop.requestAnimationFrame(callback),
      },
    );
    this.autoFrameHold = new NativeRendererAutoFrameHold(this.options.autoFrameHold, {
      now: () => this.loop.now(),
      recordMarker: (name, args) => {
        this.trace.recordMarker({ timestampMs: this.loop.now(), name, args });
      },
      cancelRegionAnimationFrame: () => this.cancelRegionAnimationFrame(),
      requestRenderDirect: (cause) => this.loop.requestRender(cause),
      requestAnimationFrameDirect: (callback) => this.loop.requestAnimationFrame(callback),
      shouldDeferFrameForBackpressure: () => this.backpressure.shouldDefer(),
      deferRenderCause: (cause) => this.backpressure.deferRenderCause(cause),
      deferAnimationFrame: (callback) => this.backpressure.deferAnimationFrame(callback),
      cancelDeferredAnimationFrame: (id) => this.backpressure.cancelDeferredAnimationFrame(id),
      loopCancelAnimationFrame: (id) => this.loop.cancelAnimationFrame(id),
    });
    this.syncProbe = new NativeRendererSyncProbe(
      {
        input: this.options.input,
        output: this.options.output,
        scheduler: this.options.scheduler,
        synchronizedOutputProbe: this.options.synchronizedOutputProbe,
        synchronizedOutputProbeTimeoutMs: this.options.synchronizedOutputProbeTimeoutMs,
        unrefTimers: this.options.unrefTimers,
      },
      {
        now: () => this.loop.now(),
        recordMarker: (name, args) => {
          this.trace.recordMarker({ timestampMs: this.loop.now(), name, args });
        },
        getCurrentSynchronized: () => this.currentSynchronized,
        setSynchronizedOutput: (synchronized) => this.setSynchronizedOutput(synchronized),
        onSynchronizedOutputProbe: this.options.onSynchronizedOutputProbe,
      },
    );
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
          this.dispatchDecodedInputEvents(this.inputDecoder.decode(data));
        }
      },
      onResize: (size) => {
        this.handleResize(size);
      },
    });
    this.frameRenderer = new NativeFrameRenderer(
      createNativeFrameRendererOptions(
        this.session,
        this.session.size,
        this.currentSynchronized,
        this.options,
        () => this.loop.now(),
      ),
    );
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
    this.ambientSchedule = new RendererAmbientSchedule({
      scheduler: this.options.scheduler,
      unrefTimers: this.options.unrefTimers,
      requestRender: () => this.requestRender('animation'),
      getContext: () => ({
        quality: this.quality.level,
        health: this.frameStats.snapshot().health,
        backpressure: this.backpressure.isActive,
      }),
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
    return this.syncProbe.result;
  }

  private dispatchDecodedInputEvents(events: readonly NativeInputEvent[]): void {
    for (const event of events) {
      this.trace.recordInput({
        timestampMs: this.loop.now(),
        input: nativeInputTraceData(event),
      });
      this.options.onInputEvent?.(event);
      this.options.inputRouter?.dispatch(event);
    }
  }

  get isOutputBackpressured(): boolean {
    return this.backpressure.isActive;
  }

  get areAutoFramesHeld(): boolean {
    return this.autoFrameHold.areHeld();
  }

  get stats(): NativeFrameStatsSnapshot {
    return this.frameStats.snapshot();
  }

  get quality(): RendererQualitySnapshot {
    return this.qualityController.snapshot();
  }

  get diagnostics(): RendererDiagnosticsSnapshot {
    return diagnoseNativeRendererStats(this.stats, this.quality, {
      synchronizedOutputProbeResult: this.syncProbe.result,
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
    this.syncProbe.start();
    this.frameRenderer.resize(this.size.columns, this.size.rows);
    this.loop.start();
  }

  stop(): void {
    if (!this.started) return;
    this.started = false;
    this.ambientSchedule.dispose();
    this.syncProbe.abort();
    this.backpressure.clear();
    this.autoFrameHold.clear();
    // Drop any bare-ESC timer so a stopped renderer cannot emit late Escape.
    this.inputDecoder.dispose();
    this.loop.stop();
    this.session.stop();
  }

  setAmbientSchedule(options: RendererAmbientScheduleOptions | undefined): void {
    this.ambientSchedule.set(options);
  }

  requestRender(cause: NativeRenderCause = 'request'): void {
    this.autoFrameHold.requestRender(cause);
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
    return this.autoFrameHold.requestAnimationFrame(callback);
  }

  cancelAnimationFrame(id: number): void {
    this.autoFrameHold.cancelAnimationFrame(id);
  }

  setAutoFrameHold(held: boolean): void {
    this.autoFrameHold.setOverride(held);
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
    this.autoFrameHold.clearOverride();
  }

  releaseHeldAutoFrames(): void {
    this.autoFrameHold.releaseHeld();
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
      beforePresent: options.beforePresent,
      composition: {
        lineCache: this.lineCache,
        cache: this.compositionCache,
      },
    });
    if (options.scheduleRegionVfx !== false) this.requestAnimationFrameForRegions(regions);
    return result;
  }

  private handleResize(size: NativeTerminalSize): void {
    handleNativeRendererTerminalResize(
      {
        screenMode: this.options.screenMode,
        originX: this.options.originX,
        originY: this.options.originY,
        frameRenderer: this.frameRenderer,
        compositionCache: this.compositionCache,
      },
      size,
      {
        now: () => this.loop.now(),
        recordResize: (resizeSize) => {
          this.trace.recordResize({
            timestampMs: this.loop.now(),
            size: resizeSize,
          });
        },
        onResize: this.options.onResize,
        requestRender: () => this.loop.requestRender('resize'),
      },
    );
  }

  private shouldScheduleRegionVfxFrames(): boolean {
    return shouldScheduleNativeRendererRegionVfxFrames({
      shouldHoldAutoFrameCause: (cause) => this.autoFrameHold.shouldHoldAutoFrameCause(cause),
      shouldDeferFrameForBackpressure: () => this.backpressure.shouldDefer(),
      regionVfxFrames: this.options.regionVfxFrames,
      currentSynchronized: this.currentSynchronized,
      screenMode: this.options.screenMode,
      synchronized: this.options.synchronized,
    });
  }

  private renderFrame(frame: NativeRenderFrame): NativeTerminalRendererRenderResult {
    return executeNativeRendererFrame(
      {
        frameRenderer: this.frameRenderer,
        compositionCache: this.compositionCache,
        lineCache: this.lineCache,
        qualityController: this.qualityController,
        adaptiveQualityEnabled: this.adaptiveQualityEnabled,
        options: this.options,
        runtime: this,
        resizeContext: {
          screenMode: this.options.screenMode,
          originX: this.options.originX,
          originY: this.options.originY,
          frameRenderer: this.frameRenderer,
          compositionCache: this.compositionCache,
        },
        measureFrameHeight:
          this.measureFrameHeightOverride ?? this.options.measureFrameHeight,
        frameIntervalMs: this.loop.frameIntervalMs,
        now: () => this.loop.now(),
        onBackpressure: () => this.backpressure.handleBackpressure(),
        onQualityChange: (renderFrame, previous, current, metrics) => {
          this.handleQualityChange(renderFrame, previous, current, metrics);
        },
      },
      frame,
      this.size,
    );
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
}
