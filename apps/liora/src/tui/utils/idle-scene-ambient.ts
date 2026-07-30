/**
 * Jewel Tank ambient water/sky layers — waterline & sand-bed line generators,
 * the depth-graded mid-water fill (with its own cache), surface god-rays,
 * volumetric light cones, drifting motes, and generic shimmer/mist helpers.
 *
 * Split out of `idle-scene.ts`; no behavior change.
 */

import { mixHexColor, type RendererCell } from '#/tui/renderer';

import {
  cellsToAnsiLine,
  cloneCellRow,
  hash2,
  inStoryCellSession,
  padOrTrim,
  putCell,
  setStoryCellRow,
  waterCell,
} from '#/tui/utils/idle-scene-canvas';
import type { AquariumPalette } from '#/tui/utils/idle-scene-palette';
import { BUBBLE_GLYPHS, CAUSTIC_DRIFT_MS, PLANT_SWAY_MS } from '#/tui/utils/idle-scene-sprites';

/** Compact aerator head — soft bubble + gravel stone, no box-drawing theatre. */
export function resolveAirStoneGlyph(elapsedMs: number, seed: number): readonly string[] {
  const frame = Math.floor((elapsedMs + seed * 40) / 220) % BUBBLE_GLYPHS.length;
  const top = BUBBLE_GLYPHS[frame] ?? 'o';
  return [` ${top} `, ' · ', '._.'];
}

export function paintBubbles(
  canvas: string[],
  width: number,
  rows: number,
  elapsedMs: number,
  paintGlyph: (glyph: string, intensity: number) => string,
): void {
  if (width <= 0 || rows <= 0) return;
  const columns = Math.max(1, Math.min(2, Math.floor(width / 28)));
  for (let i = 0; i < columns; i++) {
    const seed = hash2(i * 29 + 5, 77);
    const x = 3 + (seed % Math.max(1, width - 6));
    const period = 3_200 + (seed % 2_400);
    const progress = ((elapsedMs + seed) % period) / period;
    const y = Math.floor((1 - progress) * (rows - 1));
    const sizeIdx = Math.min(BUBBLE_GLYPHS.length - 1, Math.floor(progress * BUBBLE_GLYPHS.length));
    const wobble = Math.sin(elapsedMs / 720 + seed) > 0 ? 0 : 1;
    putCell(
      canvas,
      y,
      Math.min(width - 1, x + wobble),
      width,
      paintGlyph(BUBBLE_GLYPHS[sizeIdx] ?? 'o', 0.4 + progress * 0.55),
    );
  }
}

/** Soft caustic light band drifting across mid-water. */
export function paintCausticPath(
  canvas: string[],
  top: number,
  bandRows: number,
  width: number,
  elapsedMs: number,
  paintCh: (ch: string) => string,
): void {
  if (width <= 0 || bandRows <= 0) return;
  const center = Math.floor((elapsedMs / CAUSTIC_DRIFT_MS) % Math.max(1, width + 10)) - 5;
  const half = Math.max(2, Math.floor(width * 0.08));
  for (let r = 0; r < bandRows; r++) {
    const y = top + r;
    if (y < 0 || y >= canvas.length) continue;
    for (let x = Math.max(0, center - half); x <= Math.min(width - 1, center + half); x++) {
      const dist = Math.abs(x - center);
      const ch = dist < half * 0.35 ? '≈' : dist < half * 0.7 ? '∼' : '·';
      putCell(canvas, y, x, width, paintCh(ch), true);
    }
  }
}

/** Quantize surface/bed motion so ambient ticks don't rewrite every water/sand cell. */
export const IDLE_SURFACE_MOTION_QUANTUM_MS = 96;

export function renderWaterline(width: number, elapsedMs: number): string {
  if (width <= 0) return '';
  const motionMs =
    Math.floor(Math.max(0, elapsedMs) / IDLE_SURFACE_MOTION_QUANTUM_MS) *
    IDLE_SURFACE_MOTION_QUANTUM_MS;
  const cells: string[] = [];
  for (let x = 0; x < width; x++) {
    const phase = Math.sin(x * 0.28 + motionMs / 2_200);
    if (phase > 0.55) cells.push('≈');
    else if (phase > 0.1) cells.push('~');
    else if (phase > -0.35) cells.push('∼');
    else cells.push('·');
  }
  return cells.join('');
}

/** Dark aquasoil / gravel bed — rare warm glints under tank light. */
export function renderSandLine(width: number, elapsedMs: number, rowSeed: number): string {
  if (width <= 0) return '';
  const motionMs =
    Math.floor(Math.max(0, elapsedMs) / IDLE_SURFACE_MOTION_QUANTUM_MS) *
    IDLE_SURFACE_MOTION_QUANTUM_MS;
  const cells: string[] = [];
  for (let x = 0; x < width; x++) {
    const n = hash2(x + 3, rowSeed + 11) % 11;
    const glint = Math.sin(motionMs / 3_600 + x * 0.21 + rowSeed) > 0.97;
    if (glint) cells.push('˚');
    else if (n === 0) cells.push('o');
    else if (n <= 2) cells.push(':');
    else if (n <= 5) cells.push('.');
    else cells.push('·');
  }
  return cells.join('');
}

export function renderBankRail(width: number, elapsedMs: number, _fancy: boolean): string {
  return renderSandLine(width, elapsedMs, 1);
}

export function renderHillLine(width: number, elapsedMs: number): string {
  if (width <= 0) return '';
  const cells: string[] = [];
  for (let x = 0; x < width; x++) {
    const h = hash2(x + 1, 19);
    if (h % 10 === 0) cells.push(Math.sin(elapsedMs / PLANT_SWAY_MS + x) > 0 ? ')' : '(');
    else cells.push(' ');
  }
  return cells.join('');
}

/**
 * Quiet mid-water fill — near-stage abyss wash, not a neon sky block.
 * Every cell still carries an explicit bg so fish/plant updates do not flash
 * terminal-default black; hue stays subdued so fish/plants read first.
 */
export function paintWaterDepth(
  canvas: string[],
  width: number,
  rows: number,
  _paint: (hex: string, text: string) => string,
  _sky: string,
  mid: string,
  deep: string,
  abyss?: string,
): void {
  if (width <= 0 || rows <= 2) return;
  const sandY = rows - 1;
  const depthRows = resolveWaterDepthCells(width, rows, mid, deep, abyss);
  const cellSession = inStoryCellSession(canvas);
  for (let y = 1; y < sandY; y++) {
    const row = depthRows[y];
    if (row === undefined) continue;
    if (cellSession) {
      setStoryCellRow(y, cloneCellRow(row));
    } else {
      canvas[y] = cellsToAnsiLine(row);
    }
  }
}

type WaterDepthCacheEntry = {
  readonly key: string;
  readonly rows: readonly (readonly RendererCell[])[];
};

let waterDepthCache: WaterDepthCacheEntry | undefined;

/** Test helper — drop the ambient-layer paint caches owned by this module. */
export function resetIdleSceneAmbientCachesForTests(): void {
  waterDepthCache = undefined;
}

function resolveWaterDepthCells(
  width: number,
  rows: number,
  mid: string,
  deep: string,
  abyss: string | undefined,
): readonly (readonly RendererCell[])[] {
  const key = `${width}x${rows}|${mid}|${deep}|${abyss ?? ''}`;
  if (waterDepthCache?.key === key) return waterDepthCache.rows;

  const sandY = rows - 1;
  const bottom = abyss ?? mixHexColor(deep, '#020617', 0.55);
  const upper = mixHexColor(bottom, deep, 0.45);
  const middle = mixHexColor(bottom, mid, 0.18);
  const built: RendererCell[][] = Array.from({ length: rows }, () => []);
  for (let y = 1; y < sandY; y++) {
    const t = (y - 1) / Math.max(1, sandY - 2);
    const hex =
      t < 0.35 ? mixHexColor(upper, middle, t / 0.35) : mixHexColor(middle, bottom, (t - 0.35) / 0.65);
    const chance = t < 0.3 ? 2 : t < 0.55 ? 4 : t < 0.75 ? 8 : 14;
    const sparkle = mixHexColor(hex, mid, 0.35);
    const row: RendererCell[] = [];
    for (let x = 0; x < width; x++) {
      const n = hash2(x * 17 + 3, y * 29 + 7) % 100;
      let ch = ' ';
      if (n < chance) ch = t > 0.65 ? '˙' : '·';
      else if (n < chance + (t > 0.7 ? 3 : 1)) ch = t > 0.5 ? '˚' : '·';
      row.push(ch === ' ' ? waterCell(' ', undefined, hex) : waterCell(ch, sparkle, hex));
    }
    built[y] = row;
  }
  waterDepthCache = { key, rows: built };
  return built;
}

/** Surface god-rays / warm caustic ribbons — lighting, not clutter. */
export function paintSurfaceLight(
  canvas: string[],
  width: number,
  storyRows: number,
  elapsedMs: number,
  paint: (hex: string, text: string) => string,
  shaft: string,
  cool: string,
): void {
  if (width < 36 || storyRows < 8) return;
  // Same quantum as waterline/sand so ambient ticks don't recompute ray drift
  // every frame for visually identical positions.
  const motionMs =
    Math.floor(Math.max(0, elapsedMs) / IDLE_SURFACE_MOTION_QUANTUM_MS) *
    IDLE_SURFACE_MOTION_QUANTUM_MS;
  const sandY = storyRows - 1;
  const shafts = width >= 72 ? 3 : 2;
  for (let i = 0; i < shafts; i++) {
    const seed = hash2(i * 41 + 9, 113);
    const baseX = 6 + Math.floor(((i + 0.35) / shafts) * (width - 14)) + ((seed % 5) - 2);
    const drift = Math.floor(Math.sin(motionMs / 1_800 + seed) * 2);
    const x = Math.max(2, Math.min(width - 3, baseX + drift));
    const len = Math.min(sandY - 2, 3 + (seed % 3));
    for (let d = 0; d < len; d++) {
      const y = 1 + d;
      if (y >= sandY - 1) break;
      const fade = d / Math.max(1, len - 1);
      const hex = mixHexColor(shaft, cool, fade * 0.65);
      const g = d === 0 ? '˚' : d === 1 ? '·' : '˙';
      // Skip if a hard glyph already owns the cell (fish/plant stay readable).
      putCell(canvas, y, x + (d % 2 === 0 ? 0 : 1), width, paint(hex, g));
    }
  }

  // Slow warm caustic band just under the surface (drift slowed — no flicker soup).
  if (storyRows >= 10) {
    paintCausticPath(canvas, 1, 1, width, motionMs * 0.12, (ch) =>
      paint(mixHexColor(shaft, cool, 0.35), ch),
    );
  }
}

/**
 * Full-width depth-graded water base so idle frames never read as empty black
 * voids when animation freezes (e.g. between ambient ticks).
 */
export function paintWaterBase(
  canvas: string[],
  width: number,
  rows: number,
  paint: (hex: string, text: string) => string,
  sky: string,
  skySoft: string,
  skyDeep: string,
): void {
  if (width <= 0 || rows <= 1) return;
  const sandY = rows - 1;
  for (let y = 1; y < sandY; y++) {
    const depth = (y - 1) / Math.max(1, sandY - 2);
    const hex = depth < 0.33 ? skySoft : depth < 0.66 ? sky : skyDeep;
    const cells: string[] = [];
    for (let x = 0; x < width; x++) {
      const n = hash2(x + 1, y + 3) % 100;
      if (depth < 0.28) {
        cells.push(n < 40 ? '·' : n < 58 ? '˙' : ' ');
      } else if (depth < 0.62) {
        cells.push(n < 50 ? '·' : n < 78 ? '˙' : '˚');
      } else {
        cells.push(n < 35 ? '·' : n < 70 ? '˙' : '˚');
      }
    }
    canvas[y] = padOrTrim(paint(hex, cells.join('')), width);
  }
}

/** Drifting water highlights on top of {@link paintWaterBase}. */
export function paintWaterField(
  canvas: string[],
  width: number,
  rows: number,
  elapsedMs: number,
  paint: (hex: string, text: string) => string,
  sky: string,
  skySoft: string,
  skyDeep: string,
): void {
  if (width <= 0 || rows <= 1) return;
  const count = Math.max(4, Math.floor(width * 0.16));
  for (let i = 0; i < count; i++) {
    const seed = hash2(i * 23 + 4, 61);
    const drift = Math.floor(elapsedMs / 110 + seed * 0.01) % Math.max(1, width);
    const x = (seed + drift) % width;
    const depthBias = (seed % 100) / 100;
    const y = 1 + Math.floor(depthBias * depthBias * Math.max(1, rows - 2));
    const tone = seed % 5;
    const hex = tone === 0 ? skyDeep : tone < 3 ? sky : skySoft;
    const glyph = tone === 0 ? '˙' : tone < 3 ? '·' : '˚';
    putCell(canvas, y, x, width, paint(hex, glyph), true);
  }
}

export function paintWaterShimmer(
  canvas: string[],
  width: number,
  rows: number,
  elapsedMs: number,
  density: number,
  paintGlyph: (glyph: string, intensity: number) => string,
): void {
  if (width <= 0 || rows <= 0) return;
  const count = Math.max(1, Math.floor(width * density * 0.05));
  for (let i = 0; i < count; i++) {
    const seed = hash2(i * 17 + 3, 91);
    const x = seed % width;
    const y =
      (hash2(i * 13 + 7, 53) + Math.floor(elapsedMs / 1_400)) %
      Math.max(1, Math.floor(rows * 0.45));
    putCell(canvas, y, x, width, paintGlyph('·', 0.45));
  }
}

export function paintMist(
  canvas: string[],
  width: number,
  rows: number,
  elapsedMs: number,
  paintGlyph: (glyph: string, intensity: number) => string,
): void {
  paintWaterShimmer(canvas, width, rows, elapsedMs, 0.35, paintGlyph);
}

export function paintFireflies(
  canvas: string[],
  width: number,
  rows: number,
  elapsedMs: number,
  density: number,
  paintGlyph: (glyph: string, intensity: number) => string,
): void {
  paintWaterShimmer(canvas, width, rows, elapsedMs, density, paintGlyph);
}

/**
 * Volumetric light cones — wide triangular beams from the surface that
 * widen as they descend, with soft edges and slow drift.
 */
export function paintVolumetricLight(
  canvas: string[],
  width: number,
  storyRows: number,
  elapsedMs: number,
  paint: (hex: string, text: string) => string,
  shaft: string,
  cool: string,
): void {
  if (width < 48 || storyRows < 10) return;
  const motionMs =
    Math.floor(Math.max(0, elapsedMs) / IDLE_SURFACE_MOTION_QUANTUM_MS) *
    IDLE_SURFACE_MOTION_QUANTUM_MS;
  const sandY = storyRows - 1;
  const cones = width >= 80 ? 3 : 2;

  for (let i = 0; i < cones; i++) {
    const seed = hash2(i * 67 + 13, 157);
    const baseX = Math.floor(((i + 0.5) / cones) * (width - 12)) + 6;
    const drift = Math.floor(Math.sin(motionMs / 2_400 + seed * 0.7) * 3);
    const centerX = Math.max(4, Math.min(width - 4, baseX + drift));
    const maxDepth = Math.min(sandY - 2, 5 + (seed % 4));
    // Cone widens as it descends.
    const topWidth = 1;
    const bottomWidth = Math.max(3, Math.floor(maxDepth * 0.8));

    for (let d = 0; d < maxDepth; d++) {
      const y = 1 + d;
      if (y >= sandY - 1) break;
      const t = d / Math.max(1, maxDepth - 1);
      const halfW = Math.floor(topWidth + (bottomWidth - topWidth) * t);
      const fade = 1 - t * 0.7;
      const hex = mixHexColor(shaft, cool, t * 0.5);
      // Soft edge: center is brighter, edges fade.
      for (let dx = -halfW; dx <= halfW; dx++) {
        const x = centerX + dx;
        if (x < 0 || x >= width) continue;
        const edgeDist = Math.abs(dx) / Math.max(1, halfW);
        if (edgeDist > 0.85 && (seed + d + dx) % 3 !== 0) continue; // Soft edge dropout.
        const glyph = edgeDist < 0.3 ? '˚' : edgeDist < 0.6 ? '·' : '˙';
        const cellHex = mixHexColor(hex, cool, edgeDist * 0.4);
        // Only paint on soft cells — don't overwrite fish/plants.
        if (fade > 0.3) {
          putCell(canvas, y, x, width, paint(cellHex, glyph));
        }
      }
    }
  }
}

/**
 * Floating plankton / detritus motes — tiny particles drifting in the
 * water column at various depths. Adds life to the open water space.
 */
export function paintPlankton(
  canvas: string[],
  width: number,
  storyRows: number,
  elapsedMs: number,
  paint: (hex: string, text: string) => string,
  palette: AquariumPalette,
): void {
  if (width < 36 || storyRows < 8) return;
  const sandY = storyRows - 1;
  const count = Math.max(6, Math.floor(width * storyRows * 0.012));

  for (let i = 0; i < count; i++) {
    const seed = hash2(i * 37 + 7, 199);
    // Slow horizontal drift + gentle vertical bob.
    const driftX = Math.floor(elapsedMs / (3_800 + (seed % 2_000)) + seed * 0.1) % Math.max(1, width);
    const x = (seed + driftX) % width;
    const depthBias = (seed % 100) / 100;
    const baseY = 2 + Math.floor(depthBias * Math.max(1, sandY - 4));
    const bob = Math.sin(elapsedMs / (2_600 + (seed % 1_400)) + seed) * 0.8;
    const y = Math.max(1, Math.min(sandY - 2, Math.round(baseY + bob)));

    // Depth-based visibility: deeper = dimmer.
    const depthT = (y - 1) / Math.max(1, sandY - 2);
    const visibility = 1 - depthT * 0.6;
    if ((seed % 100) / 100 > visibility + 0.3) continue;

    const tone = seed % 4;
    const hex =
      tone === 0
        ? mixHexColor(palette.bubble, palette.shaft, 0.3)
        : tone === 1
          ? mixHexColor(palette.water, palette.bubble, 0.4)
          : tone === 2
            ? mixHexColor(palette.plantSoft, palette.water, 0.6)
            : mixHexColor(palette.shaft, palette.water, 0.5);
    const glyph = tone === 0 ? '·' : tone === 1 ? '˙' : tone === 2 ? '.' : '˚';
    putCell(canvas, y, x, width, paint(hex, glyph));
  }
}
