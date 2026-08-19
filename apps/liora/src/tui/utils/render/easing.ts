/**
 * Shared easing curves for TUI motion.
 *
 * Pure `t → t'` functions over a normalized 0–1 progress. They deliberately
 * carry no timing of their own: callers derive `t` from the shared animation
 * clock (`motionProgress` / `appearanceAnimationNow`) so every effect stays on
 * one clock and one quality gate — see PREMIUM.md §7.1.
 */

export type EasingFunction = (t: number) => number;

export const Easing = {
  linear: (t: number): number => t,

  easeInQuad: (t: number): number => t * t,
  easeOutQuad: (t: number): number => t * (2 - t),
  easeInOutQuad: (t: number): number => (t < 0.5 ? 2 * t * t : -1 + (4 - 2 * t) * t),

  easeInCubic: (t: number): number => t * t * t,
  easeOutCubic: (t: number): number => 1 - Math.pow(1 - t, 3),
  easeInOutCubic: (t: number): number =>
    t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2,

  easeInExpo: (t: number): number => (t === 0 ? 0 : Math.pow(2, 10 * t - 10)),
  easeOutExpo: (t: number): number => (t === 1 ? 1 : 1 - Math.pow(2, -10 * t)),

  easeInElastic: (t: number): number => {
    if (t === 0 || t === 1) return t;
    return -Math.pow(2, 10 * t - 10) * Math.sin((t * 10 - 10.75) * (2 * Math.PI / 3));
  },
  easeOutElastic: (t: number): number => {
    if (t === 0 || t === 1) return t;
    return Math.pow(2, -10 * t) * Math.sin((t * 10 - 0.75) * (2 * Math.PI / 3)) + 1;
  },

  easeOutBounce: (t: number): number => {
    const n1 = 7.5625;
    const d1 = 2.75;
    if (t < 1 / d1) return n1 * t * t;
    if (t < 2 / d1) return n1 * (t -= 1.5 / d1) * t + 0.75;
    if (t < 2.5 / d1) return n1 * (t -= 2.25 / d1) * t + 0.9375;
    return n1 * (t -= 2.625 / d1) * t + 0.984375;
  },

  spring: (t: number): number => {
    const frequency = 4.5;
    const damping = 0.55;
    return 1 - Math.exp(-damping * t * 10) * Math.cos(frequency * t * Math.PI * 2);
  },

  /** Smooth step (Hermite interpolation). */
  smoothStep: (t: number): number => t * t * (3 - 2 * t),

  /** Smoother step (Ken Perlin's improved version). */
  smootherStep: (t: number): number => t * t * t * (t * (t * 6 - 15) + 10),
} satisfies Record<string, EasingFunction>;
