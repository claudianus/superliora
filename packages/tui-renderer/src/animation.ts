import type { RendererCellStyle } from './cell-buffer';

export type RendererEasingName =
  | 'linear'
  | 'easeInQuad'
  | 'easeOutQuad'
  | 'easeInOutQuad'
  | 'easeOutCubic'
  | 'easeInOutCubic';

export type RendererEasingFunction = (progress: number) => number;
export type RendererEasing = RendererEasingName | RendererEasingFunction;
export type RendererTimelineDirection = 'normal' | 'reverse' | 'alternate' | 'alternate-reverse';

export interface RendererTimelineOptions {
  readonly durationMs: number;
  readonly delayMs?: number;
  readonly iterations?: number;
  readonly direction?: RendererTimelineDirection;
  readonly easing?: RendererEasing;
}

export interface RendererTimelineSample {
  readonly active: boolean;
  readonly done: boolean;
  readonly iteration: number;
  readonly elapsedMs: number;
  readonly localElapsedMs: number;
  readonly progress: number;
  readonly easedProgress: number;
}

export interface RendererStyleKeyframe {
  readonly offset: number;
  readonly style: RendererCellStyle;
}

export interface RendererAnimationFrame {
  readonly timestamp: number;
  readonly deltaMs: number;
  readonly frame: number;
}

export type RendererAnimationFrameCallback = (frame: RendererAnimationFrame) => void;

export interface RendererAnimationClock {
  requestAnimationFrame(callback: RendererAnimationFrameCallback): number;
  cancelAnimationFrame(id: number): void;
}

export interface RendererTimelinePlaybackOptions extends RendererTimelineOptions {
  readonly clock: RendererAnimationClock;
  readonly onSample: (
    sample: RendererTimelineSample,
    frame: RendererAnimationFrame,
  ) => void;
  readonly onComplete?: (
    sample: RendererTimelineSample,
    frame: RendererAnimationFrame,
  ) => void;
  readonly autoStart?: boolean;
}

export interface RendererAnimationFrameGateOptions {
  readonly clock: RendererAnimationClock;
  readonly onFrame?: RendererAnimationFrameCallback;
}

export const rendererEasings: Record<RendererEasingName, RendererEasingFunction> = {
  linear: (progress) => progress,
  easeInQuad: (progress) => progress * progress,
  easeOutQuad: (progress) => 1 - (1 - progress) * (1 - progress),
  easeInOutQuad: (progress) =>
    progress < 0.5 ? 2 * progress * progress : 1 - (-2 * progress + 2) ** 2 / 2,
  easeOutCubic: (progress) => 1 - (1 - progress) ** 3,
  easeInOutCubic: (progress) =>
    progress < 0.5 ? 4 * progress ** 3 : 1 - (-2 * progress + 2) ** 3 / 2,
};

export class RendererTimeline {
  private readonly durationMs: number;
  private readonly delayMs: number;
  private readonly iterations: number;
  private readonly direction: RendererTimelineDirection;
  private readonly easing: RendererEasingFunction;
  private startedAt: number | undefined;

  constructor(options: RendererTimelineOptions) {
    this.durationMs = normalizeDuration(options.durationMs);
    this.delayMs = normalizeDelay(options.delayMs);
    this.iterations = normalizeIterations(options.iterations);
    this.direction = options.direction ?? 'normal';
    this.easing = resolveRendererEasing(options.easing);
  }

  get isStarted(): boolean {
    return this.startedAt !== undefined;
  }

  start(timestampMs: number): void {
    this.startedAt = normalizeTimestamp(timestampMs);
  }

  reset(): void {
    this.startedAt = undefined;
  }

  sample(timestampMs: number): RendererTimelineSample {
    const timestamp = normalizeTimestamp(timestampMs);
    this.startedAt ??= timestamp;

    const elapsedMs = Math.max(0, timestamp - this.startedAt);
    const delayedElapsedMs = elapsedMs - this.delayMs;
    if (delayedElapsedMs < 0) {
      const progress = directedProgress(0, this.direction, 0);
      return {
        active: false,
        done: false,
        iteration: 0,
        elapsedMs,
        localElapsedMs: 0,
        progress,
        easedProgress: this.easing(progress),
      };
    }

    const rawIteration = Math.floor(delayedElapsedMs / this.durationMs);
    const done = Number.isFinite(this.iterations) && rawIteration >= this.iterations;
    const iteration = done ? Math.max(0, this.iterations - 1) : rawIteration;
    const localElapsedMs = done
      ? this.durationMs
      : Math.min(this.durationMs, delayedElapsedMs - iteration * this.durationMs);
    const rawProgress = done ? 1 : localElapsedMs / this.durationMs;
    const progress = directedProgress(rawProgress, this.direction, iteration);

    return {
      active: !done,
      done,
      iteration,
      elapsedMs,
      localElapsedMs,
      progress,
      easedProgress: clamp01(this.easing(progress)),
    };
  }
}

export class RendererTimelinePlayback {
  private readonly clock: RendererAnimationClock;
  private readonly timeline: RendererTimeline;
  private readonly onSample: RendererTimelinePlaybackOptions['onSample'];
  private readonly onComplete: RendererTimelinePlaybackOptions['onComplete'];
  private running = false;
  private animationFrameId: number | undefined;
  private lastSampleValue: RendererTimelineSample | undefined;

  constructor(options: RendererTimelinePlaybackOptions) {
    this.clock = options.clock;
    this.timeline = new RendererTimeline({
      durationMs: options.durationMs,
      delayMs: options.delayMs,
      iterations: options.iterations,
      direction: options.direction,
      easing: options.easing,
    });
    this.onSample = options.onSample;
    this.onComplete = options.onComplete;
    if (options.autoStart === true) this.start();
  }

  get isRunning(): boolean {
    return this.running;
  }

  get hasPendingFrame(): boolean {
    return this.animationFrameId !== undefined;
  }

  get lastSample(): RendererTimelineSample | undefined {
    return this.lastSampleValue;
  }

  start(): void {
    if (this.running) return;
    this.timeline.reset();
    this.lastSampleValue = undefined;
    this.running = true;
    this.scheduleNextFrame();
  }

  stop(): void {
    if (!this.running && this.animationFrameId === undefined) return;
    this.running = false;
    if (this.animationFrameId !== undefined) {
      this.clock.cancelAnimationFrame(this.animationFrameId);
      this.animationFrameId = undefined;
    }
  }

  restart(): void {
    this.stop();
    this.start();
  }

  private scheduleNextFrame(): void {
    if (!this.running || this.animationFrameId !== undefined) return;
    this.animationFrameId = this.clock.requestAnimationFrame((frame) => {
      this.handleFrame(frame);
    });
  }

  private handleFrame(frame: RendererAnimationFrame): void {
    this.animationFrameId = undefined;
    if (!this.running) return;

    const sample = this.timeline.sample(frame.timestamp);
    this.lastSampleValue = sample;
    this.onSample(sample, frame);
    if (!this.running) return;

    if (sample.done) {
      this.running = false;
      this.onComplete?.(sample, frame);
      return;
    }
    this.scheduleNextFrame();
  }
}

export class RendererAnimationFrameGate {
  private readonly clock: RendererAnimationClock;
  private readonly onFrame: RendererAnimationFrameCallback | undefined;
  private animationFrameId: number | undefined;

  constructor(options: RendererAnimationFrameGateOptions) {
    this.clock = options.clock;
    this.onFrame = options.onFrame;
  }

  get hasPendingFrame(): boolean {
    return this.animationFrameId !== undefined;
  }

  request(callback?: RendererAnimationFrameCallback): boolean {
    if (this.animationFrameId !== undefined) return false;
    this.animationFrameId = this.clock.requestAnimationFrame((frame) => {
      this.animationFrameId = undefined;
      this.onFrame?.(frame);
      callback?.(frame);
    });
    return true;
  }

  cancel(): void {
    if (this.animationFrameId === undefined) return;
    this.clock.cancelAnimationFrame(this.animationFrameId);
    this.animationFrameId = undefined;
  }
}

export function playRendererTimeline(
  options: RendererTimelinePlaybackOptions,
): RendererTimelinePlayback {
  const playback = new RendererTimelinePlayback(options);
  playback.start();
  return playback;
}

export function resolveRendererEasing(easing: RendererEasing | undefined): RendererEasingFunction {
  if (typeof easing === 'function') return (progress) => clamp01(easing(clamp01(progress)));
  if (easing !== undefined) return rendererEasings[easing];
  return rendererEasings.linear;
}

export function interpolateRendererCellStyle(
  from: RendererCellStyle | undefined,
  to: RendererCellStyle | undefined,
  progress: number,
): RendererCellStyle | undefined {
  const t = clamp01(progress);
  const style: RendererCellStyle = {
    fg: mixOptionalHexColor(from?.fg, to?.fg, t),
    bg: mixOptionalHexColor(from?.bg, to?.bg, t),
    bold: chooseFlag(from?.bold, to?.bold, t),
    dim: chooseFlag(from?.dim, to?.dim, t),
    italic: chooseFlag(from?.italic, to?.italic, t),
    underline: chooseFlag(from?.underline, to?.underline, t),
    inverse: chooseFlag(from?.inverse, to?.inverse, t),
  };
  return normalizeCellStyle(style);
}

export function sampleRendererStyleKeyframes(
  keyframes: readonly RendererStyleKeyframe[],
  progress: number,
): RendererCellStyle | undefined {
  if (keyframes.length === 0) return undefined;
  const sorted = keyframes
    .map((keyframe) => ({ offset: clamp01(keyframe.offset), style: keyframe.style }))
    .toSorted((a, b) => a.offset - b.offset);
  const t = clamp01(progress);
  const first = sorted[0]!;
  const last = sorted.at(-1)!;
  if (t <= first.offset) return first.style;
  if (t >= last.offset) return last.style;

  for (let i = 1; i < sorted.length; i++) {
    const next = sorted[i]!;
    if (t > next.offset) continue;
    const previous = sorted[i - 1]!;
    const span = next.offset - previous.offset;
    const localProgress = span <= 0 ? 1 : (t - previous.offset) / span;
    return interpolateRendererCellStyle(previous.style, next.style, localProgress);
  }

  return last.style;
}

export function mixHexColor(from: string, to: string, progress: number): string {
  const a = parseHexColor(from);
  const b = parseHexColor(to);
  if (a === undefined || b === undefined) return progress < 0.5 ? from : to;
  const t = clamp01(progress);
  return rgbToHex(
    Math.round(a.r + (b.r - a.r) * t),
    Math.round(a.g + (b.g - a.g) * t),
    Math.round(a.b + (b.b - a.b) * t),
  );
}

export function triangleWave(progress: number): number {
  const t = clamp01(progress);
  return t <= 0.5 ? t * 2 : (1 - t) * 2;
}

function directedProgress(
  rawProgress: number,
  direction: RendererTimelineDirection,
  iteration: number,
): number {
  const progress = clamp01(rawProgress);
  if (direction === 'reverse') return 1 - progress;
  if (direction === 'alternate') return iteration % 2 === 0 ? progress : 1 - progress;
  if (direction === 'alternate-reverse') return iteration % 2 === 0 ? 1 - progress : progress;
  return progress;
}

function mixOptionalHexColor(
  from: string | undefined,
  to: string | undefined,
  progress: number,
): string | undefined {
  if (from !== undefined && to !== undefined) return mixHexColor(from, to, progress);
  return progress < 0.5 ? from : to;
}

function chooseFlag(
  from: boolean | undefined,
  to: boolean | undefined,
  progress: number,
): boolean | undefined {
  return progress < 0.5 ? from : to;
}

function normalizeDuration(value: number): number {
  if (!Number.isFinite(value) || value <= 0) return 1;
  return value;
}

function normalizeDelay(value: number | undefined): number {
  if (value === undefined || !Number.isFinite(value) || value < 0) return 0;
  return value;
}

function normalizeIterations(value: number | undefined): number {
  if (value === undefined) return 1;
  if (value === Infinity) return Infinity;
  if (!Number.isFinite(value) || value <= 0) return 1;
  return Math.floor(value);
}

function normalizeTimestamp(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return value;
}

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(1, Math.max(0, value));
}

function parseHexColor(color: string): { readonly r: number; readonly g: number; readonly b: number } | undefined {
  const hex = color.startsWith('#') ? color.slice(1) : color;
  if (/^[0-9a-fA-F]{3}$/.test(hex)) {
    return {
      r: Number.parseInt(hex[0]! + hex[0]!, 16),
      g: Number.parseInt(hex[1]! + hex[1]!, 16),
      b: Number.parseInt(hex[2]! + hex[2]!, 16),
    };
  }
  if (/^[0-9a-fA-F]{6}$/.test(hex)) {
    return {
      r: Number.parseInt(hex.slice(0, 2), 16),
      g: Number.parseInt(hex.slice(2, 4), 16),
      b: Number.parseInt(hex.slice(4, 6), 16),
    };
  }
  return undefined;
}

function rgbToHex(r: number, g: number, b: number): string {
  return `#${byteToHex(r)}${byteToHex(g)}${byteToHex(b)}`;
}

function byteToHex(value: number): string {
  return Math.max(0, Math.min(255, value)).toString(16).padStart(2, '0');
}

function normalizeCellStyle(style: RendererCellStyle): RendererCellStyle | undefined {
  if (
    style.fg === undefined &&
    style.bg === undefined &&
    style.bold === undefined &&
    style.dim === undefined &&
    style.italic === undefined &&
    style.underline === undefined &&
    style.inverse === undefined
  ) {
    return undefined;
  }
  return style;
}
