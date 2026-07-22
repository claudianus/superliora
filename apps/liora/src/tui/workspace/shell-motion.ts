import type { AmbientEffectMode } from '#/tui/utils/appearance-effects';

// ---------------------------------------------------------------------------
// Premium cinematic motion — shell settle, focus transfer, reflow lerp.
//
// Pure progress helpers only. Callers gate on `motionEffectsAllowed()` /
// `resolveQualityAdjustedAmbientEffectMode()` and pass the result in here so
// this module stays trivially unit-testable (no Date.now(), no theme).
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
