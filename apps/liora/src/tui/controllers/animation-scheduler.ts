import { RendererTicker } from '#/tui/renderer';

export interface AnimationSchedulerOptions {
  readonly fps: number;
  readonly requestRender: () => void;
  readonly enabled: boolean;
  readonly shouldRender?: () => boolean;
  readonly beforeRender?: () => void;
  readonly resolveIntervalMs?: () => number | undefined;
}

export class AnimationScheduler {
  private readonly ticker: RendererTicker;

  constructor(options: AnimationSchedulerOptions) {
    this.ticker = new RendererTicker({
      fps: options.fps,
      enabled: options.enabled,
      shouldTick: options.shouldRender,
      beforeTick: options.beforeRender,
      resolveIntervalMs: options.resolveIntervalMs,
      onTick: options.requestRender,
      defaultFps: 12,
      maxFps: 30,
      minIntervalMs: 16,
    });
  }

  update(options: { readonly fps?: number; readonly enabled?: boolean }): void {
    this.ticker.update(options);
  }

  dispose(): void {
    this.ticker.dispose();
  }
}
