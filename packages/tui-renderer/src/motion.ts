import {
  resolveRendererEasing,
  type RendererEasing,
  type RendererTimelineOptions,
} from './animation';
import {
  resolveRendererEffectLevel,
  type RendererEffectLevel,
  type RendererEffectPolicyOptions,
  type RendererMotionPreference,
} from './effects';

export type RendererMotionPreset = 'instant' | 'quick' | 'smooth' | 'emphasized' | 'ambient';

export interface RendererMotionOptions extends RendererEffectPolicyOptions {
  readonly preset?: RendererMotionPreset;
  readonly durationMs?: number;
  readonly delayMs?: number;
  readonly easing?: RendererEasing;
  readonly reducedMotionDurationMs?: number;
}

export interface RendererResolvedMotion {
  readonly preset: RendererMotionPreset;
  readonly effectLevel: RendererEffectLevel;
  readonly motion: RendererMotionPreference;
  readonly enabled: boolean;
  readonly durationMs: number;
  readonly delayMs: number;
  readonly easing: RendererEasing;
}

export interface RendererScalarTransitionOptions extends RendererMotionOptions {
  readonly initial: number;
  readonly target?: number;
  readonly now?: number;
}

export interface RendererScalarTransitionSample {
  readonly value: number;
  readonly from: number;
  readonly target: number;
  readonly active: boolean;
  readonly done: boolean;
  readonly elapsedMs: number;
  readonly progress: number;
  readonly easedProgress: number;
}

interface RendererMotionPresetDefinition {
  readonly durationMs: number;
  readonly subtleDurationMs: number;
  readonly reducedDurationMs: number;
  readonly easing: RendererEasing;
}

const RENDERER_MOTION_PRESETS = {
  instant: {
    durationMs: 0,
    subtleDurationMs: 0,
    reducedDurationMs: 0,
    easing: 'linear',
  },
  quick: {
    durationMs: 120,
    subtleDurationMs: 100,
    reducedDurationMs: 80,
    easing: 'easeOutCubic',
  },
  smooth: {
    durationMs: 220,
    subtleDurationMs: 180,
    reducedDurationMs: 120,
    easing: 'easeInOutCubic',
  },
  emphasized: {
    durationMs: 320,
    subtleDurationMs: 220,
    reducedDurationMs: 120,
    easing: 'easeInOutCubic',
  },
  ambient: {
    durationMs: 900,
    subtleDurationMs: 420,
    reducedDurationMs: 0,
    easing: 'easeInOutCubic',
  },
} satisfies Record<RendererMotionPreset, RendererMotionPresetDefinition>;

export function resolveRendererMotion(
  options: RendererMotionOptions = {},
): RendererResolvedMotion {
  const preset = options.preset ?? 'smooth';
  const definition = RENDERER_MOTION_PRESETS[preset];
  const motion = options.motion ?? 'normal';
  const effectLevel = resolveRendererEffectLevel(options);
  const delayMs = normalizeMotionDelay(options.delayMs);
  const easing = options.easing ?? (motion === 'reduced' ? 'easeOutQuad' : definition.easing);

  if (effectLevel === 'off' || preset === 'instant') {
    return {
      preset,
      effectLevel,
      motion,
      enabled: false,
      durationMs: 0,
      delayMs: 0,
      easing: 'linear',
    };
  }

  const durationMs = resolveMotionDurationMs(options, definition, motion, effectLevel);
  return {
    preset,
    effectLevel,
    motion,
    enabled: durationMs > 0,
    durationMs,
    delayMs,
    easing,
  };
}

export function rendererMotionTimelineOptions(
  options: RendererMotionOptions = {},
): RendererTimelineOptions | undefined {
  const motion = resolveRendererMotion(options);
  if (!motion.enabled) return undefined;
  return {
    durationMs: motion.durationMs,
    delayMs: motion.delayMs,
    easing: motion.easing,
  };
}

export function interpolateRendererScalar(from: number, to: number, progress: number): number {
  const start = normalizeScalar(from);
  const end = normalizeScalar(to);
  const t = clamp01(progress);
  return start + (end - start) * t;
}

export class RendererScalarTransition {
  private motionOptions: RendererMotionOptions;
  private fromValue: number;
  private targetValue: number;
  private startedAtMs: number;
  private resolvedMotion: RendererResolvedMotion;

  constructor(options: RendererScalarTransitionOptions) {
    const now = normalizeTimestamp(options.now);
    this.motionOptions = options;
    this.fromValue = normalizeScalar(options.initial);
    this.targetValue = normalizeScalar(options.target ?? options.initial);
    this.startedAtMs = now;
    this.resolvedMotion = resolveRendererMotion(this.motionOptions);
    if (!this.resolvedMotion.enabled) this.fromValue = this.targetValue;
  }

  get target(): number {
    return this.targetValue;
  }

  get motion(): RendererResolvedMotion {
    return this.resolvedMotion;
  }

  updateMotion(options: RendererMotionOptions, timestampMs: number = this.startedAtMs): void {
    const current = this.sample(timestampMs).value;
    this.motionOptions = options;
    this.fromValue = current;
    this.startedAtMs = normalizeTimestamp(timestampMs);
    this.resolvedMotion = resolveRendererMotion(options);
    if (!this.resolvedMotion.enabled) this.fromValue = this.targetValue;
  }

  setTarget(target: number, timestampMs: number = this.startedAtMs): RendererScalarTransitionSample {
    const now = normalizeTimestamp(timestampMs);
    const current = this.sample(now).value;
    this.fromValue = current;
    this.targetValue = normalizeScalar(target);
    this.startedAtMs = now;
    this.resolvedMotion = resolveRendererMotion(this.motionOptions);
    if (!this.resolvedMotion.enabled || this.fromValue === this.targetValue) {
      this.fromValue = this.targetValue;
    }
    return this.sample(now);
  }

  snap(value: number, timestampMs: number = this.startedAtMs): RendererScalarTransitionSample {
    const next = normalizeScalar(value);
    this.fromValue = next;
    this.targetValue = next;
    this.startedAtMs = normalizeTimestamp(timestampMs);
    return this.sample(this.startedAtMs);
  }

  sample(timestampMs: number): RendererScalarTransitionSample {
    const timestamp = normalizeTimestamp(timestampMs);
    const elapsedMs = Math.max(0, timestamp - this.startedAtMs);
    if (!this.resolvedMotion.enabled) {
      return scalarTransitionSample({
        value: this.targetValue,
        from: this.targetValue,
        target: this.targetValue,
        active: false,
        done: true,
        elapsedMs,
        progress: 1,
        easedProgress: 1,
      });
    }

    const delayedElapsedMs = elapsedMs - this.resolvedMotion.delayMs;
    if (delayedElapsedMs <= 0) {
      return scalarTransitionSample({
        value: this.fromValue,
        from: this.fromValue,
        target: this.targetValue,
        active: false,
        done: false,
        elapsedMs,
        progress: 0,
        easedProgress: 0,
      });
    }

    const progress = clamp01(delayedElapsedMs / this.resolvedMotion.durationMs);
    const easedProgress = resolveRendererEasing(this.resolvedMotion.easing)(progress);
    return scalarTransitionSample({
      value: interpolateRendererScalar(this.fromValue, this.targetValue, easedProgress),
      from: this.fromValue,
      target: this.targetValue,
      active: progress < 1,
      done: progress >= 1,
      elapsedMs,
      progress,
      easedProgress,
    });
  }
}

function resolveMotionDurationMs(
  options: RendererMotionOptions,
  definition: RendererMotionPresetDefinition,
  motion: RendererMotionPreference,
  effectLevel: RendererEffectLevel,
): number {
  const requestedDurationMs = normalizeMotionDuration(options.durationMs, definition.durationMs);
  if (motion === 'reduced') {
    const reducedDurationMs = normalizeMotionDuration(
      options.reducedMotionDurationMs,
      definition.reducedDurationMs,
    );
    return Math.min(requestedDurationMs, reducedDurationMs);
  }
  if (effectLevel === 'subtle') {
    return Math.min(requestedDurationMs, definition.subtleDurationMs);
  }
  return requestedDurationMs;
}

function scalarTransitionSample(
  sample: RendererScalarTransitionSample,
): RendererScalarTransitionSample {
  return {
    ...sample,
    value: normalizeScalar(sample.value),
    progress: clamp01(sample.progress),
    easedProgress: clamp01(sample.easedProgress),
  };
}

function normalizeMotionDuration(value: number | undefined, fallback: number): number {
  if (value === undefined || !Number.isFinite(value) || value <= 0) return Math.max(0, fallback);
  return Math.max(0, Math.floor(value));
}

function normalizeMotionDelay(value: number | undefined): number {
  if (value === undefined || !Number.isFinite(value) || value <= 0) return 0;
  return Math.floor(value);
}

function normalizeTimestamp(value: number | undefined): number {
  if (value === undefined || !Number.isFinite(value)) return 0;
  return Math.max(0, value);
}

function normalizeScalar(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return value;
}

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(1, Math.max(0, value));
}
