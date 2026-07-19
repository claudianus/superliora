/**
 * Splash → TUI iris handoff helpers.
 * Expands an elliptical reveal of the upcoming Welcome + Jewel Tank frame.
 */

import { padOrTrim } from '#/tui/utils/night-sky';

/** Default length of the splash→TUI iris reveal. */
export const SPLASH_IRIS_MS = 1000;

/** Ease iris opening (smoothstep). */
export function resolveIrisProgress(elapsedMs: number, cinematicMs: number, irisMs: number): number {
  if (irisMs <= 0) return 1;
  const local = Math.min(1, Math.max(0, (elapsedMs - cinematicMs) / irisMs));
  return local * local * (3 - 2 * local);
}

/**
 * Composite `reveal` inside an expanding ellipse over `backdrop`.
 * Whole rows flip when the ellipse covers the row center — ANSI-safe.
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
  const p = Math.max(0, Math.min(1, progress));
  const out: string[] = Array.from({ length: rows }, (_, y) =>
    padOrTrim(backdrop[y] ?? ' '.repeat(width), width),
  );
  if (p <= 0 || rows <= 0 || width <= 0) return out;

  const cx = (width - 1) / 2;
  const cy = (rows - 1) / 2;
  // Aspect: terminal cells are ~taller than wide — stretch X so the iris reads round.
  const rx = Math.max(0.6, p * (width * 0.62));
  const ry = Math.max(0.6, p * (rows * 0.72));

  for (let y = 0; y < rows; y++) {
    const ny = (y - cy) / ry;
    if (ny * ny > 1) continue;
    const rowHalf = rx * Math.sqrt(Math.max(0, 1 - ny * ny));
    const edgeBand = Math.max(0.7, rx * 0.08);
    const inside = rowHalf >= 0.45;
    if (!inside) continue;

    const revealLine = padOrTrim(reveal[y] ?? ' '.repeat(width), width);
    // Near the rim, paint a brand flare row instead of an abrupt cut.
    if (rowHalf < edgeBand + 1.2 && p < 0.97) {
      const spark = y % 2 === 0 ? '˚ · ✦ · ˚' : '· ⋆ · ⋆ ·';
      const pad = Math.max(0, Math.floor(cx - visibleHalf(spark)));
      out[y] = padOrTrim(`${' '.repeat(pad)}${paintRing(spark)}`, width);
      continue;
    }
    out[y] = revealLine;
  }

  // Full-open: guarantee the reveal frame wins.
  if (p >= 0.98) {
    for (let y = 0; y < rows; y++) {
      out[y] = padOrTrim(reveal[y] ?? ' '.repeat(width), width);
    }
  }
  return out;
}

function visibleHalf(text: string): number {
  return Math.ceil(text.length / 2);
}
