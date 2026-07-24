/**
 * Feedback micro-interaction controller.
 *
 * Records the wall-clock time of discrete interaction events (error, success,
 * focus gain, selection change) and exposes gated intensity getters backed by
 * the renderer's pure micro-interaction curves. Typing reuses the prompt-input
 * interaction clock (`lastTUIInputInteractionAtMs`) so pure-input frames keep a
 * single hot-path clock and never trigger structural recompute here.
 *
 * Every getter degrades to a neutral value (0 intensity / 0 offset) when motion
 * effects are disallowed or the ambient effect mode resolves to `'off'`, so
 * callers can blend the result unconditionally without re-checking the
 * reduced-motion / low-color policy themselves.
 */

import {
  errorShakeOffset,
  focusGlowIntensity,
  mixHexColor,
  selectionPulseIntensity,
  successFlashIntensity,
  typingRippleIntensity,
} from '#/tui/renderer';
import {
  getActiveAppearancePreferences,
  shouldRenderAmbientEffects,
} from '#/tui/utils/appearance-effects';
import { lastTUIInputInteractionAtMs } from '#/tui/utils/input-interaction';

let lastErrorAtMs = 0;
let lastSuccessAtMs = 0;
let lastFocusGainedAtMs = 0;
let lastSelectionChangedAtMs = 0;

export function noteErrorFeedback(nowMs: number = Date.now()): void {
  lastErrorAtMs = Math.max(0, nowMs);
}

export function noteSuccessFeedback(nowMs: number = Date.now()): void {
  lastSuccessAtMs = Math.max(0, nowMs);
}

export function noteFocusFeedback(nowMs: number = Date.now()): void {
  lastFocusGainedAtMs = Math.max(0, nowMs);
}

export function noteSelectionFeedback(nowMs: number = Date.now()): void {
  lastSelectionChangedAtMs = Math.max(0, nowMs);
}

/**
 * True when feedback micro-interactions may animate. Mirrors the ambient
 * effect gate: motion allowed AND quality-adjusted ambient mode is not `'off'`.
 */
export function feedbackEffectsActive(): boolean {
  return shouldRenderAmbientEffects(getActiveAppearancePreferences());
}

/** Typing ripple intensity (0..~0.3). Drives a short border flash on keystroke. */
export function typingRippleFeedback(nowMs: number = Date.now()): number {
  if (!feedbackEffectsActive()) return 0;
  const keystrokeAt = lastTUIInputInteractionAtMs();
  if (keystrokeAt <= 0) return 0;
  return typingRippleIntensity(nowMs, keystrokeAt);
}

/** Horizontal error-shake offset in (fractional) columns; 0 when idle/off. */
export function errorShakeFeedback(nowMs: number = Date.now()): number {
  if (!feedbackEffectsActive() || lastErrorAtMs <= 0) return 0;
  return errorShakeOffset(nowMs, lastErrorAtMs);
}

/** Success/completion flash intensity (0..1); 0 when idle/off. */
export function successFlashFeedback(nowMs: number = Date.now()): number {
  if (!feedbackEffectsActive() || lastSuccessAtMs <= 0) return 0;
  return successFlashIntensity(nowMs, lastSuccessAtMs);
}

/** Focus-gain glow intensity (0..1); 0 when no focus event recorded or off. */
export function focusGlowFeedback(nowMs: number = Date.now()): number {
  if (!feedbackEffectsActive() || lastFocusGainedAtMs <= 0) return 0;
  return focusGlowIntensity(nowMs, lastFocusGainedAtMs);
}

/** Selection-change pulse intensity (0..1); 0 when idle/off. */
export function selectionPulseFeedback(nowMs: number = Date.now()): number {
  if (!feedbackEffectsActive() || lastSelectionChangedAtMs <= 0) return 0;
  return selectionPulseIntensity(nowMs, lastSelectionChangedAtMs);
}

/**
 * Editor border glow color. Blends the static focus border (`baseHex`) toward
 * the glow `accentHex` by the combined typing-ripple / focus-glow intensity, so
 * the prompt frame briefly warms on a keystroke and settles into a soft halo
 * after focus gain. Returns `baseHex` unchanged when feedback effects are
 * inactive (reduced-motion / low-color), making the fallback automatic.
 */
export function feedbackBorderGlowHex(
  baseHex: string,
  accentHex: string,
  nowMs: number = Date.now(),
): string {
  const ripple = typingRippleFeedback(nowMs);
  const glow = focusGlowFeedback(nowMs);
  const t = Math.min(1, Math.max(ripple, glow * 0.5));
  if (t <= 0.001) return baseHex;
  return mixHexColor(baseHex, accentHex, t);
}

/** Test helper — do not use in product paths. */
export function resetFeedbackVfxForTests(): void {
  lastErrorAtMs = 0;
  lastSuccessAtMs = 0;
  lastFocusGainedAtMs = 0;
  lastSelectionChangedAtMs = 0;
}
