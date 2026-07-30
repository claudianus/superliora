import type { NativeAnimationFrameCallback, NativeRenderCause } from '../frame/render-loop';
import type { NativeTerminalOutput } from '../terminal/session';

export interface NativeRendererBackpressureCallbacks {
  readonly now: () => number;
  readonly recordMarker: (name: string, args?: Record<string, string | number | boolean>) => void;
  readonly cancelRegionAnimationFrame: () => void;
  readonly loopRequestRender: (cause: NativeRenderCause) => void;
  readonly loopRequestAnimationFrame: (callback: NativeAnimationFrameCallback) => number;
}

export class NativeRendererBackpressure {
  private outputBackpressured = false;
  private outputDrainListener: (() => void) | undefined;
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
    this.callbacks.recordMarker('terminal.output_backpressure');
  }

  clear(): void {
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
