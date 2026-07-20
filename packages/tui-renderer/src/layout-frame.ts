import {
  composeRendererRegions,
  type RendererCompositionStats,
  type RendererRegionLayer,
  type RendererRegionLine,
  type RendererRect,
  type RendererCompositionOptions,
} from './compositor';
import type { RendererCell } from './cell-buffer';
import {
  NativeFrameRenderer,
  type NativeFramePresentResult,
} from './native-frame';
import { rendererRegionsRequireAnimationFrame } from './region-vfx';
import type { RendererCursorState } from './terminal-output';

export interface RendererLineSource {
  render(width: number): readonly string[];
}

export type RendererFrameRegionContent =
  | RendererLineSource
  | readonly RendererRegionLine[]
  | ((width: number) => readonly RendererRegionLine[]);

export interface RendererFrameRegion
  extends Omit<RendererRegionLayer, 'lines' | 'rect'> {
  readonly rect: RendererRect;
  readonly content: RendererFrameRegionContent;
}

export interface NativeLayoutFrameResult extends NativeFramePresentResult {
  readonly composition: RendererCompositionStats;
  readonly regions: readonly RendererRegionLayer[];
}

export function renderNativeLayoutFrame(
  renderer: NativeFrameRenderer,
  regions: readonly RendererFrameRegion[],
  options: {
    readonly clear?: boolean;
    readonly fill?: RendererCell;
    readonly force?: boolean;
    readonly forceCursor?: boolean;
    readonly rewriteUnchanged?: boolean;
    readonly cursor?: RendererCursorState;
    readonly composition?: RendererCompositionOptions;
  } = {},
): NativeLayoutFrameResult {
  const layers = regions.map((region) => frameRegionToLayer(region));
  const reusableRows = options.composition?.cache?.beginFrame({
    bufferWidth: renderer.width,
    bufferHeight: renderer.height,
    layers,
  }) ?? false;
  // When the composition cache is invalidated (topology change — e.g. splash
  // fullscreen-takeover → main UI transition), the buffer MUST be cleared
  // regardless of the caller's damage-only policy.  Without this, a stale
  // buffer (splash content) survives because the ambient animation guard
  // (clear=false) was designed for steady-state ticks where the previous
  // frame's content is still valid.  The fill (canvas background) prevents
  // any visible "black flash"; synchronized output avoids tearing.
  const clear = !reusableRows || (options.clear ?? false);
  const timeVaryingVfx = rendererRegionsRequireAnimationFrame(layers);
  const canReuseRows = reusableRows && !clear && !timeVaryingVfx;
  renderer.beginFrame({ clear, fill: options.fill });
  const composition = composeRendererRegions(renderer.frame, layers, {
    ...options.composition,
    reuseCachedRows: canReuseRows,
    // Ambient / chase VFX never reuse rows — skip cache warm + Θ(width) keys.
    cache: timeVaryingVfx ? undefined : options.composition?.cache,
  });
  if (options.cursor !== undefined) {
    renderer.setCursor(options.cursor);
  }
  const present = renderer.present({
    force: options.force,
    forceCursor: options.forceCursor,
    rewriteUnchanged: options.rewriteUnchanged,
  });
  return { ...present, composition, regions: layers };
}

function frameRegionToLayer(region: RendererFrameRegion): RendererRegionLayer {
  const width = Math.max(0, Math.floor(region.rect.width));
  return {
    id: region.id,
    rect: region.rect,
    lines: resolveRegionContent(region.content, width),
    zIndex: region.zIndex,
    visible: region.visible,
    scrollY: region.scrollY,
    style: region.style,
    clear: region.clear,
    background: region.background,
    vfx: region.vfx,
  };
}

function resolveRegionContent(
  content: RendererFrameRegionContent,
  width: number,
): readonly RendererRegionLine[] {
  if (typeof content === 'function') return content(width);
  if (isRendererLineSource(content)) return content.render(width);
  return content;
}

function isRendererLineSource(value: unknown): value is RendererLineSource {
  return (
    typeof value === 'object' &&
    value !== null &&
    'render' in value &&
    typeof (value as { render?: unknown }).render === 'function'
  );
}
