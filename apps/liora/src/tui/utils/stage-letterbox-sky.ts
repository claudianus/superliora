/**
 * Night-sky backdrop for centered-stage letterbox gutters.
 * Twinkling starfield + soft-diagonal shooting stars that detonate on the stage rim.
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
/** Trail mid glyph for down-right (dx > 0) showers. */
const SHOOTING_MID_DOWN_RIGHT = '╲';
/** Trail mid glyph for down-left (dx < 0) showers. */
const SHOOTING_MID_DOWN_LEFT = '╱';
const SHOOTING_TAIL = '·';
const EXPLODE_CORE = ['✹', '✦', '*'] as const;
const EXPLODE_SPARK = ['✦', '˚', '+', '·', '*'] as const;

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
 *
 * Side-gutter showers fall on a soft diagonal aimed at the stage rim and burst
 * into sparks on impact (never paint into the stage content rect).
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
  // Quantize twinkle so brightness steps land every ~90ms — continuous nowMs
  // rewrote nearly every star cell every ambient tick (shared rows with the
  // stage content), which read as center-panel flicker in kitty.
  const twinkleStepMs = premium ? 90 : 140;
  const twinkleClock = freeze
    ? Math.floor(nowMs / 4000) * 4000
    : Math.floor(nowMs / twinkleStepMs) * twinkleStepMs;
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

  // --- Shooting stars: soft diagonal into the stage rim → explode ---
  const gutters = resolveLetterboxSideGutters(bands, cols);
  if (!freeze && gutters.length > 0) {
    const showerCount = premium ? 5 : 3;
    const tickMs = premium ? 42 : 72;
    const phase = nowMs / tickMs;
    const explodeTicks = premium ? 16 : 12;
    for (let m = 0; m < showerCount; m++) {
      const h = hash2(m * 131 + 19, 503);
      const gutter = gutters[h % gutters.length]!;
      const gutterW = Math.max(1, gutter.x1 - gutter.x0);
      const speed = premium ? 0.9 + (m % 3) * 0.12 : 0.62 + (m % 2) * 0.1;
      const dy = speed;
      // Aim inward: left gutter → stage (right), right gutter → stage (left).
      const towardStage = gutter.x0 === 0 ? 1 : -1;
      const softSpan = Math.max(0, gutterW - 1) * (premium ? 0.72 : 0.58);
      const trailLen = premium ? 11 : 7;
      const travel = rows + trailLen + 6;
      const dx = softSpan === 0 ? 0 : towardStage * ((softSpan * dy) / Math.max(1, travel * 0.72));
      const midGlyph = dx >= 0 ? SHOOTING_MID_DOWN_RIGHT : SHOOTING_MID_DOWN_LEFT;
      const fallTicks = Math.ceil(travel / dy) + 2;
      const rest = premium ? 18 + (m % 4) * 7 : 28 + (m % 3) * 9;
      const period = fallTicks + explodeTicks + rest;
      const local = positiveModulo(phase + (h % period), period);

      // Start away from the stage so the diagonal has runway.
      const startX =
        towardStage > 0
          ? gutter.x0 + 0.4 + (hash2(h, m + 3) % Math.max(1, Math.floor(gutterW * 0.35)))
          : gutter.x1 - 0.4 - (hash2(h, m + 3) % Math.max(1, Math.floor(gutterW * 0.35)));
      const startY = -trailLen - (h % 3);
      const impactX = towardStage > 0 ? gutter.x1 - 0.6 : gutter.x0 + 0.6;
      const impactLocal =
        Math.abs(dx) < 1e-6 ? fallTicks + 1 : Math.max(1, (impactX - startX) / dx);
      const burstStart = Math.min(impactLocal, fallTicks);
      const burstEnd = burstStart + explodeTicks;

      const headFg = mixHexColor(glow, primary, 0.25);
      const midFg = mixHexColor(particle, glow, 0.35);
      const softFg = mixHexColor(particle, muted, 0.4);

      if (local <= burstStart) {
        const headX = clamp(startX + local * dx, gutter.x0, gutter.x1 - 1);
        const headY = startY + local * dy;
        for (let step = 0; step <= trailLen; step++) {
          const x = Math.round(clamp(headX - step * dx * 0.95, gutter.x0, gutter.x1 - 1));
          const y = Math.round(headY - step * dy * 0.9);
          const t = step / Math.max(1, trailLen);
          if (step === 0) {
            put(x, y, SHOOTING_HEAD, headFg, true);
          } else if (t < 0.35) {
            put(x, y, midGlyph, midFg, premium && t < 0.2);
          } else if (t < 0.7) {
            put(x, y, SHOOTING_TAIL, softFg);
          } else {
            put(x, y, SHOOTING_TAIL, muted);
          }
        }
        continue;
      }

      if (local > burstEnd) continue;

      // Detonation on the stage-facing gutter rim.
      const age = local - burstStart;
      const ix = Math.round(clamp(impactX, gutter.x0, gutter.x1 - 1));
      const iy = Math.round(clamp(startY + burstStart * dy, 0, rows - 1));
      paintRimExplosion({
        put,
        ix,
        iy,
        age,
        life: explodeTicks,
        seed: h + m * 17,
        towardStage,
        premium,
        glow,
        primary,
        particle,
        muted,
      });
    }
  }

  return [...cells.values()];
}

function paintRimExplosion(input: {
  readonly put: (x: number, y: number, char: string, fg: string, bold?: boolean) => void;
  readonly ix: number;
  readonly iy: number;
  readonly age: number;
  readonly life: number;
  readonly seed: number;
  readonly towardStage: number;
  readonly premium: boolean;
  readonly glow: string;
  readonly primary: string;
  readonly particle: string;
  readonly muted: string;
}): void {
  const { put, ix, iy, age, life, seed, towardStage, premium, glow, primary, particle, muted } =
    input;
  if (age < 0 || age > life) return;
  const t = age / life;
  const coreFg = mixHexColor(glow, primary, 0.4);
  if (t < 0.4) {
    const glyph = EXPLODE_CORE[Math.min(EXPLODE_CORE.length - 1, Math.floor(t * 8))] ?? '✦';
    put(ix, iy, glyph, coreFg, true);
  }
  const sparks = premium ? 12 : 7;
  for (let i = 0; i < sparks; i++) {
    const base = ((seed + i * 47) % 360) * (Math.PI / 180);
    // Bias spray away from the stage so sparks stay in letterbox.
    const away = towardStage > 0 ? Math.PI : 0;
    const ang = base * 0.55 + away + ((i % 3) - 1) * 0.35;
    const dist = (0.6 + (i % 4) * 0.45) * (0.35 + t * 2.4);
    const x = Math.round(ix + Math.cos(ang) * dist);
    const y = Math.round(iy + Math.sin(ang) * dist * 0.55);
    const glyph = EXPLODE_SPARK[(seed + i) % EXPLODE_SPARK.length] ?? '·';
    const fg =
      t < 0.25
        ? mixHexColor(glow, primary, 0.35)
        : t < 0.55
          ? mixHexColor(particle, glow, 0.45)
          : muted;
    put(x, y, glyph, fg, t < 0.3 && premium);
  }
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
