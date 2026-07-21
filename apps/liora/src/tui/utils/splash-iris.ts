/**
 * Splash → Welcome morph handoff.
 * Shrinks the cinematic brand into the real centered-stage Welcome hero while
 * revealing a live Welcome + Jewel Tank + letterbox/frame scene.
 */

import { padOrTrim } from '#/tui/utils/night-sky';

/** Default length of the splash→Welcome morph handoff. */
export const SPLASH_MORPH_MS = 1100;

export function clamp01(n: number): number {
  return Math.min(1, Math.max(0, n));
}

/** Smoothstep ease for morph progress. */
function easeSmoothstep(t: number): number {
  const p = clamp01(t);
  return p * p * (3 - 2 * p);
}

export function easeOutCubic(t: number): number {
  const p = clamp01(t);
  return 1 - (1 - p) ** 3;
}

export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

/** Morph progress after the cinematic window. */
export function resolveMorphProgress(
  elapsedMs: number,
  cinematicMs: number,
  morphMs: number,
): number {
  if (morphMs <= 0) return 1;
  return easeSmoothstep((elapsedMs - cinematicMs) / morphMs);
}

export interface BrandMorphRect {
  readonly x: number;
  readonly y: number;
  readonly width: number;
}

/** Lerp fullscreen brand rect → Welcome-box hero rect inside the stage.
 * Progress is already eased by resolveMorphProgress — use linearly. */
export function resolveBrandMorphRect(input: {
  readonly progress: number;
  readonly cols: number;
  readonly fromTop: number;
  readonly fromWidth: number;
  readonly to: BrandMorphRect;
}): BrandMorphRect {
  const t = clamp01(input.progress);
  const width = Math.max(8, Math.round(lerp(input.fromWidth, input.to.width, t)));
  const x = Math.round(lerp((input.cols - input.fromWidth) / 2, input.to.x, t));
  const y = Math.round(lerp(input.fromTop, input.to.y, t));
  return { x: Math.max(0, x), y: Math.max(0, y), width };
}

/**
 * Composite morph: center-out reveal of `scene` over `backdrop`, then optional
 * brand overlay lines (caller paints). Whole-row swaps stay ANSI-safe.
 *
 * The aperture expands with the smoothstep curve from resolveMorphProgress so
 * the reveal decelerates into the final lock — eliminating the abrupt snap that
 * previously caused a visible jump near progress ≈ 0.97.
 */
export function applyStageMorphReveal(options: {
  readonly backdrop: readonly string[];
  readonly scene: readonly string[];
  readonly width: number;
  readonly rows: number;
  readonly progress: number;
}): string[] {
  const { backdrop, scene, width, rows } = options;
  const p = clamp01(options.progress);
  const out: string[] = Array.from({ length: rows }, (_, y) =>
    padOrTrim(backdrop[y] ?? ' '.repeat(width), width),
  );
  if (p <= 0 || rows <= 0 || width <= 0) return out;

  // The progress arriving here is already eased by resolveMorphProgress
  // (smoothstep). Use it directly for the aperture to avoid double-easing.
  const cy = (rows - 1) / 2;
  // Aperture expands slightly beyond 50% so edges are fully covered at p=1.
  const halfH = Math.max(0.5, p * (rows * 0.56));

  for (let y = 0; y < rows; y++) {
    if (Math.abs(y - cy) > halfH) continue;
    const sceneLine = padOrTrim(scene[y] ?? ' '.repeat(width), width);
    // Soft rim: within 1 row of the aperture edge, keep backdrop visible
    // until progress is high enough to avoid a hard horizontal cutoff.
    const atRim = Math.abs(y - cy) > halfH - 1.0 && p < 0.90;
    if (atRim) continue;
    out[y] = sceneLine;
  }

  // Final lock: once the aperture covers the full frame, snap every row to
  // scene so the handoff to the real UI is pixel-identical.
  if (p >= 0.95) {
    for (let y = 0; y < rows; y++) {
      out[y] = padOrTrim(scene[y] ?? ' '.repeat(width), width);
    }
  }

  return out;
}


