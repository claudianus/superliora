import { shouldAnimate } from '#/tui/controllers/appearance';
import type { AppearancePreferences } from '#/tui/config';
import { SPLASH_MORPH_MS } from '#/tui/utils/splash/splash-iris';

export { SPLASH_MORPH_MS };

export const SPLASH_DURATION_MIN_MS = 1000;
/** Inclusive upper bound for splash duration. */
export const SPLASH_DURATION_MAX_MS = 2000;
/** Default cinematic length (~1.6s). */
export const DEFAULT_SPLASH_DURATION_MS = 1600;

export type SplashPhase =
  | 'void'
  | 'rise'
  | 'bloom'
  | 'brand'
  | 'hold'
  | 'fade'
  | 'morph'
  | 'done';

/**
 * Clamp splash duration into the allowed cinematic window.
 * Non-finite values fall back to the default length.
 */
export function clampSplashDurationMs(durationMs: number): number {
  if (!Number.isFinite(durationMs)) return DEFAULT_SPLASH_DURATION_MS;
  return Math.min(
    SPLASH_DURATION_MAX_MS,
    Math.max(SPLASH_DURATION_MIN_MS, Math.round(durationMs)),
  );
}

/** True when startup should run the animated splash. */
export function shouldPlaySplash(appearance: AppearancePreferences): boolean {
  return shouldAnimate(appearance);
}

/**
 * Map elapsed time to a cinematic phase.
 * Timeline fractions are relative to the clamped duration.
 */
export function resolveSplashPhase(
  elapsedMs: number,
  durationMs: number,
  morphMs: number = SPLASH_MORPH_MS,
): SplashPhase {
  const duration = clampSplashDurationMs(durationMs);
  const morph = Math.max(0, Math.round(morphMs));
  if (duration <= 0) return 'done';
  if (elapsedMs >= duration + morph) return 'done';
  if (elapsedMs >= duration) return morph > 0 ? 'morph' : 'done';
  const t = Math.max(0, elapsedMs) / duration;
  if (t < 0.1) return 'void';
  if (t < 0.32) return 'rise';
  if (t < 0.48) return 'bloom';
  if (t < 0.72) return 'brand';
  if (t < 0.9) return 'hold';
  return 'fade';
}

/** How many banner lines are revealed for the current phase progress. */
export function resolveBannerRevealCount(
  elapsedMs: number,
  durationMs: number,
  totalLines: number,
  morphMs: number = SPLASH_MORPH_MS,
): number {
  if (totalLines <= 0) return 0;
  const phase = resolveSplashPhase(elapsedMs, durationMs, morphMs);
  if (phase === 'void' || phase === 'rise' || phase === 'bloom') return 0;
  if (
    phase === 'done' ||
    phase === 'hold' ||
    phase === 'fade' ||
    phase === 'morph'
  ) {
    return totalLines;
  }
  // brand: progressive reveal
  const duration = clampSplashDurationMs(durationMs);
  const start = 0.48 * duration;
  const end = 0.72 * duration;
  const local = Math.min(1, Math.max(0, (elapsedMs - start) / Math.max(1, end - start)));
  return Math.max(1, Math.ceil(local * totalLines));
}

/** Progress of the Liora mark rise within the rise+bloom window (0..1). */
export function resolveMarkRiseProgress(elapsedMs: number, durationMs: number): number {
  const duration = clampSplashDurationMs(durationMs);
  const start = 0.1 * duration;
  const end = 0.48 * duration;
  return Math.min(1, Math.max(0, (elapsedMs - start) / Math.max(1, end - start)));
}

/** Fade-out alpha in the final phase (1 → 0). */
export function resolveFadeAlpha(
  elapsedMs: number,
  durationMs: number,
  morphMs: number = SPLASH_MORPH_MS,
): number {
  const phase = resolveSplashPhase(elapsedMs, durationMs, morphMs);
  if (phase === 'done') return 0;
  if (phase === 'morph') return 0.62;
  if (phase !== 'fade') return 1;
  const duration = clampSplashDurationMs(durationMs);
  const start = 0.9 * duration;
  const local = Math.min(1, Math.max(0, (elapsedMs - start) / Math.max(1, duration - start)));
  // Keep a readable backdrop when morph follows.
  const floor = morphMs > 0 ? 0.55 : 0;
  return Math.max(floor, 1 - local);
}
