/**
 * Night-sky backdrop for centered-stage letterbox gutters.
 * Twinkling starfield + full-height side-gutter shooting stars.
 */

import type { AppearancePreferences } from '#/tui/config';
import { mixHexColor, type RendererCell, type RendererFrameRegion } from '#/tui/renderer';
import { currentTheme } from '#/tui/theme';
import {
  motionEffectsAllowed,
  resolveQualityAdjustedAmbientEffectMode,
} from '#/tui/utils/appearance-effects';
import { hash2, STAR_GLYPHS } from '#/tui/utils/night-sky';
import type { StageFrameBand } from '#/tui/utils/stage-frame';

/** Distinct from {@link STAR_GLYPHS} so freeze tests can tell showers apart. */
const SHOOTING_HEAD = '◆';
const SHOOTING_MID = '‒';
const SHOOTING_TAIL = '·';

export interface StageLetterboxSkyCell {
  readonly x: number;
  readonly y: number;
  readonly char: string;
  readonly fg: string;
  readonly bold?: boolean;
}

export interface LetterboxSideGutter {
  /** Inclusive left column. */
  readonly x0: number;
  /** Exclusive right column. */
  readonly x1: number;
}

function bandContains(band: StageFrameBand, x: number, y: number): boolean {
  return (
    x >= band.x &&
    x < band.x + band.width &&
    y >= band.y &&
    y < band.y + band.height
  );
}

export function pointInLetterboxBands(
  bands: readonly StageFrameBand[],
  x: number,
  y: number,
): boolean {
  for (const band of bands) {
    if (bandContains(band, x, y)) return true;
  }
  return false;
}

export function letterboxArea(bands: readonly StageFrameBand[]): number {
  return bands.reduce((sum, b) => sum + b.width * b.height, 0);
}

/**
 * Full-height corridors beside the stage: columns that stay letterbox for every row.
 * Top/bottom-only letterbox (no side gutters) yields an empty list.
 */
export function resolveLetterboxSideGutters(
  bands: readonly StageFrameBand[],
  cols: number,
): readonly LetterboxSideGutter[] {
  if (cols <= 0 || bands.length === 0) return [];
  const gutters: LetterboxSideGutter[] = [];
  for (const band of bands) {
    if (band.x === 0 && band.width > 0 && band.width < cols) {
      gutters.push({ x0: 0, x1: band.width });
      break;
    }
  }
  for (const band of bands) {
    const right = band.x + band.width;
    if (band.x > 0 && right === cols && band.width > 0) {
      gutters.push({ x0: band.x, x1: cols });
      break;
    }
  }
  return gutters;
}

function positiveModulo(n: number, m: number): number {
  if (m <= 0) return 0;
  return ((n % m) + m) % m;
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, n));
}

/**
 * Paint stars + shooting stars into absolute terminal coordinates.
 * Only cells inside letterbox bands are returned.
 */
export function paintStageLetterboxSky(input: {
  readonly bands: readonly StageFrameBand[];
  readonly cols: number;
  readonly rows: number;
  readonly nowMs: number;
  readonly appearance: AppearancePreferences;
  readonly freeze?: boolean;
}): readonly StageLetterboxSkyCell[] {
  const { bands, cols, rows, nowMs, appearance } = input;
  if (bands.length === 0 || cols <= 0 || rows <= 0) return [];
  if (!motionEffectsAllowed()) return [];
  const mode = resolveQualityAdjustedAmbientEffectMode(appearance);
  if (mode === 'off') return [];

  const premium = mode === 'premium';
  const freeze = input.freeze === true;
  const area = letterboxArea(bands);
  if (area < 24) return [];

  const cells = new Map<string, StageLetterboxSkyCell>();
  const put = (x: number, y: number, char: string, fg: string, bold?: boolean) => {
    if (!pointInLetterboxBands(bands, x, y)) return;
    if (x < 0 || y < 0 || x >= cols || y >= rows) return;
    const key = `${x},${y}`;
    const prev = cells.get(key);
    // Prefer brighter / bold overlays (shooting stars over dust).
    if (prev !== undefined && prev.bold === true && bold !== true) return;
    cells.set(key, { x, y, char, fg, ...(bold ? { bold: true } : {}) });
  };

  const particle = currentTheme.color('particle');
  const glow = currentTheme.color('glow');
  const muted = currentTheme.color('textMuted');
  const primary = currentTheme.color('primary');

  // --- Twinkling starfield ---
  const density = premium ? 0.11 : 0.07;
  const starCount = Math.max(12, Math.min(120, Math.floor(area * density * 0.09)));
  const twinkleClock = freeze ? Math.floor(nowMs / 4000) * 4000 : nowMs;
  for (let i = 0; i < starCount; i++) {
    // Stable base position from band-weighted hash; pick a letterbox cell.
    const seed = hash2(i * 17 + 3, 91);
    const band = bands[seed % bands.length]!;
    const x = band.x + (hash2(i * 31, 7) % Math.max(1, band.width));
    const y = band.y + (hash2(i * 47, 11) % Math.max(1, band.height));
    const twinkle = (Math.sin(twinkleClock / 220 + i * 0.73) + 1) / 2;
    // ≥4 brightness steps via mix — never a hard blink.
    if (twinkle < 0.18) continue;
    const glyph = STAR_GLYPHS[hash2(i, 4) % STAR_GLYPHS.length] ?? '·';
    const fg =
      twinkle > 0.82
        ? mixHexColor(glow, primary, 0.35)
        : twinkle > 0.55
          ? mixHexColor(particle, glow, 0.4)
          : twinkle > 0.35
            ? particle
            : muted;
    put(x, y, glyph, fg, twinkle > 0.88 && premium);
  }

  // --- Shooting stars: full-height fall in side gutters only ---
  const gutters = resolveLetterboxSideGutters(bands, cols);
  if (!freeze && gutters.length > 0) {
    const showerCount = premium ? 4 : 2;
    const tickMs = premium ? 42 : 72;
    const phase = nowMs / tickMs;
    for (let m = 0; m < showerCount; m++) {
      const h = hash2(m * 131 + 19, 503);
      const gutter = gutters[h % gutters.length]!;
      const gutterW = Math.max(1, gutter.x1 - gutter.x0);
      const speed = premium ? 0.9 + (m % 3) * 0.12 : 0.62 + (m % 2) * 0.1;
      const dy = speed;
      // Keep drift inside the corridor so the path never crosses the stage.
      const maxDrift = Math.max(0, gutterW - 1) * 0.35;
      const driftSign = (h & 2) === 0 ? -1 : 1;
      const dx = (maxDrift === 0 ? 0 : driftSign * Math.min(0.12, maxDrift / Math.max(1, rows))) * speed;
      const trailLen = premium ? 11 : 7;
      // Head must travel from above the top edge to past the bottom edge.
      const travel = rows + trailLen + 6;
      const activeFor = Math.ceil(travel / dy) + 2;
      const rest = premium ? 22 + (m % 4) * 8 : 34 + (m % 3) * 10;
      const period = activeFor + rest;
      const local = positiveModulo(phase + (h % period), period);
      if (local > activeFor) continue;

      const startX = gutter.x0 + (hash2(h, m + 3) % gutterW) + 0.5;
      const startY = -trailLen - (h % 3);
      const headX = clamp(startX + local * dx, gutter.x0, gutter.x1 - 1);
      const headY = startY + local * dy;
      const headFg = mixHexColor(glow, primary, 0.25);
      const midFg = mixHexColor(particle, glow, 0.35);
      const softFg = mixHexColor(particle, muted, 0.4);

      for (let step = 0; step <= trailLen; step++) {
        const x = Math.round(clamp(headX - step * dx * 0.85, gutter.x0, gutter.x1 - 1));
        const y = Math.round(headY - step * dy * 0.9);
        const t = step / Math.max(1, trailLen);
        if (step === 0) {
          put(x, y, SHOOTING_HEAD, headFg, true);
        } else if (t < 0.35) {
          put(x, y, SHOOTING_MID, midFg, premium && t < 0.2);
        } else if (t < 0.7) {
          put(x, y, SHOOTING_TAIL, softFg);
        } else {
          put(x, y, SHOOTING_TAIL, muted);
        }
      }
    }
  }

  return [...cells.values()];
}

/** Attach sky cell content onto letterbox band regions (absolute → local). */
export function applySkyToLetterboxRegions(
  bands: readonly StageFrameBand[],
  sky: readonly StageLetterboxSkyCell[],
  canvasBg: string | undefined,
): readonly RendererFrameRegion[] {
  const byBand = bands.map(() => new Map<string, StageLetterboxSkyCell>());
  for (const cell of sky) {
    for (let i = 0; i < bands.length; i++) {
      if (bandContains(bands[i]!, cell.x, cell.y)) {
        byBand[i]!.set(`${cell.x},${cell.y}`, cell);
        break;
      }
    }
  }

  return bands.map((band, i) => {
    const lines: RendererCell[][] = Array.from({ length: band.height }, () => []);
    for (const cell of byBand[i]!.values()) {
      const lx = cell.x - band.x;
      const ly = cell.y - band.y;
      if (ly < 0 || ly >= band.height || lx < 0 || lx >= band.width) continue;
      lines[ly]![lx] = {
        char: cell.char,
        style: {
          fg: cell.fg,
          ...(canvasBg !== undefined ? { bg: canvasBg } : {}),
          ...(cell.bold ? { bold: true } : {}),
        },
      };
    }
    return {
      id: `stageFrameLetterbox:${i}`,
      rect: band,
      content: lines,
      clear: true,
      ...(canvasBg !== undefined
        ? { background: { char: ' ' as const, style: { bg: canvasBg } } }
        : {}),
      zIndex: 4,
    };
  });
}
