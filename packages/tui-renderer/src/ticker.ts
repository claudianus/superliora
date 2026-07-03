import { type NativeRenderLoopScheduler, type NativeRenderTimer } from './render-loop';

export interface RendererTickerOptions {
  readonly fps: number;
  readonly onTick: () => void;
  readonly enabled?: boolean;
  readonly shouldTick?: () => boolean;
  readonly beforeTick?: () => void;
  readonly resolveIntervalMs?: () => number | undefined;
  readonly scheduler?: NativeRenderLoopScheduler;
  readonly unrefTimers?: boolean;
  readonly minIntervalMs?: number;
  readonly minFps?: number;
  readonly maxFps?: number;
  readonly defaultFps?: number;
}

export interface RendererTickerUpdate {
  readonly fps?: number;
  readonly enabled?: boolean;
}

export interface RendererTickerFpsOptions {
  readonly minFps?: number;
  readonly maxFps?: number;
  readonly defaultFps?: number;
}

const DEFAULT_TICKER_FPS = 60;
const MIN_TICKER_FPS = 1;
const MAX_TICKER_FPS = 240;

export class RendererTicker {
  private readonly onTick: () => void;
  private readonly shouldTick: () => boolean;
  private readonly beforeTick: () => void;
  private readonly resolveIntervalMs: (() => number | undefined) | undefined;
  private readonly scheduler: NativeRenderLoopScheduler;
  private readonly unrefTimers: boolean;
  private readonly minIntervalMs: number;
  private readonly minFps: number | undefined;
  private readonly maxFps: number | undefined;
  private readonly defaultFps: number | undefined;
  private timer: NativeRenderTimer | undefined;
  private fps: number;
  private enabled: boolean;
  private disposed = false;

  constructor(options: RendererTickerOptions) {
    this.onTick = options.onTick;
    this.shouldTick = options.shouldTick ?? (() => true);
    this.beforeTick = options.beforeTick ?? (() => {});
    this.resolveIntervalMs = options.resolveIntervalMs;
    this.scheduler = options.scheduler ?? defaultTickerScheduler;
    this.unrefTimers = options.unrefTimers === true;
    this.minIntervalMs = Math.max(0, Math.trunc(options.minIntervalMs ?? 0));
    this.minFps = options.minFps;
    this.maxFps = options.maxFps;
    this.defaultFps = options.defaultFps;
    this.fps = normalizeRendererTickerFps(options.fps, {
      minFps: this.minFps,
      maxFps: this.maxFps,
      defaultFps: this.defaultFps,
    });
    this.enabled = options.enabled ?? true;
    this.syncTimer();
  }

  get isEnabled(): boolean {
    return this.enabled;
  }

  get intervalMs(): number {
    return Math.max(this.minIntervalMs, Math.round(1000 / this.fps));
  }

  update(options: RendererTickerUpdate): void {
    if (this.disposed) return;
    const nextFps =
      options.fps === undefined
        ? this.fps
        : normalizeRendererTickerFps(options.fps, {
            minFps: this.minFps,
            maxFps: this.maxFps,
            defaultFps: this.defaultFps,
          });
    const nextEnabled = options.enabled ?? this.enabled;
    if (nextFps === this.fps && nextEnabled === this.enabled) return;
    this.fps = nextFps;
    this.enabled = nextEnabled;
    this.syncTimer();
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.clearTimer();
  }

  private syncTimer(): void {
    this.clearTimer();
    if (!this.enabled || this.disposed) return;
    this.scheduleNextTick();
  }

  private scheduleNextTick(): void {
    const intervalMs = this.nextIntervalMs();
    if (intervalMs === Number.POSITIVE_INFINITY) return;
    const timer = this.scheduler.setTimeout(() => {
      this.runTick();
    }, intervalMs);
    if (this.unrefTimers) timer.unref?.();
    this.timer = timer;
  }

  private runTick(): void {
    if (this.disposed || !this.enabled) return;
    this.timer = undefined;
    if (this.shouldTick()) {
      this.beforeTick();
      this.onTick();
    }
    if (!this.disposed && this.enabled) this.scheduleNextTick();
  }

  private clearTimer(): void {
    if (this.timer === undefined) return;
    this.scheduler.clearTimeout(this.timer);
    this.timer = undefined;
  }

  private nextIntervalMs(): number {
    const resolvedIntervalMs = this.resolveIntervalMs?.();
    if (resolvedIntervalMs === undefined) return this.intervalMs;
    if (resolvedIntervalMs === Number.POSITIVE_INFINITY) return Number.POSITIVE_INFINITY;
    if (!Number.isFinite(resolvedIntervalMs) || resolvedIntervalMs <= 0) return this.intervalMs;
    return Math.max(this.minIntervalMs, Math.floor(resolvedIntervalMs));
  }
}

export function normalizeRendererTickerFps(
  fps: number,
  options: RendererTickerFpsOptions = {},
): number {
  const minFps = Math.max(1, Math.trunc(options.minFps ?? MIN_TICKER_FPS));
  const maxFps = Math.max(minFps, Math.trunc(options.maxFps ?? MAX_TICKER_FPS));
  const fallbackFps = Math.trunc(options.defaultFps ?? DEFAULT_TICKER_FPS);
  const candidate = Number.isFinite(fps) ? Math.trunc(fps) : fallbackFps;
  return Math.min(maxFps, Math.max(minFps, candidate));
}

const defaultTickerScheduler: NativeRenderLoopScheduler = {
  now: () => globalThis.performance?.now() ?? Date.now(),
  setTimeout: (callback, delayMs) => setTimeout(callback, delayMs),
  clearTimeout: (timer) => {
    clearTimeout(timer as ReturnType<typeof setTimeout>);
  },
};
