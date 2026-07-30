/**
 * Jewel Tank scenery — the sway-animated plant kit painter, the aquascape
 * layout (carpet/bush/broad/stem/tall/grass), the centerpiece rock, the
 * left air-stone bubble column, and the jellyfish/seahorse accent creatures.
 *
 * Split out of `idle-scene.ts`; no behavior change.
 */

import { mixHexColor } from '#/tui/renderer';

import { blitAt, hash2, putCell } from '#/tui/features/idle-scene/idle-scene-canvas';
import type { AquariumPalette } from '#/tui/features/idle-scene/idle-scene-palette';
import {
  BUBBLE_GLYPHS,
  JELLYFISH_FRAMES,
  PLANT_BROAD,
  PLANT_BUSH,
  PLANT_CARPET,
  PLANT_GRASS,
  PLANT_STEM,
  PLANT_SWAY_MS,
  PLANT_TALL,
  ROCK_FORMS,
  SEAHORSE_FRAMES,
} from '#/tui/features/idle-scene/idle-scene-sprites';

type PlantKit = readonly (readonly [string, string, string, string])[];

function paintPlantKit(
  canvas: string[],
  width: number,
  sandY: number,
  elapsedMs: number,
  paint: (hex: string, text: string) => string,
  kit: PlantKit,
  x: number,
  hex: string,
  seed: number,
  /** 0 = foreground bright, 1 = background muted (depth cue). */
  depth = 0,
  muteHex?: string,
  /** Bright tip / lit edge (defaults to a hot lime lift of `hex`). */
  tipHex?: string,
): void {
  const frameIdx = Math.floor(elapsedMs / PLANT_SWAY_MS + seed * 0.2) % 4;
  const rows = kit.length;
  const tip = tipHex ?? mixHexColor(hex, '#E8FF9A', 0.55);
  const base = muteHex ?? mixHexColor(hex, '#041810', 0.7);
  const lines = kit.map((row, rowIdx) => {
    // tip (top of stalk) → base (bed): strong vertical jewel gradient
    const t = rows <= 1 ? 0.5 : rowIdx / (rows - 1);
    // depth pushes the whole stalk toward the abyss a bit
    const stalk = mixHexColor(tip, base, Math.min(1, t * 0.92 + depth * 0.25));
    const glyph = row[frameIdx] ?? row[0]!;
    // Per-cell: leaf edges catch light, inner folds go darker.
    let painted = '';
    for (let i = 0; i < glyph.length; i++) {
      const ch = glyph[i]!;
      if (ch === ' ') {
        painted += ' ';
        continue;
      }
      const edge = i === 0 || i === glyph.length - 1 || ch === ')' || ch === '(';
      const fold = ch === '~' || ch === '.' || ch === ',';
      const cellHex = edge
        ? mixHexColor(stalk, tip, 0.45)
        : fold
          ? mixHexColor(stalk, base, 0.4)
          : stalk;
      painted += paint(cellHex, ch);
    }
    return painted;
  });
  const top = Math.max(1, sandY - lines.length);
  blitAt(canvas, lines, top, Math.max(0, Math.min(width - 5, x)), width);
}

/**
 * Reference aquascape layout:
 * left bubble + fine bush → center rock + broad leaves → right tall swords,
 * one magenta stem behind the rock, carpet in the foreground.
 */
export function paintSeaweed(
  canvas: string[],
  width: number,
  storyRows: number,
  elapsedMs: number,
  paint: (hex: string, text: string) => string,
  green: string,
  greenSoft: string,
  plantAccent: string,
  depthMute: string,
): void {
  if (width < 24 || storyRows < 6) return;
  const sandY = storyRows - 1;
  const left = Math.floor(width * 0.1);
  const mid = Math.floor(width * 0.36);
  const right = Math.floor(width * 0.68);

  // Strong tip→bed gradient stops (jewel greens / magenta stem).
  const tipLite = mixHexColor(greenSoft, '#F5FFB0', 0.5);
  const tipHot = mixHexColor(green, '#C8FF60', 0.4);
  const bedDeep = mixHexColor(green, depthMute, 0.72);
  const bedAbyss = mixHexColor(bedDeep, '#020A08', 0.45);
  const accentTip = mixHexColor(plantAccent, '#FFB0E0', 0.45);
  const accentBed = mixHexColor(plantAccent, '#2A0418', 0.65);

  // 1) Foreground carpet — denser left/right, light under the rock
  const carpetStep = width >= 64 ? 3 : 2;
  for (let x = 1; x < width - 4; x += carpetStep) {
    const underRock = x >= mid - 2 && x <= mid + 12;
    if (underRock && x % (carpetStep * 2) !== 0) continue;
    const seed = hash2(x * 19 + 3, 41);
    paintPlantKit(
      canvas,
      width,
      sandY,
      elapsedMs,
      paint,
      PLANT_CARPET,
      x,
      greenSoft,
      seed,
      0,
      bedDeep,
      tipLite,
    );
  }

  // 2) Left fine bush (milfoil) — mid-height, beside the plume
  for (const [i, x] of [left, left + 5, left + 9].entries()) {
    if (x > width - 6) continue;
    const seed = hash2(i * 31 + 2, 61);
    paintPlantKit(
      canvas,
      width,
      sandY,
      elapsedMs,
      paint,
      PLANT_BUSH,
      x,
      green,
      seed,
      0.15,
      bedAbyss,
      tipHot,
    );
  }

  // 3) Broad leaves tucked against the rock
  if (width >= 40) {
    paintPlantKit(
      canvas,
      width,
      sandY,
      elapsedMs,
      paint,
      PLANT_BROAD,
      mid - 1,
      green,
      11,
      0.1,
      bedDeep,
      tipHot,
    );
    paintPlantKit(
      canvas,
      width,
      sandY,
      elapsedMs,
      paint,
      PLANT_BROAD,
      mid + 8,
      greenSoft,
      17,
      0.15,
      bedDeep,
      tipLite,
    );
  }

  // 4) Single magenta/red stem behind the hardscape
  if (width >= 48 && storyRows >= 9) {
    paintPlantKit(
      canvas,
      width,
      sandY,
      elapsedMs,
      paint,
      PLANT_STEM,
      mid + 3,
      plantAccent,
      29,
      0.4,
      accentBed,
      accentTip,
    );
  }

  // 5) Right tall sword wall — hero mass, nearly to the waterline
  if (width >= 40 && storyRows >= 9) {
    const tallXs =
      width >= 64
        ? [right, right + 4, right + 8, right + 12]
        : [right, right + 5, right + 9];
    for (let i = 0; i < tallXs.length; i++) {
      const x = tallXs[i]!;
      if (x < 2 || x > width - 7) continue;
      const seed = hash2(i * 43 + 7, 89);
      // Farther-right stalks sit slightly deeper/darker.
      const depth = 0.25 + i * 0.1;
      paintPlantKit(
        canvas,
        width,
        sandY,
        elapsedMs,
        paint,
        PLANT_TALL,
        x,
        green,
        seed,
        depth,
        bedAbyss,
        tipHot,
      );
    }
  }

  // 6) Left bank vallisneria grass — flowing ribbon leaves beside the aerator
  if (width >= 48 && storyRows >= 10) {
    const grassXs = width >= 72 ? [left + 13, left + 16] : [left + 12];
    for (let i = 0; i < grassXs.length; i++) {
      const x = grassXs[i]!;
      if (x < 2 || x > width - 6) continue;
      const seed = hash2(i * 59 + 11, 127);
      paintPlantKit(
        canvas,
        width,
        sandY,
        elapsedMs,
        paint,
        PLANT_GRASS,
        x,
        greenSoft,
        seed,
        0.2 + i * 0.08,
        bedDeep,
        tipLite,
      );
    }
  }
}

/** One warm centerpiece rock (reference hardscape), plus a small companion. */
export function paintCoral(
  canvas: string[],
  width: number,
  storyRows: number,
  _elapsedMs: number,
  paint: (hex: string, text: string) => string,
  hex: string,
  soft: string,
  bed: string,
): void {
  if (width < 36 || storyRows < 7) return;
  const sandY = storyRows - 1;
  const main = ROCK_FORMS[0]!;
  const side = ROCK_FORMS[2]!;
  const mainX = Math.floor(width * 0.38);
  const sideX = Math.floor(width * 0.5);
  const paintRock = (form: readonly string[], x: number, topColor: string, baseColor: string) => {
    const lines = form.map((row, i) => {
      const t = form.length <= 1 ? 0 : i / (form.length - 1);
      return paint(mixHexColor(topColor, baseColor, t * 0.7), row);
    });
    const top = Math.max(1, sandY - lines.length);
    blitAt(canvas, lines, top, Math.max(0, Math.min(width - (form[0]?.length ?? 6), x)), width);
  };
  paintRock(main, mainX, hex, soft);
  if (width >= 56) paintRock(side, sideX, soft, mixHexColor(soft, bed, 0.4));
}

/** Left filter/aerator — fine bubble column rising toward the surface. */
export function paintAirStone(
  canvas: string[],
  width: number,
  storyRows: number,
  elapsedMs: number,
  paint: (hex: string, text: string) => string,
  stone: string,
  bubble: string,
  bubbleSoft: string,
): void {
  if (width < 40 || storyRows < 8) return;
  const sandY = storyRows - 1;
  const seed = 42;
  const x = Math.max(1, Math.floor(width * 0.06));
  // Compact filter in the top-left corner (reference).
  const head = [paint(stone, '╒═╕'), paint(stone, '╘═╛')];
  const headTop = 1;
  blitAt(canvas, head, headTop, x, width);

  // Fine column from bed up toward the filter.
  const plumeCount = Math.min(8, Math.max(5, Math.floor(storyRows * 0.6)));
  for (let i = 0; i < plumeCount; i++) {
    const pSeed = hash2(i * 17 + 3, seed);
    const period = 1_400 + (pSeed % 800);
    const progress = ((elapsedMs + pSeed * 37) % period) / period;
    const span = Math.max(4, sandY - headTop - 1);
    const y = sandY - 1 - Math.floor(progress * span);
    if (y <= headTop || y >= sandY) continue;
    const bx = x + 1 + (Math.sin(elapsedMs / 320 + i * 0.9) > 0 ? 1 : 0);
    const g = BUBBLE_GLYPHS[Math.min(BUBBLE_GLYPHS.length - 1, Math.floor(progress * 3))] ?? 'o';
    putCell(canvas, y, bx, width, paint(progress > 0.55 ? bubble : bubbleSoft, g));
  }
}

/**
 * Jellyfish ambient creatures — slow vertical drift with pulsing bell.
 * Purely visual (not part of the physics sim). 1–2 jellies in premium mode.
 */
export function paintJellyfish(
  canvas: string[],
  width: number,
  storyRows: number,
  elapsedMs: number,
  paint: (hex: string, text: string) => string,
  palette: AquariumPalette,
): void {
  if (width < 56 || storyRows < 12) return;
  const sandY = storyRows - 1;
  const count = width >= 80 ? 2 : 1;

  for (let i = 0; i < count; i++) {
    const seed = hash2(i * 83 + 19, 241);
    // Slow vertical oscillation (jellyfish pulse upward then drift down).
    const period = 8_000 + (seed % 4_000);
    const phase = (elapsedMs + seed * 137) % period;
    const t = phase / period;
    // Rise fast, sink slow (sawtooth-ish with easing).
    const rise = t < 0.4 ? t / 0.4 : 1 - (t - 0.4) / 0.6;
    const minY = 2;
    const maxY = Math.max(3, Math.floor(sandY * 0.55));
    const y = Math.max(minY, Math.min(maxY, Math.round(minY + (1 - rise) * (maxY - minY))));
    // Gentle horizontal sway.
    const baseX = Math.floor(width * (0.2 + (i * 0.45) + (seed % 20) / 100));
    const sway = Math.floor(Math.sin(elapsedMs / 3_200 + seed) * 2);
    const x = Math.max(1, Math.min(width - 8, baseX + sway));

    // Pulse animation frame.
    const pulseFrame = Math.floor(elapsedMs / 1_100 + seed) % JELLYFISH_FRAMES.length;
    const frame = JELLYFISH_FRAMES[pulseFrame] ?? JELLYFISH_FRAMES[0]!;

    // Bioluminescent coloring: bell is bright, tentacles fade.
    const bellHex = mixHexColor(palette.fishSoft, palette.bubble, 0.35);
    const bellHot = mixHexColor(bellHex, '#FFFFFF', 0.35);
    const tentHex = mixHexColor(bellHex, palette.water, 0.5);

    const lines = frame.map((row, rowIdx) => {
      let painted = '';
      for (const ch of row) {
        if (ch === ' ') { painted += ' '; continue; }
        const hex = rowIdx === 0 ? bellHot : rowIdx === 1 ? bellHex : tentHex;
        painted += paint(hex, ch);
      }
      return painted;
    });
    blitAt(canvas, lines, y, x, width);
  }
}

/**
 * Seahorse ambient creature — slow drift near plants, curled tail animation.
 * Premium-only accent near the right plant bank.
 */
export function paintSeahorse(
  canvas: string[],
  width: number,
  storyRows: number,
  elapsedMs: number,
  paint: (hex: string, text: string) => string,
  palette: AquariumPalette,
): void {
  if (width < 64 || storyRows < 12) return;
  const sandY = storyRows - 1;
  const seed = hash2(71, 313);
  // Positioned near the right plant bank.
  const x = Math.floor(width * 0.72) + (seed % 4);
  // Gentle vertical bob near the plants.
  const baseY = Math.floor(sandY * 0.45);
  const bob = Math.sin(elapsedMs / 4_500 + seed) * 1.2;
  const y = Math.max(2, Math.min(sandY - 4, Math.round(baseY + bob)));

  const frame = SEAHORSE_FRAMES[Math.floor(elapsedMs / 1_400) % SEAHORSE_FRAMES.length] ?? SEAHORSE_FRAMES[0]!;
  const bodyHex = mixHexColor(palette.fishGold, palette.coral, 0.4);
  const hotHex = mixHexColor(bodyHex, '#FFE08A', 0.4);

  const lines = frame.map((row, rowIdx) => {
    let painted = '';
    for (const ch of row) {
      if (ch === ' ') { painted += ' '; continue; }
      const hex = rowIdx === 0 ? hotHex : rowIdx === 1 ? bodyHex : mixHexColor(bodyHex, palette.water, 0.35);
      painted += paint(hex, ch);
    }
    return painted;
  });
  blitAt(canvas, lines, y, x, width);
}
