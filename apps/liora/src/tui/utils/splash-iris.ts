/**
 * Splash → Welcome morph handoff.
 * Shrinks the cinematic brand into the real centered-stage Welcome hero while
 * revealing a live Welcome + Jewel Tank + letterbox/frame scene.
 */

import { padOrTrim } from '#/tui/utils/night-sky';

/** Default length of the splash→Welcome morph handoff. */
export const SPLASH_MORPH_MS = 1100;

/** @deprecated Use {@link SPLASH_MORPH_MS}. Kept for call-site compatibility. */
export const SPLASH_IRIS_MS = SPLASH_MORPH_MS;

export function clamp01(n: number): number {
  return Math.min(1, Math.max(0, n));
}

/** Smoothstep ease shared with the former iris path. */
export function easeSmoothstep(t: number): number {
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

/** @deprecated Prefer {@link resolveMorphProgress}. */
export function resolveIrisProgress(
  elapsedMs: number,
  cinematicMs: number,
  irisMs: number,
): number {
  return resolveMorphProgress(elapsedMs, cinematicMs, irisMs);
}

export interface BrandMorphRect {
  readonly x: number;
  readonly y: number;
  readonly width: number;
}

/** Lerp fullscreen brand rect → Welcome-box hero rect inside the stage. */
export function resolveBrandMorphRect(input: {
  readonly progress: number;
  readonly cols: number;
  readonly fromTop: number;
  readonly fromWidth: number;
  readonly to: BrandMorphRect;
}): BrandMorphRect {
  const t = easeOutCubic(input.progress);
  const width = Math.max(8, Math.round(lerp(input.fromWidth, input.to.width, t)));
  const x = Math.round(lerp((input.cols - input.fromWidth) / 2, input.to.x, t));
  const y = Math.round(lerp(input.fromTop, input.to.y, t));
  return { x: Math.max(0, x), y: Math.max(0, y), width };
}

/**
 * Composite morph: center-out reveal of `scene` over `backdrop`, then optional
 * brand overlay lines (caller paints). Whole-row swaps stay ANSI-safe.
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

  // Center-vertical + center-horizontal aperture expanding/opening onto scene.
  // Early: small window; late: full frame so handoff lock can match Welcome.
  const cy = (rows - 1) / 2;
  const cx = (width - 1) / 2;
  const halfH = Math.max(0.5, (p * 1.05) * (rows * 0.55));
  const halfW = Math.max(0.5, (p * 1.05) * (width * 0.55));

  for (let y = 0; y < rows; y++) {
    if (Math.abs(y - cy) > halfH) continue;
    const sceneLine = padOrTrim(scene[y] ?? ' '.repeat(width), width);
    // Near the aperture rim, keep a soft brand flare band.
    const edge = Math.abs(y - cy) > halfH - 1.25 && p < 0.92;
    if (edge) continue;
    // Column aperture: prefer full scene rows once wide enough (ANSI-safe).
    if (halfW >= width * 0.48 || p >= 0.88) {
      out[y] = sceneLine;
    } else {
      // Mid morph: still whole-row for ANSI safety, but only within halfH.
      out[y] = sceneLine;
    }
  }

  if (p >= 0.97) {
    for (let y = 0; y < rows; y++) {
      out[y] = padOrTrim(scene[y] ?? ' '.repeat(width), width);
    }
  }

  // silence unused cx for future column-aware morph
  void cx;
  return out;
}

/**
 * Former elliptical iris — retained for unit tests / callers that still need it.
 */
export function applyIrisReveal(options: {
  readonly backdrop: readonly string[];
  readonly reveal: readonly string[];
  readonly width: number;
  readonly rows: number;
  readonly progress: number;
  readonly paintRing: (text: string) => string;
}): string[] {
  const { backdrop, reveal, width, rows, progress, paintRing } = options;
  const p = clamp01(progress);
  const out: string[] = Array.from({ length: rows }, (_, y) =>
    padOrTrim(backdrop[y] ?? ' '.repeat(width), width),
  );
  if (p <= 0 || rows <= 0 || width <= 0) return out;

  const cx = (width - 1) / 2;
  const cy = (rows - 1) / 2;
  const rx = Math.max(0.6, p * (width * 0.62));
  const ry = Math.max(0.6, p * (rows * 0.72));

  for (let y = 0; y < rows; y++) {
    const ny = (y - cy) / ry;
    if (ny * ny > 1) continue;
    const rowHalf = rx * Math.sqrt(Math.max(0, 1 - ny * ny));
    const edgeBand = Math.max(0.7, rx * 0.08);
    if (rowHalf < 0.45) continue;

    const revealLine = padOrTrim(reveal[y] ?? ' '.repeat(width), width);
    if (rowHalf < edgeBand + 1.2 && p < 0.97) {
      const spark = y % 2 === 0 ? '˚ · ✦ · ˚' : '· ⋆ · ⋆ ·';
      const pad = Math.max(0, Math.floor(cx - Math.ceil(spark.length / 2)));
      out[y] = padOrTrim(`${' '.repeat(pad)}${paintRing(spark)}`, width);
      continue;
    }
    out[y] = revealLine;
  }

  if (p >= 0.98) {
    for (let y = 0; y < rows; y++) {
      out[y] = padOrTrim(reveal[y] ?? ' '.repeat(width), width);
    }
  }
  return out;
}
