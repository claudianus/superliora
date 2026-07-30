/**
 * Night-sky backdrop for centered-stage letterbox gutters.
 * Twinkling starfield + chaotic S/M/L meteors inbound from edges/corners that
 * detonate into size-scaled asteroid bursts on the stage rim.
 */

import type { AppearancePreferences } from '#/tui/config';
import { mixHexColor } from '#/tui/renderer';
import { currentTheme } from '#/tui/theme';
import {
  motionEffectsAllowed,
  resolveQualityAdjustedAmbientEffectMode,
} from '#/tui/utils/appearance-effects';
import { hash2, STAR_GLYPHS } from '#/tui/utils/night-sky';
import type { StageFrameBand } from '#/tui/utils/stage-frame';
import {
  paintRimMegaBurst,
  snapImpactToLetterbox,
} from '#/tui/utils/stage-letterbox-sky-burst';
import {
  insideHole,
  letterboxArea,
  pointInLetterboxBands,
  resolveStageHoleFromBands,
  skyCellKey,
  type LetterboxSideGutter,
  type StageHole,
  type StageLetterboxSkyCell,
} from '#/tui/utils/stage-letterbox-sky-geometry';
import {
  APOCALYPSE_BURST_TICKS,
  APOCALYPSE_FLIGHT_TICKS,
  clearApocalypseState,
  facingRimSide,
  getApocalypseState,
  headForSize,
  latchApocalypsePhase,
  midGlyphForVelocity,
  meteorSectors,
  noteGoalCompletionMeteorBurst,
  noteMeteorEasterEggClick,
  pickSize,
  positiveModulo,
  resetMeteorEasterEggForTests,
  resolveDebrisShardParams,
  resolveMeteorMotionParams,
  rimPoint,
  spawnAndTarget,
  spawnOutsideScreen,
  HEAD_L,
  SHOOTING_TAIL,
  type DebrisShardParams,
  type MeteorMotionParams,
  type SpawnSector,
} from '#/tui/utils/stage-letterbox-sky-meteor';
import {
  applySkyToLetterboxRegions,
  resetLetterboxSkyRegionCacheForTests,
} from '#/tui/utils/stage-letterbox-sky-regions';

export type {
  DebrisShardParams,
  LetterboxSideGutter,
  MeteorMotionParams,
  SpawnSector,
  StageHole,
  StageLetterboxSkyCell,
};

export {
  letterboxArea,
  pointInLetterboxBands,
  resolveLetterboxSideGutters,
  resolveStageHoleFromBands,
} from '#/tui/utils/stage-letterbox-sky-geometry';

export {
  facingRimSide,
  noteGoalCompletionMeteorBurst,
  noteMeteorEasterEggClick,
  resetMeteorEasterEggForTests,
  resolveDebrisShardParams,
  resolveMeteorMotionParams,
  spawnAndTarget,
  spawnOutsideScreen,
} from '#/tui/utils/stage-letterbox-sky-meteor';

export {
  applySkyToLetterboxRegions,
  resetLetterboxSkyRegionCacheForTests,
} from '#/tui/utils/stage-letterbox-sky-regions';

/** Deterministic 0..1 from hash pair. */
function hash01(a: number, b: number): number {
  return (hash2(a, b) % 10_000) / 10_000;
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

  const cells = new Map<number, StageLetterboxSkyCell>();
  const put = (x: number, y: number, char: string, fg: string, bold?: boolean) => {
    if (!pointInLetterboxBands(bands, x, y)) return;
    if (x < 0 || y < 0 || x >= cols || y >= rows) return;
    const key = skyCellKey(x, y);
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
    const SECTORS = meteorSectors();
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
      // Exact aim — no heading twist (that cut through the stage hole).
      const ux = (impactX - startX) / dist;
      const uy = (impactY - startY) / dist;
      const dx = ux * motion.speed;
      const dy = uy * motion.speed;
      const trailLen = motion.trailLen;
      const fallTicks = Math.ceil(dist / motion.speed) + 1;
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
        // Never paint a head that has already crossed the hole (guard float error).
        if (insideHole(Math.round(headX), Math.round(headY), hole)) continue;
        for (let step = 0; step <= trailLen; step++) {
          const x = Math.round(headX - step * dx * 0.95);
          const y = Math.round(headY - step * dy * 0.9);
          if (insideHole(x, y, hole)) continue;
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
      const snap = snapImpactToLetterbox(
        Math.round(impactX),
        Math.round(impactY),
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

    paintApocalypseMeteor({
      put,
      hole,
      cols,
      rows,
      phase,
      premium,
      glow,
      primary,
      particle,
      muted,
    });
  }

  return [...cells.values()];
}

function paintApocalypseMeteor(input: {
  readonly put: (x: number, y: number, char: string, fg: string, bold?: boolean) => void;
  readonly hole: StageHole;
  readonly cols: number;
  readonly rows: number;
  readonly phase: number;
  readonly premium: boolean;
  readonly glow: string;
  readonly primary: string;
  readonly particle: string;
  readonly muted: string;
}): void {
  const apocalypse = getApocalypseState();
  if (apocalypse === undefined) return;
  const { put, hole, cols, rows, phase, premium, glow, primary, particle, muted } = input;
  // Latch phase on first paint so the strike starts now, not at epoch 0.
  latchApocalypsePhase(phase);
  const latched = getApocalypseState();
  if (latched === undefined || latched.startPhase === undefined) return;
  const local = phase - latched.startPhase;
  const life = APOCALYPSE_FLIGHT_TICKS + APOCALYPSE_BURST_TICKS;
  if (local < 0) return;
  if (local > life) {
    clearApocalypseState();
    return;
  }

  const seed = latched.seed;
  const { startX, startY, impactX, impactY } = spawnAndTarget(
    latched.sector,
    hole,
    cols,
    rows,
    seed,
    99,
  );
  const dist = Math.hypot(impactX - startX, impactY - startY);
  if (dist < 2) {
    clearApocalypseState();
    return;
  }
  const speed = dist / APOCALYPSE_FLIGHT_TICKS;
  const ux = (impactX - startX) / dist;
  const uy = (impactY - startY) / dist;
  const dx = ux * speed;
  const dy = uy * speed;
  const snap = snapImpactToLetterbox(
    Math.round(impactX),
    Math.round(impactY),
    hole,
    cols,
    rows,
  );

  if (local <= APOCALYPSE_FLIGHT_TICKS) {
    const headX = startX + local * dx;
    const headY = startY + local * dy;
    if (insideHole(Math.round(headX), Math.round(headY), hole)) return;
    const trailLen = 22;
    const headFg = mixHexColor(glow, primary, 0.65);
    const midFg = mixHexColor(particle, glow, 0.55);
    for (let step = 0; step <= trailLen; step++) {
      const x = Math.round(headX - step * dx * 0.95);
      const y = Math.round(headY - step * dy * 0.9);
      if (insideHole(x, y, hole)) continue;
      const t = step / trailLen;
      if (step === 0) put(x, y, HEAD_L, headFg, true);
      else if (t < 0.25) put(x, y, midGlyphForVelocity(dx, dy), midFg, true);
      else if (t < 0.55) put(x, y, '◈', midFg, premium);
      else put(x, y, SHOOTING_TAIL, muted);
    }
    // Soft bloom around the head so it reads as planet-class inbound.
    for (const [ox, oy] of [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
    ] as const) {
      const x = Math.round(headX) + ox;
      const y = Math.round(headY) + oy;
      if (!insideHole(x, y, hole)) put(x, y, '✦', headFg, true);
    }
    return;
  }

  const age = local - APOCALYPSE_FLIGHT_TICKS;
  paintRimMegaBurst({
    put,
    ix: snap.x,
    iy: snap.y,
    age,
    life: APOCALYPSE_BURST_TICKS,
    seed,
    size: 'l',
    burstScale: 5.8,
    debrisCount: premium ? 96 : 72,
    hole,
    premium,
    glow,
    primary,
    particle,
    muted,
  });
  // Secondary rim flashes so the pop wraps the stage like a planet strike.
  const side = facingRimSide(latched.sector);
  for (const t of [0.2, 0.5, 0.8] as const) {
    const p = rimPoint(hole, side, t);
    const sat = snapImpactToLetterbox(Math.round(p.x), Math.round(p.y), hole, cols, rows);
    if (sat.x === snap.x && sat.y === snap.y) continue;
    paintRimMegaBurst({
      put,
      ix: sat.x,
      iy: sat.y,
      age: age * 0.85,
      life: APOCALYPSE_BURST_TICKS,
      seed: seed + Math.round(t * 100),
      size: 'l',
      burstScale: 3.2,
      debrisCount: premium ? 40 : 28,
      hole,
      premium,
      glow,
      primary,
      particle,
      muted,
    });
  }
}
