export type NativeRenderCause =
  | 'start'
  | 'request'
  | 'input'
  | 'animation'
  | 'resize'
  | 'manual'
  | 'quality'
  | 'transcript-scroll';

export interface NativeRenderFrame {
  readonly timestamp: number;
  readonly deltaMs: number;
  readonly frame: number;
  readonly causes: readonly NativeRenderCause[];
}

export type NativeAnimationFrameCallback = (frame: NativeRenderFrame) => void;
export type NativeRenderCallback = (frame: NativeRenderFrame) => void;

export interface NativeRenderTimer {
  unref?(): void;
}

export interface NativeRenderLoopScheduler {
  now(): number;
  setTimeout(callback: () => void, delayMs: number): NativeRenderTimer;
  clearTimeout(timer: NativeRenderTimer): void;
}

export interface NativeRenderLoopOptions {
  readonly render: NativeRenderCallback;
  readonly targetFps?: number;
  readonly renderOnStart?: boolean;
  readonly unrefTimers?: boolean;
  readonly scheduler?: NativeRenderLoopScheduler;
}

const DEFAULT_TARGET_FPS = 60;
const MIN_TARGET_FPS = 1;
const MAX_TARGET_FPS = 240;

export class NativeRenderLoop {
  private readonly scheduler: NativeRenderLoopScheduler;
  private readonly targetFrameIntervalMs: number;
  private started = false;
  private scheduledTimer: NativeRenderTimer | undefined;
  private scheduledDelayMs = 0;
  private pendingCauses = new Set<NativeRenderCause>();
  private animationCallbacks = new Map<number, NativeAnimationFrameCallback>();
  private nextAnimationFrameId = 1;
  private lastFrameAt: number | undefined;
  private renderedFrames = 0;
  private runningFrame = false;
  /**
   * Drift-free frame pacing: tracks the ideal next frame timestamp.
   * Each frame advances this by exactly one interval, absorbing setTimeout
   * jitter without accumulating drift. Reset when the target falls too far
   * behind wall-clock time (e.g. after a long GC pause or tab suspend).
   */
  private nextTargetTime: number | undefined;
  /**
   * When input arrives during a running frame, we arm an immediate follow-up
   * via this flag so the next scheduleNextFrame() after runFrame completes
   * uses delay 0 regardless of pacing.
   */
  private inputDuringFramePending = false;

  constructor(private readonly options: NativeRenderLoopOptions) {
    this.scheduler = options.scheduler ?? defaultRenderLoopScheduler;
    this.targetFrameIntervalMs = 1000 / normalizeTargetFps(options.targetFps);
  }

  get isStarted(): boolean {
    return this.started;
  }

  get frameCount(): number {
    return this.renderedFrames;
  }

  get frameIntervalMs(): number {
    return this.targetFrameIntervalMs;
  }

  get hasPendingFrame(): boolean {
    return (
      this.scheduledTimer !== undefined ||
      this.pendingCauses.size > 0 ||
      this.animationCallbacks.size > 0
    );
  }

  start(): void {
    if (this.started) return;
    this.started = true;
    if (this.options.renderOnStart === true) this.pendingCauses.add('start');
    this.scheduleNextFrame();
  }

  stop(): void {
    if (!this.started) return;
    this.started = false;
    if (this.scheduledTimer !== undefined) {
      this.scheduler.clearTimeout(this.scheduledTimer);
      this.scheduledTimer = undefined;
      this.scheduledDelayMs = 0;
    }
    this.pendingCauses.clear();
    this.animationCallbacks.clear();
    this.nextTargetTime = undefined;
    this.inputDuringFramePending = false;
  }

  requestRender(cause: NativeRenderCause = 'request'): void {
    this.pendingCauses.add(cause);
    // High-priority input arriving mid-frame must not wait for the next
    // paced tick — flag it so the post-frame schedule fires immediately.
    if (this.runningFrame && (cause === 'input' || cause === 'resize')) {
      this.inputDuringFramePending = true;
    }
    this.scheduleNextFrame();
  }

  requestAnimationFrame(callback: NativeAnimationFrameCallback): number {
    const id = this.nextAnimationFrameId++;
    this.animationCallbacks.set(id, callback);
    this.pendingCauses.add('animation');
    this.scheduleNextFrame();
    return id;
  }

  cancelAnimationFrame(id: number): void {
    if (!this.animationCallbacks.delete(id)) return;
    if (this.animationCallbacks.size === 0 && onlyPendingCause(this.pendingCauses, 'animation')) {
      this.pendingCauses.delete('animation');
      this.cancelScheduledFrameIfIdle();
    }
  }

  now(): number {
    return this.scheduler.now();
  }

  private scheduleNextFrame(): void {
    if (!this.started || this.runningFrame || !this.hasPendingFrame) {
      return;
    }

    const delayMs = this.resolveFrameDelay(this.scheduler.now());

    if (this.scheduledTimer !== undefined) {
      // A frame is already pending. Preempt it only when a high-priority
      // cause (input/resize) now demands an immediate frame while the
      // existing timer is paced into the future — this is what removes input
      // lag when a keystroke lands right after an animation tick scheduled a
      // ~16ms-paced frame. If the pending timer is already immediate
      // (delay 0), keep it to avoid timer churn.
      if (delayMs === 0 && this.scheduledDelayMs > 0) {
        this.scheduler.clearTimeout(this.scheduledTimer);
        this.scheduledTimer = undefined;
        this.scheduledDelayMs = 0;
      } else {
        return;
      }
    }

    const timer = this.scheduler.setTimeout(() => {
      this.runFrame();
    }, delayMs);
    if (this.options.unrefTimers === true) timer.unref?.();
    this.scheduledTimer = timer;
    this.scheduledDelayMs = delayMs;
  }

  private resolveFrameDelay(now: number): number {
    // High-priority causes render immediately so user input is never held
    // behind frame pacing.
    if (this.pendingCauses.has('input') || this.pendingCauses.has('resize')) return 0;
    // Input that arrived mid-frame demands an immediate follow-up.
    if (this.inputDuringFramePending) return 0;
    if (this.nextTargetTime === undefined) return 0;
    // Drift-free pacing: delay until the ideal next frame time. If the
    // target is already in the past (setTimeout jitter or long task), fire
    // immediately — the runFrame() epilogue will re-anchor the target.
    return Math.max(0, this.nextTargetTime - now);
  }

  private cancelScheduledFrameIfIdle(): void {
    if (this.pendingCauses.size > 0 || this.animationCallbacks.size > 0) return;
    if (this.scheduledTimer === undefined) return;
    this.scheduler.clearTimeout(this.scheduledTimer);
    this.scheduledTimer = undefined;
    this.scheduledDelayMs = 0;
  }

  private runFrame(): void {
    if (!this.started) return;

    this.scheduledTimer = undefined;
    this.scheduledDelayMs = 0;
    this.inputDuringFramePending = false;
    const timestamp = this.scheduler.now();
    const deltaMs = this.lastFrameAt === undefined ? 0 : Math.max(0, timestamp - this.lastFrameAt);
    const animationCallbacks = Array.from(this.animationCallbacks.values());
    this.animationCallbacks.clear();
    const causes = this.consumeFrameCauses(animationCallbacks.length > 0);
    const frame: NativeRenderFrame = {
      timestamp,
      deltaMs,
      frame: this.renderedFrames,
      causes,
    };

    this.runningFrame = true;
    try {
      for (const callback of animationCallbacks) callback(frame);
      this.options.render(frame);
    } finally {
      this.runningFrame = false;
      this.lastFrameAt = timestamp;
      this.renderedFrames++;
      // Advance the ideal target by exactly one interval (drift-free).
      // If the target has fallen more than one full interval behind
      // wall-clock (long GC, tab suspend, heavy render), re-anchor to
      // avoid a burst of catch-up frames.
      if (this.nextTargetTime === undefined) {
        this.nextTargetTime = timestamp + this.targetFrameIntervalMs;
      } else {
        this.nextTargetTime += this.targetFrameIntervalMs;
        if (this.nextTargetTime < timestamp - this.targetFrameIntervalMs) {
          this.nextTargetTime = timestamp + this.targetFrameIntervalMs;
        }
      }
      this.scheduleNextFrame();
    }
  }

  private consumeFrameCauses(hasAnimationCallbacks: boolean): readonly NativeRenderCause[] {
    const causes = Array.from(this.pendingCauses);
    this.pendingCauses.clear();
    if (hasAnimationCallbacks && !causes.includes('animation')) causes.push('animation');
    if (causes.length === 0) causes.push('request');
    return causes;
  }
}

const defaultRenderLoopScheduler: NativeRenderLoopScheduler = {
  now: () => globalThis.performance?.now() ?? Date.now(),
  setTimeout: (callback, delayMs) => setTimeout(callback, delayMs),
  clearTimeout: (timer) => {
    clearTimeout(timer as ReturnType<typeof setTimeout>);
  },
};

function normalizeTargetFps(targetFps: number | undefined): number {
  if (targetFps === undefined || !Number.isFinite(targetFps)) return DEFAULT_TARGET_FPS;
  return Math.min(MAX_TARGET_FPS, Math.max(MIN_TARGET_FPS, targetFps));
}

function onlyPendingCause(causes: ReadonlySet<NativeRenderCause>, cause: NativeRenderCause): boolean {
  return causes.size === 1 && causes.has(cause);
}
