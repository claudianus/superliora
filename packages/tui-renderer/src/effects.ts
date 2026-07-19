import type { NativeFrameStatsHealth } from './frame-stats';
import type { RendererQualityLevel } from './quality';

export type RendererEffectLevel = 'off' | 'subtle' | 'premium';
export type RendererMotionPreference = 'normal' | 'reduced' | 'none';

export interface RendererEffectPolicyOptions {
  readonly requested?: RendererEffectLevel;
  readonly quality?: RendererQualityLevel;
  readonly health?: NativeFrameStatsHealth;
  readonly motion?: RendererMotionPreference;
}

export interface RendererAnimationFrameIntervalOptions extends RendererEffectPolicyOptions {
  readonly fps: number;
  readonly minFps?: number;
  readonly maxFps?: number;
  readonly defaultFps?: number;
  readonly premiumMs?: number;
  readonly subtleMs?: number;
  readonly offMs?: number;
}

const EFFECT_LEVELS: readonly RendererEffectLevel[] = ['off', 'subtle', 'premium'];
const DEFAULT_ANIMATION_FPS = 30;
const MIN_ANIMATION_FPS = 1;
const MAX_ANIMATION_FPS = 240;

export function resolveRendererEffectLevel(
  options: RendererEffectPolicyOptions = {},
): RendererEffectLevel {
  const requested = options.requested ?? 'subtle';
  const motion = options.motion ?? 'normal';
  const quality = options.quality ?? 'full';
  const health = options.health ?? 'healthy';

  if (
    requested === 'off' ||
    motion === 'none' ||
    quality === 'minimal' ||
    health === 'degraded'
  ) {
    return 'off';
  }
  if (
    requested === 'premium' &&
    (motion === 'reduced' || quality === 'balanced' || health === 'watch')
  ) {
    return 'subtle';
  }
  return requested;
}

export function rendererEffectAllows(
  current: RendererEffectLevel,
  required: RendererEffectLevel,
): boolean {
  return effectIndex(current) >= effectIndex(required);
}

export function rendererEffectFrameIntervalMs(
  effect: RendererEffectLevel,
  options: {
    readonly premiumMs?: number;
    readonly subtleMs?: number;
    readonly offMs?: number;
  } = {},
): number {
  switch (effect) {
    case 'premium':
      return normalizeIntervalMs(options.premiumMs, 160);
    case 'subtle':
      return normalizeIntervalMs(options.subtleMs, 420);
    case 'off':
      return normalizeIntervalMs(options.offMs, Number.POSITIVE_INFINITY);
  }
}

export const RENDERER_AMBIENT_PREMIUM_MS = 16;
export const RENDERER_AMBIENT_SUBTLE_MS = 100;

export interface RendererAmbientIntervalOptions {
  readonly requested: RendererEffectLevel;
  readonly quality?: RendererQualityLevel;
  readonly health?: NativeFrameStatsHealth;
  readonly backpressure?: boolean;
  readonly premiumMs?: number;
  readonly subtleMs?: number;
}

export function rendererAmbientShouldSoftDegrade(options: {
  readonly quality?: RendererQualityLevel;
  readonly health?: NativeFrameStatsHealth;
  readonly backpressure?: boolean;
}): boolean {
  const quality = options.quality ?? 'full';
  const health = options.health ?? 'healthy';
  if (options.backpressure === true) return true;
  if (quality !== 'full') return true;
  if (health === 'watch' || health === 'degraded') return true;
  return false;
}

export function rendererAmbientIntervalMs(options: RendererAmbientIntervalOptions): number {
  if (options.requested === 'off') return Number.POSITIVE_INFINITY;
  const premiumMs = normalizeAmbientMs(options.premiumMs, RENDERER_AMBIENT_PREMIUM_MS);
  const subtleMs = normalizeAmbientMs(options.subtleMs, RENDERER_AMBIENT_SUBTLE_MS);
  if (options.requested === 'subtle') return subtleMs;
  // premium
  if (rendererAmbientShouldSoftDegrade(options)) return subtleMs;
  return premiumMs;
}

export function rendererAnimationFrameIntervalMs(
  options: RendererAnimationFrameIntervalOptions,
): number {
  if (options.fps <= 0) return Number.POSITIVE_INFINITY;
  const fps = normalizeAnimationFps(options.fps, options);
  const requestedIntervalMs = Math.round(1000 / fps);
  const effect = resolveRendererEffectLevel(options);
  const effectIntervalMs = rendererEffectFrameIntervalMs(effect, {
    premiumMs: options.premiumMs,
    subtleMs: options.subtleMs,
    offMs: options.offMs,
  });
  return Math.max(requestedIntervalMs, effectIntervalMs);
}

function effectIndex(effect: RendererEffectLevel): number {
  return EFFECT_LEVELS.indexOf(effect);
}

function normalizeAnimationFps(
  fps: number,
  options: {
    readonly minFps?: number;
    readonly maxFps?: number;
    readonly defaultFps?: number;
  },
): number {
  const minFps = Math.max(MIN_ANIMATION_FPS, Math.trunc(options.minFps ?? MIN_ANIMATION_FPS));
  const maxFps = Math.max(minFps, Math.trunc(options.maxFps ?? MAX_ANIMATION_FPS));
  const fallbackFps = Math.min(
    maxFps,
    Math.max(minFps, Math.trunc(options.defaultFps ?? DEFAULT_ANIMATION_FPS)),
  );
  if (!Number.isFinite(fps)) return fallbackFps;
  return Math.min(maxFps, Math.max(minFps, Math.trunc(fps)));
}

function normalizeIntervalMs(value: number | undefined, fallback: number): number {
  if (value === Number.POSITIVE_INFINITY) return Number.POSITIVE_INFINITY;
  if (value === undefined || !Number.isFinite(value) || value <= 0) return fallback;
  return Math.floor(value);
}

function normalizeAmbientMs(value: number | undefined, fallback: number): number {
  if (value === undefined || !Number.isFinite(value) || value <= 0) return fallback;
  return Math.floor(value);
}
