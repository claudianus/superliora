/**
 * Night-sky backdrop for centered-stage letterbox gutters.
 * Twinkling starfield on top/bottom letterbox only (never side gutters).
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

/**
 * Top/bottom letterbox strips (full terminal width). Side gutters share stage
 * rows — particle churn there flickered the center panel in kitty — so sky
 * paint stays on these caps only. Side bands still get solid canvas fill via
 * {@link applySkyToLetterboxRegions}.
 */
export function resolveLetterboxCapBands(
  bands: readonly StageFrameBand[],
  cols: number,
): readonly StageFrameBand[] {
  if (cols <= 0) return [];
  return bands.filter((band) => band.x === 0 && band.width === cols && band.height > 0);
}

/**
 * Paint stars into absolute terminal coordinates (top/bottom letterbox only).
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
  // Caps only — never scatter into side gutters (shared Y with stage content).
  const skyBands = resolveLetterboxCapBands(bands, cols);
  const area = letterboxArea(skyBands);
  if (skyBands.length === 0 || area < 24) return [];

  const cells = new Map<string, StageLetterboxSkyCell>();
  const put = (x: number, y: number, char: string, fg: string, bold?: boolean) => {
    if (!pointInLetterboxBands(skyBands, x, y)) return;
    if (x < 0 || y < 0 || x >= cols || y >= rows) return;
    const key = `${x},${y}`;
    const prev = cells.get(key);
    if (prev !== undefined && prev.bold === true && bold !== true) return;
    cells.set(key, { x, y, char, fg, ...(bold ? { bold: true } : {}) });
  };

  const particle = currentTheme.color('particle');
  const glow = currentTheme.color('glow');
  const muted = currentTheme.color('textMuted');
  const primary = currentTheme.color('primary');

  // --- Twinkling starfield (caps only) ---
  const density = premium ? 0.11 : 0.07;
  const starCount = Math.max(12, Math.min(120, Math.floor(area * density * 0.09)));
  // Quantize twinkle so brightness steps land every ~90ms — continuous nowMs
  // rewrote nearly every star cell every ambient tick.
  const twinkleStepMs = premium ? 90 : 140;
  const twinkleClock = freeze
    ? Math.floor(nowMs / 4000) * 4000
    : Math.floor(nowMs / twinkleStepMs) * twinkleStepMs;
  for (let i = 0; i < starCount; i++) {
    const seed = hash2(i * 17 + 3, 91);
    const band = skyBands[seed % skyBands.length]!;
    const x = band.x + (hash2(i * 31, 7) % Math.max(1, band.width));
    const y = band.y + (hash2(i * 47, 11) % Math.max(1, band.height));
    const twinkle = (Math.sin(twinkleClock / 220 + i * 0.73) + 1) / 2;
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

  const emptyCell: RendererCell =
    canvasBg === undefined
      ? { char: ' ' }
      : { char: ' ', style: { bg: canvasBg } };

  return bands.map((band, i) => {
    // Dense fill (bg spaces + stars) so we never need region clear:true.
    // Ambient clear:true was wiping full-width letterbox bands every tick and
    // read as black horizontal flicker around the stage.
    const lines: RendererCell[][] = Array.from({ length: band.height }, () =>
      Array.from({ length: band.width }, () => emptyCell),
    );
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
      clear: false,
      ...(canvasBg !== undefined
        ? { background: { char: ' ' as const, style: { bg: canvasBg } } }
        : {}),
      zIndex: 4,
    };
  });
}
