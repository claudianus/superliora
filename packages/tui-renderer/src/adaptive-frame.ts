/**
 * AdaptiveFrameController — dynamic frame rate management for the TUI.
 *
 * Instead of rendering at a fixed FPS, this controller adjusts the render
 * interval based on:
 * - Content change rate (dirty line ratio)
 * - Animation activity (spring/ambient animations running)
 * - Terminal capabilities (kitty sync output = faster)
 * - System load (event loop lag, memory pressure)
 * - User interaction (input events boost FPS temporarily)
 *
 * Frame budget tiers:
 * - Turbo (60fps): Active animations, user scrolling, streaming output
 * - Normal (30fps): Ambient animations, periodic updates
 * - Eco (10fps): Idle, no changes, background only
 * - Sleep (2fps): Terminal unfocused, no activity
 *
 * The controller uses a PID-inspired approach: it measures actual frame
 * times and adjusts the target interval to maintain smooth rendering
 * without wasting CPU on unnecessary repaints.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type FrameTier = 'turbo' | 'normal' | 'eco' | 'sleep';

export interface FrameControllerState {
  readonly tier: FrameTier;
  readonly targetFps: number;
  readonly actualFps: number;
  readonly intervalMs: number;
  readonly dirtyRatio: number;
  readonly animationActive: boolean;
  readonly lastInputMs: number;
  readonly frameTimeMs: number;
  readonly droppedFrames: number;
}

export interface FrameControllerOptions {
  /** Maximum FPS cap. Default: 60. */
  readonly maxFps?: number;
  /** Minimum FPS floor. Default: 2. */
  readonly minFps?: number;
  /** How long after input to stay in turbo (ms). Default: 2000. */
  readonly inputBoostDurationMs?: number;
  /** Dirty ratio threshold to trigger turbo. Default: 0.1. */
  readonly dirtyThreshold?: number;
  /** Whether terminal supports sync output (kitty). */
  readonly syncOutput?: boolean;
  /** Frame time budget in ms. Default: 16 (60fps). */
  readonly frameBudgetMs?: number;
}

export interface FrameSignals {
  /** Ratio of dirty lines in the last frame (0-1). */
  readonly dirtyRatio: number;
  /** Whether any animations are currently running. */
  readonly animationActive: boolean;
  /** Whether the terminal is focused. */
  readonly focused: boolean;
  /** Whether streaming output is active. */
  readonly streaming: boolean;
  /** Current event loop lag in ms. */
  readonly eventLoopLagMs: number;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const TIER_FPS: Record<FrameTier, number> = {
  turbo: 60,
  normal: 30,
  eco: 10,
  sleep: 2,
};

const DEFAULT_MAX_FPS = 60;
const DEFAULT_MIN_FPS = 2;
const DEFAULT_INPUT_BOOST_MS = 2000;
const DEFAULT_DIRTY_THRESHOLD = 0.1;
const DEFAULT_FRAME_BUDGET_MS = 16;

/** How quickly FPS ramps up (frames to reach target). */
const RAMP_UP_FRAMES = 3;
/** How quickly FPS ramps down (frames to reach target). */
const RAMP_DOWN_FRAMES = 10;

// ---------------------------------------------------------------------------
// AdaptiveFrameController
// ---------------------------------------------------------------------------

export class AdaptiveFrameController {
  private readonly maxFps: number;
  private readonly minFps: number;
  private readonly inputBoostDurationMs: number;
  private readonly dirtyThreshold: number;
  private readonly syncOutput: boolean;
  private readonly frameBudgetMs: number;

  private _tier: FrameTier = 'normal';
  private _targetFps = 30;
  private _currentIntervalMs = 33;
  private _lastInputMs = 0;
  private _lastFrameMs = 0;
  private _frameTimeMs = 0;
  private _droppedFrames = 0;
  private _totalFrames = 0;

  // FPS smoothing (exponential moving average)
  private _emaFps = 30;
  private readonly emaAlpha = 0.2;

  // Frame time history for adaptive budget
  private frameTimes: number[] = [];
  private readonly maxFrameHistory = 30;

  // Tier transition cooldown (prevent oscillation)
  private lastTierChangeMs = 0;
  private readonly tierCooldownMs = 500;

  constructor(options?: FrameControllerOptions) {
    this.maxFps = options?.maxFps ?? DEFAULT_MAX_FPS;
    this.minFps = options?.minFps ?? DEFAULT_MIN_FPS;
    this.inputBoostDurationMs = options?.inputBoostDurationMs ?? DEFAULT_INPUT_BOOST_MS;
    this.dirtyThreshold = options?.dirtyThreshold ?? DEFAULT_DIRTY_THRESHOLD;
    this.syncOutput = options?.syncOutput ?? false;
    this.frameBudgetMs = options?.frameBudgetMs ?? DEFAULT_FRAME_BUDGET_MS;
  }

  // ─── Input Signals ──────────────────────────────────────────────────

  /** Call when user input is received (key, mouse, etc). */
  reportInput(now: number = Date.now()): void {
    this._lastInputMs = now;
    // Immediate boost to turbo on input
    this.setTier('turbo', now);
  }

  /** Call at the start of each frame with current signals. */
  beginFrame(signals: FrameSignals, now: number = Date.now()): void {
    this._totalFrames++;

    // Determine desired tier from signals
    const desiredTier = this.computeDesiredTier(signals, now);
    this.setTier(desiredTier, now);

    // Adjust FPS based on tier
    const tierFps = TIER_FPS[this._tier];
    this._targetFps = Math.min(tierFps, this.maxFps);
  }

  /** Call at the end of each frame with the actual frame time. */
  endFrame(frameTimeMs: number, now: number = Date.now()): void {
    this._frameTimeMs = frameTimeMs;
    this._lastFrameMs = now;

    // Track frame times
    this.frameTimes.push(frameTimeMs);
    if (this.frameTimes.length > this.maxFrameHistory) {
      this.frameTimes.shift();
    }

    // Detect dropped frames (frame took longer than budget)
    const budget = 1000 / this._targetFps;
    if (frameTimeMs > budget * 1.5) {
      this._droppedFrames++;
    }

    // Update EMA FPS
    const instantFps = frameTimeMs > 0 ? 1000 / frameTimeMs : this.maxFps;
    this._emaFps = this._emaFps + this.emaAlpha * (instantFps - this._emaFps);

    // Adaptive: if consistently over budget, reduce target FPS
    this.adaptToPerformance();
  }

  // ─── Queries ────────────────────────────────────────────────────────

  /** Get the current render interval in ms. */
  get intervalMs(): number {
    return this._currentIntervalMs;
  }

  /** Whether we should render this tick (based on interval). */
  shouldRender(now: number): boolean {
    return now - this._lastFrameMs >= this._currentIntervalMs;
  }

  /** Get the current state snapshot. */
  get state(): FrameControllerState {
    return {
      tier: this._tier,
      targetFps: this._targetFps,
      actualFps: Math.round(this._emaFps * 10) / 10,
      intervalMs: this._currentIntervalMs,
      dirtyRatio: 0, // Set by beginFrame caller
      animationActive: this._tier === 'turbo' || this._tier === 'normal',
      lastInputMs: this._lastInputMs,
      frameTimeMs: this._frameTimeMs,
      droppedFrames: this._droppedFrames,
    };
  }

  get tier(): FrameTier {
    return this._tier;
  }

  get targetFps(): number {
    return this._targetFps;
  }

  get actualFps(): number {
    return this._emaFps;
  }

  get totalFrames(): number {
    return this._totalFrames;
  }

  get droppedFrames(): number {
    return this._droppedFrames;
  }

  /** Get the average frame time over the history window. */
  get avgFrameTimeMs(): number {
    if (this.frameTimes.length === 0) return 0;
    return this.frameTimes.reduce((a, b) => a + b, 0) / this.frameTimes.length;
  }

  /** Get the 95th percentile frame time (for jank detection). */
  get p95FrameTimeMs(): number {
    if (this.frameTimes.length === 0) return 0;
    const sorted = [...this.frameTimes].sort((a, b) => a - b);
    const idx = Math.floor(sorted.length * 0.95);
    return sorted[Math.min(idx, sorted.length - 1)]!;
  }

  // ─── Internal ───────────────────────────────────────────────────────

  private computeDesiredTier(signals: FrameSignals, now: number): FrameTier {
    // Sleep: terminal unfocused and no streaming
    if (!signals.focused && !signals.streaming) {
      return 'sleep';
    }

    // Turbo: user input, high dirty ratio, or streaming
    const recentInput = now - this._lastInputMs < this.inputBoostDurationMs;
    if (recentInput || signals.dirtyRatio > this.dirtyThreshold || signals.streaming) {
      return 'turbo';
    }

    // Normal: animations running
    if (signals.animationActive) {
      return 'normal';
    }

    // Eco: event loop lag is high (system under load)
    if (signals.eventLoopLagMs > 50) {
      return 'eco';
    }

    // Default: eco for idle
    return 'eco';
  }

  private setTier(tier: FrameTier, now: number): void {
    if (tier === this._tier) return;

    // Cooldown: don't change tier too frequently (prevent oscillation)
    if (now - this.lastTierChangeMs < this.tierCooldownMs) {
      // Allow upgrade (eco→turbo) immediately, but delay downgrade
      const tierRank: Record<FrameTier, number> = { turbo: 3, normal: 2, eco: 1, sleep: 0 };
      if (tierRank[tier] < tierRank[this._tier]) {
        return; // Skip downgrade during cooldown
      }
    }

    this._tier = tier;
    this.lastTierChangeMs = now;

    // Update interval with ramp
    const targetInterval = 1000 / TIER_FPS[tier];
    if (targetInterval < this._currentIntervalMs) {
      // Ramp up quickly
      this._currentIntervalMs = Math.max(
        targetInterval,
        this._currentIntervalMs - (this._currentIntervalMs - targetInterval) / RAMP_UP_FRAMES,
      );
    } else {
      // Ramp down slowly
      this._currentIntervalMs = Math.min(
        targetInterval,
        this._currentIntervalMs + (targetInterval - this._currentIntervalMs) / RAMP_DOWN_FRAMES,
      );
    }

    // Sync output allows tighter intervals
    if (this.syncOutput && tier === 'turbo') {
      this._currentIntervalMs = Math.max(this._currentIntervalMs, 1000 / this.maxFps);
    }
  }

  private adaptToPerformance(): void {
    // If p95 frame time exceeds budget, reduce target FPS
    const p95 = this.p95FrameTimeMs;
    const budget = this.frameBudgetMs;

    if (p95 > budget * 2 && this._targetFps > this.minFps) {
      // Reduce FPS by 20%
      this._targetFps = Math.max(this.minFps, Math.floor(this._targetFps * 0.8));
      this._currentIntervalMs = 1000 / this._targetFps;
    } else if (p95 < budget * 0.5 && this._targetFps < TIER_FPS[this._tier]) {
      // Recover FPS gradually
      this._targetFps = Math.min(TIER_FPS[this._tier], this._targetFps + 2);
      this._currentIntervalMs = 1000 / this._targetFps;
    }
  }
}

// ---------------------------------------------------------------------------
// Frame Scheduler (integrates with render loop)
// ---------------------------------------------------------------------------

export interface FrameSchedule {
  /** Whether to render this tick. */
  readonly render: boolean;
  /** Whether to run animations this tick. */
  readonly animate: boolean;
  /** Whether to update ambient effects. */
  readonly ambient: boolean;
  /** Suggested timeout until next tick (ms). */
  readonly nextTickMs: number;
}

/**
 * Compute a frame schedule for the current tick.
 * Separates rendering, animation, and ambient updates to allow
 * selective processing based on the current tier.
 */
export function computeFrameSchedule(
  controller: AdaptiveFrameController,
  now: number,
): FrameSchedule {
  const tier = controller.tier;
  const shouldRender = controller.shouldRender(now);

  return {
    render: shouldRender,
    animate: tier === 'turbo' || tier === 'normal',
    ambient: tier !== 'sleep',
    nextTickMs: controller.intervalMs,
  };
}
