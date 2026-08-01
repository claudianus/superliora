import type { NativeAnimationFrameCallback, NativeRenderCause } from '../frame/render-loop';
import type { NativeTerminalOutput } from '../terminal/session';

export interface NativeRendererBackpressureCallbacks {
  readonly now: () => number;
  readonly recordMarker: (name: string, args?: Record<string, string | number | boolean>) => void;
  readonly cancelRegionAnimationFrame: () => void;
  readonly loopRequestRender: (cause: NativeRenderCause) => void;
  readonly loopRequestAnimationFrame: (callback: NativeAnimationFrameCallback) => number;
}

/**
 * If `drain` never fires after write() returned false (stuck PTY / terminal),
 * force-clear backpressure so interactive frames are not deferred forever.
 */
export const BACKPRESSURE_STUCK_TIMEOUT_MS = 250;

export class NativeRendererBackpressure {
  private outputBackpressured = false;
  private outputDrainListener: (() => void) | undefined;
  private stuckTimer: { unref?(): void } | undefined;
  private readonly deferredRenderCauses = new Set<NativeRenderCause>();
  private readonly deferredAnimationCallbacks = new Map<number, NativeAnimationFrameCallback>();
  private nextDeferredAnimationFrameId = -1;

  constructor(
    private readonly output: NativeTerminalOutput,
    private readonly deferFramesDuringBackpressure: boolean | undefined,
    private readonly callbacks: NativeRendererBackpressureCallbacks,
  ) {}

  get isActive(): boolean {
    return this.outputBackpressured;
  }

  shouldDefer(): boolean {
    return this.deferFramesDuringBackpressure !== false && this.outputBackpressured;
  }

  deferRenderCause(cause: NativeRenderCause): void {
    this.deferredRenderCauses.add(cause);
  }

  deferAnimationFrame(callback: NativeAnimationFrameCallback): number {
    const id = this.nextDeferredAnimationFrameId--;
    this.deferredAnimationCallbacks.set(id, callback);
    this.deferredRenderCauses.add('animation');
    return id;
  }

  cancelDeferredAnimationFrame(id: number): boolean {
    if (!this.deferredAnimationCallbacks.delete(id)) return false;
    if (this.deferredAnimationCallbacks.size === 0) {
      this.deferredRenderCauses.delete('animation');
    }
    return true;
  }

  handleBackpressure(): void {
    if (this.deferFramesDuringBackpressure === false) return;
    if (this.outputBackpressured) return;
    if (this.output.on === undefined) return;
    this.outputBackpressured = true;
    this.callbacks.cancelRegionAnimationFrame();
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
    this.deferredRenderCauses.clear();
    this.deferredAnimationCallbacks.clear();
  }

  private armStuckWatchdog(): void {
    this.clearStuckWatchdog();
    // setTimeout is process-global; prefer it over the render scheduler so a
    // blocked render loop still recovers when drain never arrives.
    const timer = setTimeout(() => {
      this.stuckTimer = undefined;
      if (!this.outputBackpressured) return;
      this.callbacks.recordMarker('terminal.output_backpressure_stuck', {
        timeoutMs: BACKPRESSURE_STUCK_TIMEOUT_MS,
      });
      this.handleDrain();
    }, BACKPRESSURE_STUCK_TIMEOUT_MS);
    timer.unref?.();
    this.stuckTimer = timer;
  }

  private clearStuckWatchdog(): void {
    if (this.stuckTimer === undefined) return;
    clearTimeout(this.stuckTimer as ReturnType<typeof setTimeout>);
    this.stuckTimer = undefined;
  }

  private handleDrain(): void {
    if (!this.outputBackpressured) return;
    const deferredCauses = Array.from(this.deferredRenderCauses);
    const deferredCallbacks = Array.from(this.deferredAnimationCallbacks.values());
    this.clear();
    this.callbacks.recordMarker('terminal.output_drain', {
      deferredCauses: deferredCauses.join(','),
      deferredAnimations: deferredCallbacks.length,
    });
    for (const callback of deferredCallbacks) {
      this.callbacks.loopRequestAnimationFrame(callback);
    }
    for (const cause of deferredCauses) {
      if (cause === 'animation') continue;
      this.callbacks.loopRequestRender(cause);
    }
  }
}
