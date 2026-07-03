import type { RendererCellStyle } from './cell-buffer';
import type { RendererRegionVfx, RendererRect } from './compositor';
import {
  RendererAnimationFrameGate,
  type RendererAnimationClock,
  type RendererAnimationFrameCallback,
} from './animation';
import {
  type RendererCellVfxDirection,
  type RendererCellVfxOptions,
  type RendererCellVfxTarget,
  type RendererCellVfxTimingOptions,
} from './cell-vfx';
import {
  resolveRendererEffectLevel,
  type RendererEffectLevel,
  type RendererEffectPolicyOptions,
} from './effects';

export type RendererRegionVfxPreset = 'focus-pulse' | 'loading-shimmer' | 'content-reveal';

export interface RendererRegionVfxPresetOptions
  extends RendererEffectPolicyOptions,
    RendererCellVfxTimingOptions {
  readonly preset: RendererRegionVfxPreset;
  readonly rect?: RendererRect;
  readonly color?: string;
  readonly style?: RendererCellStyle;
  readonly target?: RendererCellVfxTarget;
  readonly minIntensity?: number;
  readonly maxIntensity?: number;
  readonly width?: number;
  readonly direction?: RendererCellVfxDirection;
  readonly hiddenStyle?: RendererCellStyle;
  readonly maskChar?: string;
  readonly premiumIntervalMs?: number;
  readonly subtleIntervalMs?: number;
}

export interface RendererResolvedRegionVfxPreset {
  readonly preset: RendererRegionVfxPreset;
  readonly effectLevel: RendererEffectLevel;
  readonly vfx?: RendererRegionVfx;
}

export interface RendererRegionVfxAnimationSource {
  readonly vfx?: RendererRegionVfx;
}

export interface RendererRegionVfxAnimationSchedulerOptions {
  readonly clock: RendererAnimationClock;
  readonly onFrame?: RendererAnimationFrameCallback;
}

interface RendererRegionVfxPresetDefaults {
  readonly premiumIntervalMs: number;
  readonly subtleIntervalMs: number;
  readonly color: string;
}

const REGION_VFX_PRESET_DEFAULTS = {
  'focus-pulse': {
    premiumIntervalMs: 1400,
    subtleIntervalMs: 1900,
    color: '#ffffff',
  },
  'loading-shimmer': {
    premiumIntervalMs: 900,
    subtleIntervalMs: 1300,
    color: '#ffffff',
  },
  'content-reveal': {
    premiumIntervalMs: 520,
    subtleIntervalMs: 700,
    color: '#ffffff',
  },
} satisfies Record<RendererRegionVfxPreset, RendererRegionVfxPresetDefaults>;

export function createRendererRegionVfx(
  options: RendererRegionVfxPresetOptions,
): RendererRegionVfx | undefined {
  return resolveRendererRegionVfxPreset(options).vfx;
}

export function rendererRegionVfxRequiresAnimationFrame(
  vfx: RendererRegionVfx | undefined,
): boolean {
  if (vfx === undefined || vfx.effect.kind === 'none') return false;
  if (vfx.effect.progress !== undefined) return false;
  if (vfx.effect.nowMs === undefined) return false;
  return vfx.effect.intervalMs === undefined ||
    (Number.isFinite(vfx.effect.intervalMs) && vfx.effect.intervalMs > 0);
}

export function rendererRegionsRequireAnimationFrame(
  regions: readonly RendererRegionVfxAnimationSource[],
): boolean {
  return regions.some((region) => rendererRegionVfxRequiresAnimationFrame(region.vfx));
}

export class RendererRegionVfxAnimationScheduler {
  private readonly gate: RendererAnimationFrameGate;

  constructor(options: RendererRegionVfxAnimationSchedulerOptions) {
    this.gate = new RendererAnimationFrameGate({
      clock: options.clock,
      onFrame: options.onFrame,
    });
  }

  get hasPendingFrame(): boolean {
    return this.gate.hasPendingFrame;
  }

  requestForRegions(
    regions: readonly RendererRegionVfxAnimationSource[],
    callback?: RendererAnimationFrameCallback,
  ): boolean {
    if (!rendererRegionsRequireAnimationFrame(regions)) return false;
    return this.gate.request(callback);
  }

  cancel(): void {
    this.gate.cancel();
  }
}

export function resolveRendererRegionVfxPreset(
  options: RendererRegionVfxPresetOptions,
): RendererResolvedRegionVfxPreset {
  const effectLevel = resolveRendererEffectLevel(options);
  if (effectLevel === 'off') return { preset: options.preset, effectLevel };

  if (options.preset === 'content-reveal' && options.motion !== undefined && options.motion !== 'normal') {
    return { preset: options.preset, effectLevel };
  }

  return {
    preset: options.preset,
    effectLevel,
    vfx: {
      rect: options.rect,
      effect: createRendererRegionPresetEffect(options, effectLevel),
    },
  };
}

function createRendererRegionPresetEffect(
  options: RendererRegionVfxPresetOptions,
  effectLevel: RendererEffectLevel,
): RendererCellVfxOptions {
  switch (options.preset) {
    case 'focus-pulse':
      return createFocusPulseEffect(options, effectLevel);
    case 'loading-shimmer':
      return effectLevel === 'premium'
        ? createLoadingShimmerEffect(options, effectLevel)
        : createLoadingPulseEffect(options, effectLevel);
    case 'content-reveal':
      return createContentRevealEffect(options, effectLevel);
  }
}

function createFocusPulseEffect(
  options: RendererRegionVfxPresetOptions,
  effectLevel: RendererEffectLevel,
): RendererCellVfxOptions {
  return {
    kind: 'pulse',
    ...createRegionVfxTiming(options, effectLevel),
    color: options.color ?? REGION_VFX_PRESET_DEFAULTS['focus-pulse'].color,
    style: options.style,
    target: options.target ?? 'fg',
    minIntensity: options.minIntensity ?? (effectLevel === 'premium' ? 0.12 : 0.08),
    maxIntensity: options.maxIntensity ?? (effectLevel === 'premium' ? 0.45 : 0.25),
  };
}

function createLoadingShimmerEffect(
  options: RendererRegionVfxPresetOptions,
  effectLevel: RendererEffectLevel,
): RendererCellVfxOptions {
  return {
    kind: 'shimmer',
    ...createRegionVfxTiming(options, effectLevel),
    color: options.color ?? REGION_VFX_PRESET_DEFAULTS['loading-shimmer'].color,
    style: options.style,
    target: options.target ?? 'fg',
    width: options.width ?? 3,
    direction: options.direction ?? 'forward',
  };
}

function createLoadingPulseEffect(
  options: RendererRegionVfxPresetOptions,
  effectLevel: RendererEffectLevel,
): RendererCellVfxOptions {
  return {
    kind: 'pulse',
    ...createRegionVfxTiming(options, effectLevel),
    color: options.color ?? REGION_VFX_PRESET_DEFAULTS['loading-shimmer'].color,
    style: options.style,
    target: options.target ?? 'fg',
    minIntensity: options.minIntensity ?? 0.08,
    maxIntensity: options.maxIntensity ?? 0.24,
  };
}

function createContentRevealEffect(
  options: RendererRegionVfxPresetOptions,
  effectLevel: RendererEffectLevel,
): RendererCellVfxOptions {
  return {
    kind: 'reveal',
    ...createRegionVfxTiming(options, effectLevel, { finalWhenStatic: true }),
    hiddenStyle: options.hiddenStyle ?? { dim: true },
    maskChar: options.maskChar ?? ' ',
  };
}

function createRegionVfxTiming(
  options: RendererRegionVfxPresetOptions,
  effectLevel: RendererEffectLevel,
  behavior: { readonly finalWhenStatic?: boolean } = {},
): RendererCellVfxTimingOptions {
  return {
    progress: options.progress ?? (behavior.finalWhenStatic === true && options.nowMs === undefined ? 1 : undefined),
    nowMs: options.nowMs,
    intervalMs: resolveRegionVfxIntervalMs(options, effectLevel),
    seed: options.seed,
    offset: options.offset,
  };
}

function resolveRegionVfxIntervalMs(
  options: RendererRegionVfxPresetOptions,
  effectLevel: RendererEffectLevel,
): number {
  if (options.intervalMs !== undefined) return normalizeRegionVfxIntervalMs(options.intervalMs);
  const defaults = REGION_VFX_PRESET_DEFAULTS[options.preset];
  const requested = effectLevel === 'premium' ? options.premiumIntervalMs : options.subtleIntervalMs;
  return normalizeRegionVfxIntervalMs(
    requested ?? (effectLevel === 'premium' ? defaults.premiumIntervalMs : defaults.subtleIntervalMs),
  );
}

function normalizeRegionVfxIntervalMs(value: number): number {
  if (!Number.isFinite(value) || value <= 0) return 0;
  return Math.floor(value);
}
