/**
 * Night-sky backdrop for centered-stage letterbox gutters.
 * Twinkling starfield + S/M/L meteors inbound from all edges/corners that
 * detonate into asteroid-scale bursts on the stage rim.
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
const HEAD_S = '◆';
const HEAD_M = '◈';
const HEAD_L = '⬤';
const SHOOTING_TAIL = '·';
const FLASH_CORE = ['✹', '◈', '⬤', '✦'] as const;
const RING_GLYPHS = ['░', '▒', '▓', '✦', '˚'] as const;
const DEBRIS_GLYPHS = ['✦', '*', '+', '˚', '·', '✧'] as const;

type MeteorSize = 's' | 'm' | 'l';
type SpawnSector = 'n' | 'e' | 's' | 'w' | 'nw' | 'ne' | 'sw' | 'se';

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

/** Stage outer hole (letterbox-exclusive). Half-open: [x0,x1) × [y0,y1). */
export interface StageHole {
  readonly x0: number;
  readonly y0: number;
  readonly x1: number;
  readonly y1: number;
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
 * Infer the stage outer rect (the hole in the letterbox) from full-edge bands.
 */
export function resolveStageHoleFromBands(
  bands: readonly StageFrameBand[],
  cols: number,
  rows: number,
): StageHole | undefined {
  if (cols <= 0 || rows <= 0 || bands.length === 0) return undefined;
  let y0 = 0;
  let y1 = rows;
  let x0 = 0;
  let x1 = cols;
  let sawTop = false;
  let sawBottom = false;
  let sawLeft = false;
  let sawRight = false;
  for (const band of bands) {
    if (band.y === 0 && band.x === 0 && band.width === cols && band.height > 0) {
      y0 = band.height;
      sawTop = true;
    }
    if (band.x === 0 && band.width === cols && band.y > 0 && band.y + band.height === rows) {
      y1 = band.y;
      sawBottom = true;
    }
    if (band.x === 0 && band.width > 0 && band.width < cols && band.y > 0) {
      x0 = band.width;
      sawLeft = true;
    }
    if (band.x > 0 && band.x + band.width === cols && band.width > 0 && band.y > 0) {
      x1 = band.x;
      sawRight = true;
    }
  }
  if (!(sawTop || sawBottom || sawLeft || sawRight)) return undefined;
  if (x1 <= x0 || y1 <= y0) return undefined;
  return { x0, y0, x1, y1 };
}

function positiveModulo(n: number, m: number): number {
  if (m <= 0) return 0;
  return ((n % m) + m) % m;
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, n));
}

function midGlyphForVelocity(dx: number, dy: number): string {
  const ax = Math.abs(dx);
  const ay = Math.abs(dy);
  if (ax < 0.08) return '│';
  if (ay < 0.08) return '─';
  return dx * dy >= 0 ? '╲' : '╱';
}

function headForSize(size: MeteorSize): string {
  if (size === 'l') return HEAD_L;
  if (size === 'm') return HEAD_M;
  return HEAD_S;
}

function pickSize(premium: boolean, h: number, m: number): MeteorSize {
  const roll = hash2(h, m + 41) % 100;
  if (premium) {
    if (roll < 12) return 'l';
    if (roll < 48) return 'm';
    return 's';
  }
  if (roll < 4) return 'l';
  if (roll < 38) return 'm';
  return 's';
}

const SECTORS: readonly SpawnSector[] = ['n', 'e', 's', 'w', 'nw', 'ne', 'sw', 'se'];

function spawnAndTarget(
  sector: SpawnSector,
  hole: StageHole,
  cols: number,
  rows: number,
  h: number,
  m: number,
): { startX: number; startY: number; impactX: number; impactY: number } {
  const jx = hash2(h, m + 7) % 1000;
  const jy = hash2(h, m + 11) % 1000;
  const rimX = (t: number) => hole.x0 + t * Math.max(0, hole.x1 - hole.x0 - 1);
  const rimY = (t: number) => hole.y0 + t * Math.max(0, hole.y1 - hole.y0 - 1);
  const fringe = (span: number) => (span <= 1 ? 0 : (jx % span));

  switch (sector) {
    case 'n':
      return {
        startX: fringe(cols),
        startY: -2 - (h % 3),
        impactX: rimX(jx / 1000),
        impactY: hole.y0 - 0.4,
      };
    case 's':
      return {
        startX: fringe(cols),
        startY: rows + 2 + (h % 3),
        impactX: rimX(jx / 1000),
        impactY: hole.y1 - 0.6,
      };
    case 'w':
      return {
        startX: -2 - (h % 3),
        startY: clamp(hole.y0 + fringe(Math.max(1, hole.y1 - hole.y0)), 0, rows - 1),
        impactX: hole.x0 - 0.4,
        impactY: rimY(jy / 1000),
      };
    case 'e':
      return {
        startX: cols + 2 + (h % 3),
        startY: clamp(hole.y0 + fringe(Math.max(1, hole.y1 - hole.y0)), 0, rows - 1),
        impactX: hole.x1 - 0.6,
        impactY: rimY(jy / 1000),
      };
    case 'nw':
      return {
        startX: -1,
        startY: -1,
        impactX: hole.x0 - 0.4,
        impactY: hole.y0 - 0.4,
      };
    case 'ne':
      return {
        startX: cols,
        startY: -1,
        impactX: hole.x1 - 0.6,
        impactY: hole.y0 - 0.4,
      };
    case 'sw':
      return {
        startX: -1,
        startY: rows,
        impactX: hole.x0 - 0.4,
        impactY: hole.y1 - 0.6,
      };
    case 'se':
      return {
        startX: cols,
        startY: rows,
        impactX: hole.x1 - 0.6,
        impactY: hole.y1 - 0.6,
      };
  }
}

/**
 * Paint stars + shooting stars into absolute terminal coordinates.
 * Only cells inside letterbox bands are returned.
 *
 * Meteors inbound from edges/corners hit the stage outer rim and burst
 * (never paint into the stage content rect).
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
    // Prefer brighter / bold overlays (meteors over dust).
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
    const seed = hash2(i * 17 + 3, 91);
    const band = bands[seed % bands.length]!;
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

  // --- Inbound meteors → asteroid rim bursts ---
  const hole = resolveStageHoleFromBands(bands, cols, rows);
  if (!freeze && hole !== undefined) {
    const showerCount = premium ? 8 : 5;
    const tickMs = premium ? 40 : 68;
    const phase = nowMs / tickMs;
    for (let m = 0; m < showerCount; m++) {
      const h = hash2(m * 131 + 19, 503);
      const sector = SECTORS[(h + m * 3) % SECTORS.length]!;
      const size = pickSize(premium, h, m);
      const { startX, startY, impactX, impactY } = spawnAndTarget(
        sector,
        hole,
        cols,
        rows,
        h,
        m,
      );
      const dist = Math.hypot(impactX - startX, impactY - startY);
      if (dist < 2) continue;
      const baseSpeed = size === 'l' ? 1.15 : size === 'm' ? 0.95 : 0.78;
      const speed = baseSpeed * (premium ? 1 : 0.85) * (0.9 + (m % 3) * 0.08);
      const ux = (impactX - startX) / dist;
      const uy = (impactY - startY) / dist;
      const dx = ux * speed;
      const dy = uy * speed;
      const trailLen = size === 'l' ? 14 : size === 'm' ? 10 : 7;
      const fallTicks = Math.ceil(dist / speed) + 1;
      const explodeTicks = size === 'l' ? 28 : size === 'm' ? 22 : 16;
      const rest = premium ? 14 + (m % 5) * 5 : 24 + (m % 4) * 8;
      const period = fallTicks + explodeTicks + rest;
      const local = positiveModulo(phase + (h % period), period);
      const burstStart = fallTicks;
      const burstEnd = burstStart + explodeTicks;

      const headFg = mixHexColor(glow, primary, size === 'l' ? 0.45 : 0.25);
      const midFg = mixHexColor(particle, glow, 0.4);
      const softFg = mixHexColor(particle, muted, 0.4);
      const midGlyph = midGlyphForVelocity(dx, dy);
      const head = headForSize(size);

      if (local <= burstStart) {
        const headX = startX + local * dx;
        const headY = startY + local * dy;
        for (let step = 0; step <= trailLen; step++) {
          const x = Math.round(headX - step * dx * 0.95);
          const y = Math.round(headY - step * dy * 0.9);
          const t = step / Math.max(1, trailLen);
          if (step === 0) {
            put(x, y, head, headFg, true);
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

      const age = local - burstStart;
      const ix = Math.round(clamp(impactX, 0, cols - 1));
      const iy = Math.round(clamp(impactY, 0, rows - 1));
      // Snap impact onto letterbox: prefer nearest cell just outside the hole.
      const snap = snapImpactToLetterbox(ix, iy, hole, cols, rows);
      paintRimMegaBurst({
        put,
        ix: snap.x,
        iy: snap.y,
        age,
        life: explodeTicks,
        seed: h + m * 17,
        size,
        hole,
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

function snapImpactToLetterbox(
  ix: number,
  iy: number,
  hole: StageHole,
  cols: number,
  rows: number,
): { x: number; y: number } {
  let x = clamp(ix, 0, cols - 1);
  let y = clamp(iy, 0, rows - 1);
  if (x >= hole.x0 && x < hole.x1 && y >= hole.y0 && y < hole.y1) {
    const dl = x - hole.x0 + 1;
    const dr = hole.x1 - x;
    const dt = y - hole.y0 + 1;
    const db = hole.y1 - y;
    const min = Math.min(dl, dr, dt, db);
    if (min === dl) x = hole.x0 - 1;
    else if (min === dr) x = hole.x1;
    else if (min === dt) y = hole.y0 - 1;
    else y = hole.y1;
  }
  return { x: clamp(x, 0, cols - 1), y: clamp(y, 0, rows - 1) };
}

function paintRimMegaBurst(input: {
  readonly put: (x: number, y: number, char: string, fg: string, bold?: boolean) => void;
  readonly ix: number;
  readonly iy: number;
  readonly age: number;
  readonly life: number;
  readonly seed: number;
  readonly size: MeteorSize;
  readonly hole: StageHole;
  readonly premium: boolean;
  readonly glow: string;
  readonly primary: string;
  readonly particle: string;
  readonly muted: string;
}): void {
  const {
    put,
    ix,
    iy,
    age,
    life,
    seed,
    size,
    hole,
    premium,
    glow,
    primary,
    particle,
    muted,
  } = input;
  if (age < 0 || age > life) return;
  const t = age / life;
  const scale = size === 'l' ? 1.55 : size === 'm' ? 1.2 : 0.9;
  const coreFg = mixHexColor(glow, primary, 0.55);

  // 1) Flash core
  if (t < 0.18) {
    const glyph = FLASH_CORE[Math.min(FLASH_CORE.length - 1, Math.floor(t * 20))] ?? '✹';
    put(ix, iy, glyph, coreFg, true);
    if (size !== 's') {
      put(ix + 1, iy, '✦', coreFg, true);
      put(ix - 1, iy, '✦', coreFg, true);
      put(ix, iy + 1, '✧', mixHexColor(glow, primary, 0.35), true);
      put(ix, iy - 1, '✧', mixHexColor(glow, primary, 0.35), true);
    }
  }

  // 2) Expanding shock ring
  if (t < 0.6) {
    const r = (0.8 + t * 5.5) * scale;
    const ringSteps = Math.max(10, Math.floor(16 * scale));
    for (let i = 0; i < ringSteps; i++) {
      const ang = (i / ringSteps) * Math.PI * 2 + seed * 0.01;
      const x = Math.round(ix + Math.cos(ang) * r);
      const y = Math.round(iy + Math.sin(ang) * r * 0.55);
      if (insideHole(x, y, hole)) continue;
      const glyph = RING_GLYPHS[(seed + i) % RING_GLYPHS.length] ?? '░';
      const fg =
        t < 0.25
          ? mixHexColor(glow, primary, 0.4)
          : t < 0.45
            ? mixHexColor(particle, glow, 0.5)
            : muted;
      put(x, y, glyph, fg, t < 0.3 && premium);
    }
  }

  // 3) Debris with light gravity (bias away from stage center)
  const cx = (hole.x0 + hole.x1) / 2;
  const cy = (hole.y0 + hole.y1) / 2;
  const awayAng = Math.atan2(iy - cy, ix - cx);
  const debris = Math.floor((size === 'l' ? 34 : size === 'm' ? 24 : 14) * (premium ? 1 : 0.75));
  for (let i = 0; i < debris; i++) {
    const base = ((seed + i * 47) % 360) * (Math.PI / 180);
    const ang = awayAng + (base - Math.PI) * 0.7 + ((i % 5) - 2) * 0.2;
    const launch = (0.5 + (i % 5) * 0.55) * scale;
    const dist = launch * (0.25 + t * 2.8);
    const grav = t * t * 1.6 * scale;
    const x = Math.round(ix + Math.cos(ang) * dist);
    const y = Math.round(iy + Math.sin(ang) * dist * 0.55 + grav);
    if (insideHole(x, y, hole)) continue;
    const glyph = DEBRIS_GLYPHS[(seed + i) % DEBRIS_GLYPHS.length] ?? '·';
    const fg =
      t < 0.2
        ? mixHexColor(glow, primary, 0.45)
        : t < 0.5
          ? mixHexColor(particle, glow, 0.4)
          : muted;
    put(x, y, glyph, fg, t < 0.25 && premium && size !== 's');
  }

  // 4) Afterglow dust near impact
  if (t > 0.45) {
    const fade = (t - 0.45) / 0.55;
    const dust = size === 'l' ? 10 : size === 'm' ? 7 : 4;
    for (let i = 0; i < dust; i++) {
      const ox = ((seed + i * 13) % 7) - 3;
      const oy = ((seed + i * 17) % 5) - 2;
      const x = ix + ox;
      const y = iy + oy;
      if (insideHole(x, y, hole)) continue;
      if (fade > 0.85 && i % 2 === 0) continue;
      put(x, y, '·', muted, false);
    }
  }
}

function insideHole(x: number, y: number, hole: StageHole): boolean {
  return x >= hole.x0 && x < hole.x1 && y >= hole.y0 && y < hole.y1;
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
