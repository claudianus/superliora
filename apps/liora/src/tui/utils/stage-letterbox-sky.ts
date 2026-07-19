/**
 * Night-sky backdrop for centered-stage letterbox gutters.
 * Twinkling starfield + chaotic S/M/L meteors inbound from edges/corners that
 * detonate into size-scaled asteroid bursts on the stage rim.
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

/** Deterministic 0..1 from hash pair. */
function hash01(a: number, b: number): number {
  return (hash2(a, b) % 10_000) / 10_000;
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

function pickSize(premium: boolean, h: number, m: number): MeteorSize {
  const roll = hash2(h, m + 41) % 100;
  // Chaotic skew: more rare heavies, but when they land they read huge.
  if (premium) {
    if (roll < 16) return 'l';
    if (roll < 52) return 'm';
    return 's';
  }
  if (roll < 8) return 'l';
  if (roll < 42) return 'm';
  return 's';
}

/**
 * Non-overlapping class envelopes + within-class chaos.
 * Occasional L spikes push speed/burst past the normal L ceiling.
 */
export interface MeteorMotionParams {
  readonly size: MeteorSize;
  readonly speed: number;
  readonly trailLen: number;
  readonly explodeTicks: number;
  readonly burstScale: number;
  readonly debrisCount: number;
  /** Perpendicular angle jitter (radians) applied to inbound heading. */
  readonly headingJitter: number;
}

export function resolveMeteorMotionParams(
  size: MeteorSize,
  premium: boolean,
  h: number,
  m: number,
): MeteorMotionParams {
  const u = (salt: number) => hash01(h + salt, m * 17 + salt);
  const spike = size === 'l' && u(3) < (premium ? 0.22 : 0.12);
  // Disjoint speed bands: S≪M≪L (+ optional L spike).
  const speed = (() => {
    if (size === 's') return lerp(0.42, 0.72, u(11)) * (premium ? 1 : 0.9);
    if (size === 'm') return lerp(0.95, 1.35, u(11)) * (premium ? 1 : 0.92);
    const base = lerp(1.55, 2.05, u(11));
    return (spike ? base * lerp(1.25, 1.55, u(12)) : base) * (premium ? 1 : 0.94);
  })();
  const trailLen = (() => {
    if (size === 's') return Math.round(lerp(4, 7, u(21)));
    if (size === 'm') return Math.round(lerp(10, 14, u(21)));
    return Math.round(lerp(16, spike ? 24 : 20, u(21)));
  })();
  const explodeTicks = (() => {
    if (size === 's') return Math.round(lerp(10, 14, u(31)));
    if (size === 'm') return Math.round(lerp(20, 26, u(31)));
    return Math.round(lerp(32, spike ? 48 : 40, u(31)));
  })();
  const burstScale = (() => {
    if (size === 's') return lerp(0.5, 0.8, u(41));
    if (size === 'm') return lerp(1.15, 1.55, u(41));
    return spike ? lerp(2.6, 3.4, u(41)) : lerp(1.95, 2.5, u(41));
  })();
  const debrisCount = (() => {
    const mul = premium ? 1 : 0.72;
    if (size === 's') return Math.floor(lerp(6, 11, u(51)) * mul);
    if (size === 'm') return Math.floor(lerp(20, 30, u(51)) * mul);
    return Math.floor(lerp(40, spike ? 64 : 54, u(51)) * mul);
  })();
  // Wide heading chaos — up to ~±50° (S/M) / ±65° (L).
  const jitterAmp = size === 'l' ? 1.15 : size === 'm' ? 0.95 : 0.75;
  const headingJitter = (u(61) - 0.5) * 2 * jitterAmp;
  return { size, speed, trailLen, explodeTicks, burstScale, debrisCount, headingJitter };
}

const SECTORS: readonly SpawnSector[] = ['n', 'e', 's', 'w', 'nw', 'ne', 'sw', 'se'];

function rimPoint(
  hole: StageHole,
  side: 0 | 1 | 2 | 3,
  t: number,
): { x: number; y: number } {
  const tx = clamp(t, 0, 1);
  const xSpan = Math.max(0, hole.x1 - hole.x0 - 1);
  const ySpan = Math.max(0, hole.y1 - hole.y0 - 1);
  switch (side) {
    case 0:
      return { x: hole.x0 + tx * xSpan, y: hole.y0 - 0.4 };
    case 1:
      return { x: hole.x1 - 0.6, y: hole.y0 + tx * ySpan };
    case 2:
      return { x: hole.x0 + tx * xSpan, y: hole.y1 - 0.6 };
    case 3:
      return { x: hole.x0 - 0.4, y: hole.y0 + tx * ySpan };
  }
}

function spawnOnEdge(
  sector: SpawnSector,
  cols: number,
  rows: number,
  hole: StageHole,
  h: number,
  m: number,
): { x: number; y: number } {
  const t = hash01(h, m + 7);
  const depth = 1 + (hash2(h, m + 9) % 4);
  switch (sector) {
    case 'n':
      return { x: t * (cols - 1), y: -depth };
    case 's':
      return { x: t * (cols - 1), y: rows - 1 + depth };
    case 'w':
      return {
        x: -depth,
        y: lerp(hole.y0 - 4, hole.y1 + 4, hash01(h, m + 13)),
      };
    case 'e':
      return {
        x: cols - 1 + depth,
        y: lerp(hole.y0 - 4, hole.y1 + 4, hash01(h, m + 13)),
      };
    case 'nw':
      return { x: -depth - t * 3, y: -depth - (1 - t) * 3 };
    case 'ne':
      return { x: cols + depth + t * 3, y: -depth - (1 - t) * 3 };
    case 'sw':
      return { x: -depth - t * 3, y: rows + depth + (1 - t) * 3 };
    case 'se':
      return { x: cols + depth + t * 3, y: rows + depth + (1 - t) * 3 };
  }
}

/**
 * Chaotic inbound path: spawn from a sector fringe, aim at a *random* rim side
 * (not just the facing edge) so trajectories cross and diverge.
 */
function spawnAndTarget(
  sector: SpawnSector,
  hole: StageHole,
  cols: number,
  rows: number,
  h: number,
  m: number,
): { startX: number; startY: number; impactX: number; impactY: number } {
  // 30%: ignore preferred sector — pure random edge spawn.
  const spawnSector =
    hash01(h, m + 3) < 0.3 ? SECTORS[hash2(h, m + 5) % SECTORS.length]! : sector;
  const start = spawnOnEdge(spawnSector, cols, rows, hole, h, m);

  // Prefer facing rim ~45%, else any of the four sides (cross-shots).
  const facing: 0 | 1 | 2 | 3 =
    spawnSector === 'n' || spawnSector === 'nw' || spawnSector === 'ne'
      ? 0
      : spawnSector === 'e'
        ? 1
        : spawnSector === 's' || spawnSector === 'sw' || spawnSector === 'se'
          ? 2
          : 3;
  const side = (hash01(h, m + 19) < 0.45
    ? facing
    : (hash2(h, m + 23) % 4)) as 0 | 1 | 2 | 3;
  const impact = rimPoint(hole, side, hash01(h, m + 29));
  return {
    startX: start.x,
    startY: start.y,
    impactX: impact.x,
    impactY: impact.y,
  };
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
      const motion = resolveMeteorMotionParams(size, premium, h, m);
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
      const baseAng = Math.atan2(impactY - startY, impactX - startX);
      const ang = baseAng + motion.headingJitter;
      const dx = Math.cos(ang) * motion.speed;
      const dy = Math.sin(ang) * motion.speed;
      // Jittered heading keeps roughly the same travel budget as the aim distance.
      const fallDist = clamp(dist / Math.max(0.55, Math.cos(motion.headingJitter)), dist * 0.7, dist * 1.4);
      const trailLen = motion.trailLen;
      const fallTicks = Math.ceil(fallDist / motion.speed) + 1;
      const explodeTicks = motion.explodeTicks;
      const rest = premium
        ? 10 + Math.floor(hash01(h, m + 71) * 22)
        : 18 + Math.floor(hash01(h, m + 71) * 28);
      const period = fallTicks + explodeTicks + rest;
      const local = positiveModulo(phase + (h % period), period);
      const burstStart = fallTicks;
      const burstEnd = burstStart + explodeTicks;

      const headFg = mixHexColor(
        glow,
        primary,
        size === 'l' ? 0.5 : size === 'm' ? 0.32 : 0.18,
      );
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
      const rawX = startX + burstStart * dx;
      const rawY = startY + burstStart * dy;
      const snap = snapImpactToLetterbox(
        Math.round(clamp(rawX, 0, cols - 1)),
        Math.round(clamp(rawY, 0, rows - 1)),
        hole,
        cols,
        rows,
      );
      paintRimMegaBurst({
        put,
        ix: snap.x,
        iy: snap.y,
        age,
        life: explodeTicks,
        seed: h + m * 17,
        size,
        burstScale: motion.burstScale,
        debrisCount: motion.debrisCount,
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
  readonly burstScale: number;
  readonly debrisCount: number;
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
    burstScale,
    debrisCount,
    hole,
    premium,
    glow,
    primary,
    particle,
    muted,
  } = input;
  if (age < 0 || age > life) return;
  const t = age / life;
  const scale = burstScale;
  const coreFg = mixHexColor(glow, primary, 0.55);

  // 1) Flash core — L fills a bigger cross; S is a single hot cell.
  if (t < 0.18) {
    const glyph = FLASH_CORE[Math.min(FLASH_CORE.length - 1, Math.floor(t * 20))] ?? '✹';
    put(ix, iy, glyph, coreFg, true);
    if (size !== 's') {
      const arm = size === 'l' ? 2 : 1;
      for (let a = 1; a <= arm; a++) {
        put(ix + a, iy, '✦', coreFg, true);
        put(ix - a, iy, '✦', coreFg, true);
        put(ix, iy + a, '✧', mixHexColor(glow, primary, 0.35), true);
        put(ix, iy - a, '✧', mixHexColor(glow, primary, 0.35), true);
      }
    }
  }

  // 2) Expanding shock ring
  if (t < 0.6) {
    const r = (0.8 + t * 5.5) * scale;
    const ringSteps = Math.max(8, Math.floor(12 * scale + 4));
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
  for (let i = 0; i < debrisCount; i++) {
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
    const dust = Math.max(3, Math.floor(4 * scale));
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
