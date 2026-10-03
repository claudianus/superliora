import type { NativeRenderLoopScheduler, NativeRenderTimer } from '../frame/render-loop';
import type { NativeTerminalOutput } from '../terminal/session';

export interface NativeRendererBackpressureCallbacks {
  readonly recordMarker: (name: string, args?: Record<string, string | number | boolean>) => void;
  readonly suspendFrames: (suspended: boolean) => void;
}

/** Recheck an observable writable state in case its drain notification was lost. */
export const BACKPRESSURE_STATE_CHECK_INTERVAL_MS = 250;

export class NativeRendererBackpressure {
  private outputBackpressured = false;
  private outputDrainListener: (() => void) | undefined;
  private stuckTimer: NativeRenderTimer | undefined;
  private readonly scheduler: NativeRenderLoopScheduler;

  constructor(
    private readonly output: NativeTerminalOutput,
    private readonly deferFramesDuringBackpressure: boolean | undefined,
    private readonly callbacks: NativeRendererBackpressureCallbacks,
    scheduler?: NativeRenderLoopScheduler,
  ) {
    this.scheduler = scheduler ?? {
      now: () => performance.now(),
      setTimeout: (callback, delayMs) => setTimeout(callback, delayMs),
      clearTimeout: (timer) => {
        clearTimeout(timer as NodeJS.Timeout);
      },
    };
  }

  get isActive(): boolean {
    return this.outputBackpressured;
  }

  shouldDefer(): boolean {
    return this.deferFramesDuringBackpressure !== false && this.outputBackpressured;
  }

  handleBackpressure(): void {
    if (this.deferFramesDuringBackpressure === false || this.outputBackpressured) return;
    if (this.output.on === undefined) return;
    this.outputBackpressured = true;
    this.callbacks.suspendFrames(true);
    const listener = () => {
      this.handleDrain();
    };
    this.outputDrainListener = listener;
    this.output.on('drain', listener);
    this.armStuckWatchdog();
    this.callbacks.recordMarker('terminal.output_backpressure');
  }

  clear(): void {
    this.clearStuckWatchdog();
    if (this.outputDrainListener !== undefined) {
      if (this.output.off !== undefined) {
        this.output.off('drain', this.outputDrainListener);
      } else {
        this.output.removeListener?.('drain', this.outputDrainListener);
      }
      this.outputDrainListener = undefined;
    }
    this.outputBackpressured = false;
    this.callbacks.suspendFrames(false);
  }

  private armStuckWatchdog(): void {
    // A timeout is not a drain. Resuming writes into a genuinely blocked PTY
    // queues old frames forever and delays the user's latest scroll position.
    // Outputs without observable writable state must wait for their drain event.
    if (this.output.writableNeedDrain === undefined) return;
    this.stuckTimer = this.scheduler.setTimeout(() => {
      this.stuckTimer = undefined;
      if (!this.outputBackpressured) return;
      if (this.output.writableNeedDrain === false) {
        this.callbacks.recordMarker('terminal.output_backpressure_recovered', {
          intervalMs: BACKPRESSURE_STATE_CHECK_INTERVAL_MS,
        });
        this.handleDrain();
      } else {
        this.armStuckWatchdog();
      }
    }, BACKPRESSURE_STATE_CHECK_INTERVAL_MS);
    this.stuckTimer.unref?.();
  }

  private clearStuckWatchdog(): void {
    if (this.stuckTimer === undefined) return;
    this.scheduler.clearTimeout(this.stuckTimer);
    this.stuckTimer = undefined;
  }

  private handleDrain(): void {
    if (!this.outputBackpressured || this.output.writableNeedDrain === true) return;
    this.clear();
    this.callbacks.recordMarker('terminal.output_drain');
  }
}
