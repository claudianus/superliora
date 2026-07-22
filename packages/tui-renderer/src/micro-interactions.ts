/**
 * Micro-interaction primitives for premium TUI feel.
 *
 * These are pure, stateless progress/value functions that callers compose
 * into their render paths. Each function takes a timestamp and returns a
 * 0..1 intensity or a transformed value. No side effects, no Date.now() —
 * the caller passes `now` from the render frame.
 *
 * Interactions:
 * - Scroll inertia: momentum-based overscroll bounce-back
 * - Selection pulse: brief highlight flash on selection change
 * - Focus glow: soft border glow when a panel gains focus
 * - Typing ripple: subtle feedback on keystroke
 * - Progress shimmer: animated indeterminate progress indicator
 * - Success flash: brief green flash on operation success
 */

import { solveSpring, SPRING_PRESETS } from '@harness-kit/tui-renderer';

// ---------------------------------------------------------------------------
// Scroll Inertia
// ---------------------------------------------------------------------------

export interface ScrollInertiaState {
  readonly offset: number;
  readonly velocity: number;
  readonly atRest: boolean;
}

/**
 * Advance scroll inertia by one frame. When the user releases a drag or
 * finishes a wheel scroll, the content continues moving with decaying
 * velocity (momentum), then settles via a spring at the boundaries.
 *
 * @param offset - Current scroll offset (rows or pixels)
 * @param velocity - Current velocity (units/second)
 * @param target - Target scroll offset (where the user wants to end up)
 * @param dtMs - Frame delta in milliseconds
 * @param bounds - Optional [min, max] scroll bounds for bounce-back
 */
export function advanceScrollInertia(
  offset: number,
  velocity: number,
  target: number,
  dtMs: number,
  bounds?: readonly [number, number],
): ScrollInertiaState {
  const config = SPRING_PRESETS['smooth']!.config;
  const state = solveSpring(offset, velocity, target, dtMs / 1000, config);

  let value = state.value;

  // Bounce-back at boundaries
  if (bounds) {
    const [min, max] = bounds;
    if (value < min) {
      // Rubber-band: allow slight overscroll with resistance
      const overscroll = min - value;
      value = min - overscroll * 0.3;
    } else if (value > max) {
      const overscroll = value - max;
      value = max + overscroll * 0.3;
    }
  }

  return { offset: value, velocity: state.velocity, atRest: state.atRest };
}

/**
 * Compute the initial velocity for a scroll fling based on recent drag speed.
 * @param recentDelta - Distance moved in the last drag segment (units)
 * @param recentDtMs - Time of the last drag segment (ms)
 * @param multiplier - Velocity multiplier for feel tuning (default 1.2)
 */
export function computeFlingVelocity(
  recentDelta: number,
  recentDtMs: number,
  multiplier = 1.2,
): number {
  if (recentDtMs <= 0) return 0;
  const rawVelocity = (recentDelta / recentDtMs) * 1000; // units/second
  return rawVelocity * multiplier;
}

// ---------------------------------------------------------------------------
// Selection Pulse
// ---------------------------------------------------------------------------

/**
 * Compute the selection pulse intensity (0..1) for a brief highlight flash
 * when the selected item changes. Peaks immediately then decays over ~300ms.
 *
 * @param now - Current timestamp
 * @param selectionChangedAt - When the selection last changed
 * @param durationMs - Pulse duration (default 300ms)
 */
export function selectionPulseIntensity(
  now: number,
  selectionChangedAt: number,
  durationMs = 300,
): number {
  const elapsed = now - selectionChangedAt;
  if (elapsed < 0 || elapsed >= durationMs) return 0;
  const t = elapsed / durationMs;
  // Quick attack, smooth decay
  return Math.exp(-4 * t) * Math.sin(Math.PI * Math.min(1, t * 2));
}

/**
 * Blend a highlight color with the base color based on pulse intensity.
 * Returns the interpolation factor (0 = base, 1 = full highlight).
 */
export function selectionPulseBlend(intensity: number): number {
  return Math.max(0, Math.min(1, intensity * 0.6));
}

// ---------------------------------------------------------------------------
// Focus Glow
// ---------------------------------------------------------------------------

/**
 * Compute the focus glow intensity (0..1) for a panel border that briefly
 * intensifies when the panel gains focus, then settles to a steady state.
 *
 * @param now - Current timestamp
 * @param focusGainedAt - When focus was gained
 * @param steadyState - The resting glow intensity (default 0.4)
 */
export function focusGlowIntensity(
  now: number,
  focusGainedAt: number,
  steadyState = 0.4,
): number {
  const elapsed = now - focusGainedAt;
  if (elapsed < 0) return steadyState;

  // Initial pop: overshoot to ~1.0 then settle to steadyState
  const ATTACK_MS = 120;
  const SETTLE_MS = 400;

  if (elapsed < ATTACK_MS) {
    // Quick ramp to peak
    const t = elapsed / ATTACK_MS;
    return steadyState + (1 - steadyState) * easeOutCubic(t);
  }

  if (elapsed < SETTLE_MS) {
    // Decay from peak to steady state
    const t = (elapsed - ATTACK_MS) / (SETTLE_MS - ATTACK_MS);
    return 1 - (1 - steadyState) * easeInOutCubic(t);
  }

  return steadyState;
}

/**
 * Compute a breathing glow for the focused panel border (ambient animation).
 * Oscillates gently between `min` and `max` intensity.
 *
 * @param now - Current timestamp
 * @param periodMs - Full oscillation period (default 3000ms)
 * @param min - Minimum intensity (default 0.3)
 * @param max - Maximum intensity (default 0.6)
 */
export function breathingGlow(
  now: number,
  periodMs = 3000,
  min = 0.3,
  max = 0.6,
): number {
  const phase = (now % periodMs) / periodMs;
  const wave = (Math.sin(phase * Math.PI * 2 - Math.PI / 2) + 1) / 2;
  return min + (max - min) * wave;
}

// ---------------------------------------------------------------------------
// Typing Ripple
// ---------------------------------------------------------------------------

/**
 * Compute the typing ripple intensity for a subtle editor border flash
 * on each keystroke. Very brief (150ms) and subtle.
 *
 * @param now - Current timestamp
 * @param lastKeystrokeAt - When the last key was pressed
 */
export function typingRippleIntensity(now: number, lastKeystrokeAt: number): number {
  const elapsed = now - lastKeystrokeAt;
  if (elapsed < 0 || elapsed >= 150) return 0;
  const t = elapsed / 150;
  return (1 - t) * 0.3; // Max 30% intensity, linear decay
}

// ---------------------------------------------------------------------------
// Progress Shimmer
// ---------------------------------------------------------------------------

/**
 * Compute the position of an indeterminate progress shimmer (0..1).
 * The shimmer sweeps across the progress bar continuously.
 *
 * @param now - Current timestamp
 * @param periodMs - Full sweep period (default 1500ms)
 * @param width - Width of the shimmer highlight in cells
 * @param totalWidth - Total progress bar width in cells
 */
export function progressShimmerPosition(
  now: number,
  periodMs = 1500,
  width = 4,
  totalWidth = 20,
): number {
  const phase = (now % periodMs) / periodMs;
  // Ease the sweep for a more organic feel
  const eased = easeInOutCubic(phase);
  return eased * (totalWidth + width) - width;
}

/**
 * Render a single cell of the progress shimmer.
 * Returns the intensity (0..1) for a given cell position.
 */
export function progressShimmerCellIntensity(
  cellIndex: number,
  shimmerPos: number,
  shimmerWidth = 4,
): number {
  const dist = Math.abs(cellIndex - shimmerPos);
  if (dist > shimmerWidth) return 0;
  return 1 - dist / shimmerWidth;
}

// ---------------------------------------------------------------------------
// Success Flash
// ---------------------------------------------------------------------------

/**
 * Compute the success flash intensity (0..1) for a brief green flash
 * when an operation completes successfully.
 *
 * @param now - Current timestamp
 * @param completedAt - When the operation completed
 * @param durationMs - Flash duration (default 500ms)
 */
export function successFlashIntensity(
  now: number,
  completedAt: number,
  durationMs = 500,
): number {
  const elapsed = now - completedAt;
  if (elapsed < 0 || elapsed >= durationMs) return 0;
  const t = elapsed / durationMs;
  // Quick peak then smooth decay
  if (t < 0.15) return easeOutCubic(t / 0.15);
  return 1 - easeInOutCubic((t - 0.15) / 0.85);
}

// ---------------------------------------------------------------------------
// Error Shake
// ---------------------------------------------------------------------------

/**
 * Compute a horizontal shake offset (in columns, can be fractional) for
 * error feedback. The element shakes left-right with decaying amplitude.
 *
 * @param now - Current timestamp
 * @param errorAt - When the error occurred
 * @param amplitude - Max shake amplitude in columns (default 1.5)
 * @param durationMs - Shake duration (default 400ms)
 */
export function errorShakeOffset(
  now: number,
  errorAt: number,
  amplitude = 1.5,
  durationMs = 400,
): number {
  const elapsed = now - errorAt;
  if (elapsed < 0 || elapsed >= durationMs) return 0;
  const t = elapsed / durationMs;
  const decay = 1 - t;
  const frequency = 3; // oscillations
  return Math.sin(t * Math.PI * 2 * frequency) * amplitude * decay * decay;
}

// ---------------------------------------------------------------------------
// Easing helpers
// ---------------------------------------------------------------------------

function easeOutCubic(t: number): number {
  return 1 - (1 - t) ** 3;
}

function easeInOutCubic(t: number): number {
  return t < 0.5 ? 4 * t ** 3 : 1 - (-2 * t + 2) ** 3 / 2;
}
