import type { NativeAnimationFrameCallback, NativeRenderCause } from '../frame/render-loop';
import { isAutoFrameHoldCause } from './support';
import type { NativeTerminalRendererAutoFrameHold } from './types';

export interface NativeRendererAutoFrameHoldCallbacks {
  readonly now: () => number;
  readonly recordMarker: (name: string, args?: Record<string, string | number | boolean>) => void;
  readonly cancelRegionAnimationFrame: () => void;
  readonly requestRenderDirect: (cause: NativeRenderCause) => void;
  readonly requestAnimationFrameDirect: (callback: NativeAnimationFrameCallback) => number;
  readonly shouldDeferFrameForBackpressure: () => boolean;
  readonly deferRenderCause: (cause: NativeRenderCause) => void;
  readonly deferAnimationFrame: (callback: NativeAnimationFrameCallback) => number;
  readonly cancelDeferredAnimationFrame: (id: number) => boolean;
  readonly loopCancelAnimationFrame: (id: number) => void;
}

export class NativeRendererAutoFrameHold {
  private autoFrameHoldOverride: boolean | undefined;
  private autoFrameHeld = false;
  private releasingHeldAutoFrames = false;
  private readonly heldRenderCauses = new Set<NativeRenderCause>();
  private readonly heldAnimationCallbacks = new Map<number, NativeAnimationFrameCallback>();
  private nextHeldAnimationFrameId = -1_000_000;

  constructor(
    private readonly autoFrameHold: NativeTerminalRendererAutoFrameHold | undefined,
    private readonly callbacks: NativeRendererAutoFrameHoldCallbacks,
  ) {}

  areHeld(): boolean {
    return this.shouldHoldAutoFrames();
  }

  setOverride(held: boolean): void {
    this.autoFrameHoldOverride = held;
    if (!held) this.releaseHeld();
  }

  clearOverride(): void {
    this.autoFrameHoldOverride = undefined;
    this.releaseHeldIfReady();
  }

  requestRender(cause: NativeRenderCause): void {
    if (this.shouldHoldAutoFrameCause(cause)) {
      this.holdRenderCause(cause);
      return;
    }
    this.releaseHeldIfReady();
    // Interactive navigation must never sit behind stdout backpressure —
    // deferring transcript-scroll left the viewport stuck for minutes while
    // drain never fired (or kept thrashing). Ambient/content may still wait.
    if (
      this.callbacks.shouldDeferFrameForBackpressure() &&
      !isInteractiveRenderCause(cause)
    ) {
      this.callbacks.deferRenderCause(cause);
      return;
    }
    this.callbacks.requestRenderDirect(cause);
  }

  requestAnimationFrame(callback: NativeAnimationFrameCallback): number {
    if (this.shouldHoldAutoFrameCause('animation')) {
      const id = this.nextHeldAnimationFrameId--;
      this.heldAnimationCallbacks.set(id, callback);
      this.holdRenderCause('animation');
      return id;
    }
    this.releaseHeldIfReady();
    if (this.callbacks.shouldDeferFrameForBackpressure()) {
      return this.callbacks.deferAnimationFrame(callback);
    }
    return this.callbacks.requestAnimationFrameDirect(callback);
  }

  cancelAnimationFrame(id: number): void {
    if (this.heldAnimationCallbacks.delete(id)) {
      if (this.heldAnimationCallbacks.size === 0) {
        this.heldRenderCauses.delete('animation');
      }
      if (this.heldRenderCauses.size === 0) this.clear();
      return;
    }
    if (this.callbacks.cancelDeferredAnimationFrame(id)) return;
    this.callbacks.loopCancelAnimationFrame(id);
  }

  shouldHoldAutoFrameCause(cause: NativeRenderCause | 'animation'): boolean {
    if (this.releasingHeldAutoFrames) return false;
    if (!isAutoFrameHoldCause(cause)) return false;
    return this.shouldHoldAutoFrames();
  }

  releaseHeld(): void {
    const deferredCauses = Array.from(this.heldRenderCauses);
    const deferredCallbacks = Array.from(this.heldAnimationCallbacks.values());
    this.clear();
    if (deferredCauses.length === 0 && deferredCallbacks.length === 0) return;
    this.callbacks.recordMarker('renderer.auto_frame_release', {
      deferredCauses: deferredCauses.join(','),
      deferredAnimations: deferredCallbacks.length,
    });
    this.releasingHeldAutoFrames = true;
    try {
      for (const cb of deferredCallbacks) this.requestAnimationFrame(cb);
      for (const cause of deferredCauses) {
        if (cause === 'animation') continue;
        this.requestRender(cause);
      }
    } finally {
      this.releasingHeldAutoFrames = false;
    }
  }

  clear(): void {
    this.autoFrameHeld = false;
    this.heldRenderCauses.clear();
    this.heldAnimationCallbacks.clear();
  }

  private shouldHoldAutoFrames(): boolean {
    const override = this.autoFrameHoldOverride;
    if (override !== undefined) return override;
    const hold = this.autoFrameHold;
    return typeof hold === 'function' ? hold() : hold === true;
  }

  private holdRenderCause(cause: NativeRenderCause): void {
    this.heldRenderCauses.add(cause);
    this.callbacks.cancelRegionAnimationFrame();
    if (this.autoFrameHeld) return;
    this.autoFrameHeld = true;
    this.callbacks.recordMarker('renderer.auto_frame_hold', { cause });
  }

  private releaseHeldIfReady(): void {
    if (this.shouldHoldAutoFrames()) return;
    this.releaseHeld();
  }
}

/** Wheel/keys/resize must paint even when stdout is backpressured. */
export function isInteractiveRenderCause(cause: NativeRenderCause): boolean {
  return cause === 'input' || cause === 'resize' || cause === 'transcript-scroll';
}
