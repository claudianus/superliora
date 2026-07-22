import type { AmbientEffectMode } from '#/tui/utils/appearance-effects';
import { solveSpring, SPRING_PRESETS, type SpringState } from '@harness-kit/tui-renderer';

// ---------------------------------------------------------------------------
// Premium cinematic motion — shell settle, focus transfer, reflow lerp.
//
// Pure progress helpers only. Callers gate on `motionEffectsAllowed()` /
// `resolveQualityAdjustedAmbientEffectMode()` and pass the result in here so
// this module stays trivially unit-testable (no Date.now(), no theme).
//
// Spring physics integration: dock reveal/hide and reflow now use a damped
// harmonic oscillator for organic, weight-feeling motion instead of linear
// smoothstep. The spring solver is frame-rate independent.
// ---------------------------------------------------------------------------

/** Gate + quality tier shared by every progress helper below. */
export interface ShellMotionOptions {
  /** Result of `motionEffectsAllowed()` at the call site. */
  readonly motion: boolean;
  /** Result of `resolveQualityAdjustedAmbientEffectMode(appearance)`. */
  readonly quality: AmbientEffectMode;
}

/** Outer shell chrome fade-in on first layout / terminal resize. */
export const SHELL_SETTLE_PREMIUM_MS = 160;
export const SHELL_SETTLE_SUBTLE_MS = 90;

/** Column (dock) focus transfer glow blend. */
export const FOCUS_TRANSFER_PREMIUM_MS = 220;
export const FOCUS_TRANSFER_SUBTLE_MS = 110;

/** Paint-only dock width lerp on maximize/dock-toggle/breakpoint reflow. */
export const REFLOW_PREMIUM_MS = 180;

/**
 * Shell chrome settle-in: 0..1 over ~160ms in `premium`, a shorter fade in
 * `subtle`, and an instant snap to 1 when motion is disallowed or quality is
 * `off`.
 */
export function shellSettleProgress(
  now: number,
  startedAt: number,
  options: ShellMotionOptions,
): number {
  return easedGateProgress(now, startedAt, options, SHELL_SETTLE_PREMIUM_MS, SHELL_SETTLE_SUBTLE_MS);
}

/**
 * Column glow blend when focus transfers to a different dock: 0..1 over
 * ~220ms in `premium`, a shorter fade in `subtle`, instant snap to 1 when
 * motion is disallowed or quality is `off`.
 */
export function focusTransferProgress(
  now: number,
  startedAt: number,
  options: ShellMotionOptions,
): number {
  return easedGateProgress(
    now,
    startedAt,
    options,
    FOCUS_TRANSFER_PREMIUM_MS,
    FOCUS_TRANSFER_SUBTLE_MS,
  );
}

/**
 * Paint-only dock width reflow: 0..1 over ~180ms, `premium` only. `subtle`
 * and `off` both snap to 1 (instant) — reflow is a premium-only flourish;
 * `subtle` keeps its short fade elsewhere (focus ring / settle) but never a
 * long paint-only width lerp.
 */
export function reflowProgress(now: number, startedAt: number, options: ShellMotionOptions): number {
  if (!options.motion || options.quality !== 'premium') return 1;
  return smoothstep(clampProgress((now - startedAt) / REFLOW_PREMIUM_MS));
}

/** Paint-only lerp between a dock's previous and next committed width. */
export function lerpDockWidth(fromWidth: number, toWidth: number, progress: number): number {
  const t = clampProgress(progress);
  return Math.round(fromWidth + (toWidth - fromWidth) * t);
}

// ---------------------------------------------------------------------------
// Spring-based dock animation (frame-rate independent)
// ---------------------------------------------------------------------------

export interface SpringDockState {
  readonly value: number;
  readonly velocity: number;
  readonly atRest: boolean;
}

/**
 * Advance a spring-based dock width animation by one frame.
 * Uses the 'smooth' preset for natural dock reveal/hide with slight overshoot.
 *
 * @param current - Current animated width value
 * @param velocity - Current velocity (columns/second)
 * @param target - Target dock width
 * @param dtMs - Frame delta in milliseconds
 * @param options - Motion gate options
 * @returns Next spring state (value, velocity, atRest)
 */
export function springDockWidth(
  current: number,
  velocity: number,
  target: number,
  dtMs: number,
  options: ShellMotionOptions,
): SpringDockState {
  // When motion is disabled or quality is off, snap instantly
  if (!options.motion || options.quality === 'off') {
    return { value: target, velocity: 0, atRest: true };
  }

  const config = options.quality === 'subtle'
    ? SPRING_PRESETS['quick']!.config
    : SPRING_PRESETS['smooth']!.config;

  const state: SpringState = solveSpring(
    current,
    velocity,
    target,
    dtMs / 1000,
    config,
  );

  return { value: state.value, velocity: state.velocity, atRest: state.atRest };
}

/**
 * Spring-based shell inset animation for premium mode.
 * The shell border "breathes" in with a slight bounce on first render.
 */
export function springShellInset(
  current: number,
  velocity: number,
  target: number,
  dtMs: number,
  options: ShellMotionOptions,
): SpringDockState {
  if (!options.motion || options.quality === 'off') {
    return { value: target, velocity: 0, atRest: true };
  }

  const config = options.quality === 'subtle'
    ? SPRING_PRESETS['pulse']!.config
    : SPRING_PRESETS['bouncy']!.config;

  const state = solveSpring(current, velocity, target, dtMs / 1000, config);
  return { value: state.value, velocity: state.velocity, atRest: state.atRest };
}

/**
 * Spring-based focus glow intensity for panel focus transitions.
 * Gives a quick "pop" when a panel gains focus.
 */
export function springFocusGlow(
  current: number,
  velocity: number,
  target: number,
  dtMs: number,
  options: ShellMotionOptions,
): SpringDockState {
  if (!options.motion || options.quality === 'off') {
    return { value: target, velocity: 0, atRest: true };
  }

  const config = SPRING_PRESETS['stiff']!.config;
  const state = solveSpring(current, velocity, target, dtMs / 1000, config);
  return { value: state.value, velocity: state.velocity, atRest: state.atRest };
}

// ---------------------------------------------------------------------------
// Reflow tracking (divider-drag-aware)
// ---------------------------------------------------------------------------

export interface ReflowDockWidths {
  readonly left: number;
  readonly right: number;
}

export interface ReflowTrackingState {
  /** Whether the previous call observed a live divider drag in progress. */
  readonly wasDragging: boolean;
  readonly fromWidth: ReflowDockWidths;
  readonly toWidth: ReflowDockWidths;
}

export interface ReflowTrackingResult extends ReflowTrackingState {
  /** Whether the reflow lerp clock should restart (i.e. start a new lerp). */
  readonly restarted: boolean;
}

/**
 * Pure state transition for the paint-only dock reflow lerp, aware of live
 * divider drags:
 *
 * - Dragging: freeze — mid-drag width changes settle instantly via the
 *   committed rect (`isDragging` gates the paint width elsewhere), so no
 *   tracking update and no lerp restart.
 * - Drag just released (`wasDragging` was true, `isDragging` now false):
 *   snap `fromWidth`/`toWidth` to the current committed width with no
 *   restart. Without this, release would replay a lerp from the stale
 *   pre-drag width frozen while dragging.
 * - Otherwise: start a new lerp toward `nextWidth` whenever it differs
 *   from the previously committed `toWidth` (maximize toggle, dock
 *   visibility, breakpoint change); no-op when unchanged.
 */
export function nextReflowTrackingState(
  state: ReflowTrackingState,
  isDragging: boolean,
  nextWidth: ReflowDockWidths,
): ReflowTrackingResult {
  if (isDragging) {
    return { ...state, wasDragging: true, restarted: false };
  }
  if (state.wasDragging) {
    return { wasDragging: false, fromWidth: nextWidth, toWidth: nextWidth, restarted: false };
  }
  if (nextWidth.left === state.toWidth.left && nextWidth.right === state.toWidth.right) {
    return { ...state, wasDragging: false, restarted: false };
  }
  return { wasDragging: false, fromWidth: state.toWidth, toWidth: nextWidth, restarted: true };
}

/**
 * Column shift to apply to a right-dock tab-close hit zone — recorded
 * against the *painted* (pre-pad) tab-bar string — so it still lines up
 * with the × glyph after `padReflowLine` leading-pads the right dock
 * during a growing/shrinking reflow. The left dock needs no shift: its
 * pad is trailing, so painted x positions there are already correct.
 */
export function reflowHitZoneShift(
  dockId: 'left' | 'right',
  paintWidth: number,
  finalWidth: number,
): number {
  if (dockId !== 'right') return 0;
  return Math.max(0, finalWidth - paintWidth);
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function easedGateProgress(
  now: number,
  startedAt: number,
  options: ShellMotionOptions,
  premiumMs: number,
  subtleMs: number,
): number {
  if (!options.motion || options.quality === 'off') return 1;
  const durationMs = options.quality === 'subtle' ? subtleMs : premiumMs;
  if (durationMs <= 0) return 1;
  return smoothstep(clampProgress((now - startedAt) / durationMs));
}

function clampProgress(t: number): number {
  if (!Number.isFinite(t)) return 1;
  return Math.min(1, Math.max(0, t));
}

/** Cinematic ease — matches the smoothstep used elsewhere in appearance-effects. */
function smoothstep(t: number): number {
  return t * t * (3 - 2 * t);
}
