/**
 * Spring physics animation engine for natural, organic motion.
 *
 * Springs provide physically-based animation that feels responsive and alive —
 * ideal for panel transitions, dock reveal/hide, focus shifts, and micro-
 * interactions that need "weight" without feeling robotic.
 *
 * The implementation uses a damped harmonic oscillator solved analytically
 * per-frame (no fixed timestep required), making it frame-rate independent.
 *
 * Reference: "Spring Animations" — Apple HIG motion guidelines;
 * "Physics-Based Animation" — Framer Motion spring model.
 */

import type { RendererAnimationClock, RendererAnimationFrame } from './animation';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface SpringConfig {
  /** Mass of the animated object. Higher = more inertia. @default 1 */
  readonly mass?: number;
  /** Spring stiffness (tension). Higher = snappier. @default 170 */
  readonly stiffness?: number;
  /** Damping coefficient. Higher = less oscillation. @default 26 */
  readonly damping?: number;
  /** Velocity threshold to consider the spring at rest. @default 0.001 */
  readonly restVelocityThreshold?: number;
  /** Displacement threshold to consider the spring at rest. @default 0.001 */
  readonly restDisplacementThreshold?: number;
}

export interface SpringState {
  /** Current value. */
  readonly value: number;
  /** Current velocity (units/second). */
  readonly velocity: number;
  /** Whether the spring has settled. */
  readonly atRest: boolean;
}

export interface SpringPreset {
  readonly name: string;
  readonly config: Required<SpringConfig>;
}

// ---------------------------------------------------------------------------
// Presets
// ---------------------------------------------------------------------------

const DEFAULT_CONFIG: Required<SpringConfig> = {
  mass: 1,
  stiffness: 170,
  damping: 26,
  restVelocityThreshold: 0.001,
  restDisplacementThreshold: 0.001,
};

/**
 * Pre-tuned spring presets for common TUI interactions.
 * Tuned for 60fps terminal rendering with perceptual smoothness.
 */
export const SPRING_PRESETS: Record<string, SpringPreset> = {
  /** Quick panel focus shift — snappy, minimal overshoot. */
  quick: {
    name: 'quick',
    config: { mass: 0.8, stiffness: 280, damping: 30, restVelocityThreshold: 0.001, restDisplacementThreshold: 0.001 },
  },
  /** Standard UI transition — balanced responsiveness and smoothness. */
  smooth: {
    name: 'smooth',
    config: { mass: 1, stiffness: 170, damping: 26, restVelocityThreshold: 0.001, restDisplacementThreshold: 0.001 },
  },
  /** Dock reveal — slight overshoot for a "physical" feel. */
  bouncy: {
    name: 'bouncy',
    config: { mass: 1, stiffness: 200, damping: 18, restVelocityThreshold: 0.001, restDisplacementThreshold: 0.001 },
  },
  /** Heavy panel settle — slow, deliberate, premium weight. */
  heavy: {
    name: 'heavy',
    config: { mass: 2, stiffness: 120, damping: 24, restVelocityThreshold: 0.001, restDisplacementThreshold: 0.001 },
  },
  /** Micro-interaction pulse — very fast, no overshoot. */
  pulse: {
    name: 'pulse',
    config: { mass: 0.5, stiffness: 400, damping: 35, restVelocityThreshold: 0.001, restDisplacementThreshold: 0.001 },
  },
  /** Gentle ambient drift — slow, barely perceptible. */
  ambient: {
    name: 'ambient',
    config: { mass: 3, stiffness: 60, damping: 20, restVelocityThreshold: 0.0005, restDisplacementThreshold: 0.0005 },
  },
  /** Stiff snap — almost instant, for focus flash and selection. */
  stiff: {
    name: 'stiff',
    config: { mass: 0.6, stiffness: 500, damping: 40, restVelocityThreshold: 0.001, restDisplacementThreshold: 0.001 },
  },
};

// ---------------------------------------------------------------------------
// Spring Solver
// ---------------------------------------------------------------------------

/**
 * Analytically solve a damped harmonic oscillator for the given time delta.
 *
 * The equation of motion: m·x'' + c·x' + k·x = 0
 * where x = displacement from target, m = mass, c = damping, k = stiffness.
 *
 * Three regimes:
 * - Underdamped (ζ < 1): oscillates with exponential decay
 * - Critically damped (ζ = 1): fastest convergence without oscillation
 * - Overdamped (ζ > 1): slow exponential convergence
 */
export function solveSpring(
  current: number,
  velocity: number,
  target: number,
  dtSeconds: number,
  config: Required<SpringConfig>,
): SpringState {
  const { mass, stiffness, damping, restVelocityThreshold, restDisplacementThreshold } = config;

  // Displacement from target
  const x0 = current - target;
  const v0 = velocity;

  // Early exit: already at rest
  if (Math.abs(x0) < restDisplacementThreshold && Math.abs(v0) < restVelocityThreshold) {
    return { value: target, velocity: 0, atRest: true };
  }

  // Clamp dt to avoid instability on frame drops (max 64ms ≈ 15fps)
  const dt = Math.min(dtSeconds, 0.064);

  // Natural frequency and damping ratio
  const omega0 = Math.sqrt(stiffness / mass);
  const zeta = damping / (2 * Math.sqrt(stiffness * mass));

  let newValue: number;
  let newVelocity: number;

  if (zeta < 1) {
    // Underdamped: oscillatory decay
    const omegaD = omega0 * Math.sqrt(1 - zeta * zeta);
    const expDecay = Math.exp(-zeta * omega0 * dt);
    const cosW = Math.cos(omegaD * dt);
    const sinW = Math.sin(omegaD * dt);

    const c1 = x0;
    const c2 = (v0 + zeta * omega0 * x0) / omegaD;

    newValue = target + expDecay * (c1 * cosW + c2 * sinW);
    newVelocity = expDecay * (
      (-zeta * omega0 * c1 + omegaD * c2) * cosW +
      (-zeta * omega0 * c2 - omegaD * c1) * sinW
    );
  } else if (Math.abs(zeta - 1) < 1e-6) {
    // Critically damped
    const expDecay = Math.exp(-omega0 * dt);
    const c1 = x0;
    const c2 = v0 + omega0 * x0;

    newValue = target + expDecay * (c1 + c2 * dt);
    newVelocity = expDecay * (c2 - omega0 * (c1 + c2 * dt));
  } else {
    // Overdamped: two real roots
    const sqrtDisc = omega0 * Math.sqrt(zeta * zeta - 1);
    const r1 = -zeta * omega0 + sqrtDisc;
    const r2 = -zeta * omega0 - sqrtDisc;

    const c2 = (v0 - r1 * x0) / (r2 - r1);
    const c1 = x0 - c2;

    const exp1 = Math.exp(r1 * dt);
    const exp2 = Math.exp(r2 * dt);

    newValue = target + c1 * exp1 + c2 * exp2;
    newVelocity = c1 * r1 * exp1 + c2 * r2 * exp2;
  }

  // Check if settled
  const displacement = Math.abs(newValue - target);
  const speed = Math.abs(newVelocity);
  const atRest = displacement < restDisplacementThreshold && speed < restVelocityThreshold;

  return {
    value: atRest ? target : newValue,
    velocity: atRest ? 0 : newVelocity,
    atRest,
  };
}

// ---------------------------------------------------------------------------
// Spring Instance (stateful, clock-driven)
// ---------------------------------------------------------------------------

export interface RendererSpringOptions extends SpringConfig {
  readonly clock: RendererAnimationClock;
  readonly initial?: number;
  readonly preset?: keyof typeof SPRING_PRESETS | string;
  readonly onUpdate?: (state: SpringState) => void;
  readonly onRest?: (state: SpringState) => void;
}

/**
 * A stateful spring animation bound to a render clock.
 *
 * Usage:
 * ```ts
 * const spring = new RendererSpring({
 *   clock: renderClock,
 *   preset: 'smooth',
 *   initial: 0,
 *   onUpdate: ({ value }) => setPanelWidth(value),
 * });
 * spring.setTarget(42); // animate towards 42 columns
 * ```
 */
export class RendererSpring {
  private readonly config: Required<SpringConfig>;
  private readonly clock: RendererAnimationClock;
  private readonly onUpdate?: (state: SpringState) => void;
  private readonly onRest?: (state: SpringState) => void;

  private current: number;
  private velocity = 0;
  private target: number;
  private animationId: number | null = null;
  private lastTimestamp: number | null = null;
  private settled = true;

  constructor(options: RendererSpringOptions) {
    const presetConfig = options.preset
      ? SPRING_PRESETS[options.preset]?.config
      : undefined;
    this.config = { ...DEFAULT_CONFIG, ...presetConfig, ...stripNonSpringKeys(options) };
    this.clock = options.clock;
    this.onUpdate = options.onUpdate;
    this.onRest = options.onRest;
    this.current = options.initial ?? 0;
    this.target = this.current;
  }

  get value(): number {
    return this.current;
  }

  get isAnimating(): boolean {
    return !this.settled;
  }

  /** Set a new target, starting the spring animation. */
  setTarget(target: number): void {
    if (target === this.target && !this.settled) return;
    this.target = target;
    this.settled = false;
    this.ensureRunning();
  }

  /** Jump to a value immediately (no animation). */
  snap(value: number): void {
    this.current = value;
    this.target = value;
    this.velocity = 0;
    this.settled = true;
    this.stop();
    this.onUpdate?.({ value, velocity: 0, atRest: true });
  }

  /** Add an impulse (velocity kick) without changing the target. */
  impulse(velocityDelta: number): void {
    this.velocity += velocityDelta;
    this.settled = false;
    this.ensureRunning();
  }

  /** Stop the animation loop (value stays where it is). */
  stop(): void {
    if (this.animationId !== null) {
      this.clock.cancelAnimationFrame(this.animationId);
      this.animationId = null;
    }
    this.lastTimestamp = null;
  }

  /** Destroy the spring and release resources. */
  destroy(): void {
    this.stop();
  }

  private ensureRunning(): void {
    if (this.animationId !== null) return;
    this.lastTimestamp = null;
    this.animationId = this.clock.requestAnimationFrame(this.tick);
  }

  private tick = (frame: RendererAnimationFrame): void => {
    if (this.settled) {
      this.animationId = null;
      return;
    }

    const dtSeconds = this.lastTimestamp === null
      ? 1 / 60 // Assume 60fps for the first frame
      : Math.max(0, (frame.timestamp - this.lastTimestamp) / 1000);
    this.lastTimestamp = frame.timestamp;

    const state = solveSpring(
      this.current,
      this.velocity,
      this.target,
      dtSeconds,
      this.config,
    );

    this.current = state.value;
    this.velocity = state.velocity;

    if (state.atRest) {
      this.settled = true;
      this.animationId = null;
      this.onUpdate?.(state);
      this.onRest?.(state);
      return;
    }

    this.onUpdate?.(state);
    this.animationId = this.clock.requestAnimationFrame(this.tick);
  };
}

// ---------------------------------------------------------------------------
// Multi-value spring (2D / vector)
// ---------------------------------------------------------------------------

export interface Spring2DState {
  readonly x: number;
  readonly y: number;
  readonly velocityX: number;
  readonly velocityY: number;
  readonly atRest: boolean;
}

/**
 * A 2D spring for animating positions (e.g., panel slide-in, cursor follow).
 * Internally runs two independent 1D springs with the same config.
 */
export class RendererSpring2D {
  private readonly springX: RendererSpring;
  private readonly springY: RendererSpring;
  private readonly onUpdate2D?: (state: Spring2DState) => void;

  constructor(options: Omit<RendererSpringOptions, 'initial' | 'onUpdate' | 'onRest'> & {
    readonly initialX?: number;
    readonly initialY?: number;
    readonly onUpdate?: (state: Spring2DState) => void;
    readonly onRest?: (state: Spring2DState) => void;
  }) {
    this.onUpdate2D = options.onUpdate;
    let lastX = options.initialX ?? 0;
    let lastY = options.initialY ?? 0;

    const emitUpdate = () => {
      this.onUpdate2D?.({
        x: this.springX.value,
        y: this.springY.value,
        velocityX: 0,
        velocityY: 0,
        atRest: !this.springX.isAnimating && !this.springY.isAnimating,
      });
    };

    this.springX = new RendererSpring({
      ...options,
      initial: options.initialX ?? 0,
      onUpdate: () => { lastX = this.springX.value; emitUpdate(); },
      onRest: () => emitUpdate(),
    });

    this.springY = new RendererSpring({
      ...options,
      initial: options.initialY ?? 0,
      onUpdate: () => { lastY = this.springY.value; emitUpdate(); },
      onRest: () => emitUpdate(),
    });
  }

  get x(): number { return this.springX.value; }
  get y(): number { return this.springY.value; }
  get isAnimating(): boolean { return this.springX.isAnimating || this.springY.isAnimating; }

  setTarget(x: number, y: number): void {
    this.springX.setTarget(x);
    this.springY.setTarget(y);
  }

  snap(x: number, y: number): void {
    this.springX.snap(x);
    this.springY.snap(y);
  }

  destroy(): void {
    this.springX.destroy();
    this.springY.destroy();
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function stripNonSpringKeys(options: RendererSpringOptions): Partial<SpringConfig> {
  const { clock, initial, preset, onUpdate, onRest, ...config } = options;
  return config;
}

/**
 * Create a spring config from a "response" and "dampingRatio" pair
 * (the Framer Motion / React Spring API style).
 *
 * @param response - Duration of one oscillation period (ms → converted to stiffness)
 * @param dampingRatio - 0 = undamped, 1 = critical, >1 = overdamped
 */
export function springFromResponse(response: number, dampingRatio: number): Required<SpringConfig> {
  const mass = 1;
  const omega0 = (2 * Math.PI) / (response / 1000);
  const stiffness = omega0 * omega0 * mass;
  const damping = 2 * dampingRatio * omega0 * mass;
  return {
    mass,
    stiffness,
    damping,
    restVelocityThreshold: 0.001,
    restDisplacementThreshold: 0.001,
  };
}
