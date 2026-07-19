import type { NativeFrameStatsHealth } from './frame-stats';
import type { RendererQualityLevel } from './quality';
import type { NativeRenderLoopScheduler } from './render-loop';
import { RendererTicker } from './ticker';

export interface RendererAmbientScheduleContext {
  readonly quality: RendererQualityLevel;
  readonly health: NativeFrameStatsHealth;
  readonly backpressure: boolean;
}

export interface RendererAmbientScheduleOptions {
  readonly enabled: boolean;
  readonly resolveIntervalMs: (ctx: RendererAmbientScheduleContext) => number;
  /**
   * When false, the timer keeps arming but skips onTick.
   * Prefer this over returning Infinity from resolveIntervalMs for temporary host gates.
   */
  readonly shouldTick?: () => boolean;
  /** Optional; defaults to a no-op before each wake. */
  readonly beforeTick?: () => void;
}

export class RendererAmbientSchedule {
  private ticker: RendererTicker | undefined;

  constructor(
    private readonly deps: {
      readonly scheduler?: NativeRenderLoopScheduler;
      readonly unrefTimers?: boolean;
      readonly requestRender: () => void;
      readonly getContext: () => RendererAmbientScheduleContext;
    },
  ) {}

  set(options: RendererAmbientScheduleOptions | undefined): void {
    this.ticker?.dispose();
    this.ticker = undefined;
    if (options === undefined || !options.enabled) return;
    this.ticker = new RendererTicker({
      fps: 30,
      enabled: true,
      scheduler: this.deps.scheduler,
      unrefTimers: this.deps.unrefTimers,
      minIntervalMs: 1,
      maxFps: 60,
      defaultFps: 30,
      shouldTick: options.shouldTick,
      beforeTick: options.beforeTick,
      resolveIntervalMs: () => options.resolveIntervalMs(this.deps.getContext()),
      onTick: () => this.deps.requestRender(),
    });
  }

  dispose(): void {
    this.set(undefined);
  }
}
