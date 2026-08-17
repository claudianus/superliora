import type { NativeFrameRenderer, NativeFrameRendererOptions } from '../native/frame';
import type { NativeRenderFrame } from '../frame/render-loop';
import type { NativeTerminalSession, NativeTerminalSize } from '../terminal/session';
import type { RendererCell } from '../cell-buffer/index';
import type { RendererQualityController, RendererQualitySnapshot } from '../frame/quality';
import type { RendererLineCellCache } from '../render/line-cache';
import type { RendererCompositionCache } from '../render/compositor';
import {
  createFrameMetrics,
  frameDuration,
} from './support';
import type {
  NativeTerminalRendererFrameMetrics,
  NativeTerminalRendererOptions,
  NativeTerminalRendererRenderResult,
} from './types';
import type { NativeTerminalRenderer } from './index';
import {
  clearStaleNativeRendererFrameRows,
  resolveNativeRendererFrameHeight,
  type NativeRendererResizeContext,
} from './resize';

export interface NativeRendererFramePipelineContext {
  readonly frameRenderer: NativeFrameRenderer;
  readonly compositionCache: RendererCompositionCache | undefined;
  readonly lineCache: RendererLineCellCache | undefined;
  readonly qualityController: RendererQualityController;
  readonly adaptiveQualityEnabled: boolean;
  readonly options: NativeTerminalRendererOptions;
  readonly runtime: NativeTerminalRenderer;
  readonly resizeContext: NativeRendererResizeContext;
  readonly measureFrameHeight: ((size: NativeTerminalSize) => number) | undefined;
  readonly frameIntervalMs: number;
  readonly now: () => number;
  readonly onBackpressure: () => void;
  readonly onQualityChange: (
    frame: NativeRenderFrame,
    previous: RendererQualitySnapshot,
    current: RendererQualitySnapshot,
    metrics: NativeTerminalRendererFrameMetrics,
  ) => void;
}

export function createNativeFrameRendererOptions(
  session: NativeTerminalSession,
  size: NativeTerminalSize,
  currentSynchronized: boolean | undefined,
  options: Pick<
    NativeTerminalRendererOptions,
    'resetStyle' | 'originX' | 'originY' | 'eraseLine' | 'colorMode' | 'imageProtocol' | 'outputPolicy' | 'fill'
  >,
  now: () => number,
): NativeFrameRendererOptions {
  return {
    width: size.columns,
    height: size.rows,
    output: session,
    synchronized: currentSynchronized,
    resetStyle: options.resetStyle,
    originX: options.originX,
    originY: options.originY,
    eraseLine: options.eraseLine,
    canvasBackground: options.fill?.style?.bg,
    colorMode: options.colorMode,
    inlineImageProtocol: options.imageProtocol,
    outputPolicy: options.outputPolicy,
    now,
  };
}

export function executeNativeRendererFrame(
  context: NativeRendererFramePipelineContext,
  frame: NativeRenderFrame,
  size: NativeTerminalSize,
): NativeTerminalRendererRenderResult {
  const startedAt = context.now();
  const qualityBeforeRender = context.qualityController.snapshot();
  const previousHeight = context.frameRenderer.height;
  const frameHeight = resolveNativeRendererFrameHeight(size, context.measureFrameHeight);
  if (size.columns !== context.frameRenderer.width || frameHeight !== previousHeight) {
    // The frame buffer is recreated on resize; rows composed into the old
    // buffer must not be reused (skipped) when composing the new one.
    context.compositionCache?.reset();
  }
  context.frameRenderer.resize(size.columns, frameHeight);
  if (!frame.causes.includes('start')) {
    clearStaleNativeRendererFrameRows(context.resizeContext, frameHeight, previousHeight);
  }
  if (context.options.autoBeginFrame !== false) {
    context.frameRenderer.beginFrame({ fill: context.options.fill });
  }
  const renderCallbackStartedAt = context.now();
  const renderResult = context.options.render({
    frame,
    renderer: context.frameRenderer,
    runtime: context.runtime,
    size,
    lineCache: context.lineCache,
    compositionCache: context.compositionCache,
    quality: qualityBeforeRender,
  });
  const renderCallbackEndedAt = context.now();
  const present = renderResult ?? context.frameRenderer.present();
  const endedAt = context.now();
  const metricsBeforeQuality = createFrameMetrics(
    startedAt,
    endedAt,
    context.frameIntervalMs,
    present,
    size,
    {
      renderCallbackDurationMs: frameDuration(renderCallbackStartedAt, renderCallbackEndedAt),
    },
  );
  if (present?.backpressure) context.onBackpressure();
  const qualityStartedAt = context.now();
  const previousQuality = context.qualityController.snapshot();
  const quality = context.adaptiveQualityEnabled
    ? context.qualityController.record(metricsBeforeQuality)
    : context.qualityController.snapshot();
  const qualityEndedAt = context.now();
  const metrics = {
    ...metricsBeforeQuality,
    qualityDurationMs: frameDuration(qualityStartedAt, qualityEndedAt),
  };
  if (quality.changes !== previousQuality.changes) {
    context.onQualityChange(frame, previousQuality, quality, metrics);
  }
  return { frame, size, present, metrics, quality };
}

export function shouldScheduleNativeRendererRegionVfxFrames(input: {
  readonly shouldHoldAutoFrameCause: (cause: 'animation') => boolean;
  readonly shouldDeferFrameForBackpressure: () => boolean;
  readonly regionVfxFrames: NativeTerminalRendererOptions['regionVfxFrames'];
  readonly currentSynchronized: boolean | undefined;
  readonly screenMode: NativeTerminalRendererOptions['screenMode'];
  readonly synchronized: boolean | undefined;
}): boolean {
  if (input.shouldHoldAutoFrameCause('animation')) return false;
  if (input.shouldDeferFrameForBackpressure()) return false;
  const policy = input.regionVfxFrames ?? 'auto';
  switch (policy) {
    case 'always':
      return true;
    case 'never':
      return false;
    case 'auto':
      return (
        input.currentSynchronized === true ||
        input.screenMode === 'alternate' ||
        input.synchronized === true
      );
  }
}
