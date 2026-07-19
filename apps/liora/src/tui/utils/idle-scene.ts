/**
 * Empty-transcript idle scene — Jewel Tank.
 *
 * A curated premium aquarium: clear water, one lead fish, a small school,
 * a seaweed curtain, coral silhouettes, an air-stone plume, and a soft
 * caustic band. Sparse cast, rich layers. No gadget clutter, no splash
 * Blood Moon glyphs.
 */

import {
  ansiTextToCells,
  styleToAnsi,
  truncateToWidth,
  visibleWidth,
  type RendererCell,
} from '#/tui/renderer';

import type { IdleFish, IdleTankSnapshot } from '#/tui/utils/idle-tank-sim';

/** Lead fish — right. Single row (no fake top/bottom fins). */
export const FISH_LARGE_RIGHT = ['><(((º>'] as const;

/** Lead fish — left. */
export const FISH_LARGE_LEFT = ['<º)))><'] as const;

/** Mid-size companion — right. */
export const FISH_COMPACT_RIGHT = [' ><> '] as const;

/** Mid-size companion — left. */
export const FISH_COMPACT_LEFT = [' <>< '] as const;

/** Tiny darting friends (right / left pairs). */
export const FISH_TINY = [
  ['>◦>', '<◦<'],
  ['>~>', '<~<'],
  ['>º>', '<º<'],
] as const;

/**
 * Short leafy seaweed — 3 rows × 4 sway frames (crown → root).
 * Soft curves; avoid tall bamboo `|` poles.
 */
export const PLANT_FRAMES = [
  [' ~) ', ' ~( ', ' ~) ', ' ~( '],
  [')~)(', '(~()', ')~)(', '(~()'],
  [' )( ', ' () ', ' )( ', ' () '],
] as const;

const ANSI_RESET = '\u001B[0m';

/** Low coral / rock silhouettes on the sand. */
export const CORAL_FORMS = [
  ['/\\/\\', '/__\\'],
  [' /\\ ', '/__\\'],
  ['/\\/ ', '\\_/ '],
] as const;

export const BUBBLE_GLYPHS = ['·', 'o', '°', '○'] as const;

export const FISH_SWIM_MS = 4_200;
export const FISH_TAIL_MS = 360;
export const BUBBLE_STEP_MS = 170;
export const PLANT_SWAY_MS = 2_400;
export const CAUSTIC_DRIFT_MS = 55;
export const SPARKLE_MS = 880;

/** @deprecated transitional aliases */
export const FOX_BREATH_MS = FISH_SWIM_MS;
export const FOX_TAIL_MS = FISH_TAIL_MS;
export const RAIN_STEP_MS = BUBBLE_STEP_MS;

export function stripAnsi(text: string): string {
  return text.replaceAll(/\u001B\[[0-9;]*m/g, '');
}

export function padOrTrim(text: string, width: number): string {
  const w = visibleWidth(text);
  if (w === width) return text;
  if (w > width) return truncateToWidth(text, width, '…');
  return text + ' '.repeat(width - w);
}

export function centerText(width: number, text: string): string {
  const w = visibleWidth(text);
  if (w >= width) return truncateToWidth(text, width, '…');
  const pad = Math.floor((width - w) / 2);
  return `${' '.repeat(pad)}${text}`;
}

export function blitCentered(
  canvas: string[],
  lines: readonly string[],
  top: number,
  width: number,
): void {
  for (let i = 0; i < lines.length; i++) {
    const y = top + i;
    if (y < 0 || y >= canvas.length) continue;
    const line = lines[i];
    if (line === undefined) continue;
    const plainW = visibleWidth(line);
    const pad = Math.max(0, Math.floor((width - plainW) / 2));
    canvas[y] = padOrTrim(`${' '.repeat(pad)}${line}`, width);
  }
}

/** Expand an ANSI line to fixed-width cells (aquarium glyphs are width-1). */
function expandLineCells(line: string, width: number): RendererCell[] {
  const cells: RendererCell[] = [];
  for (const cell of ansiTextToCells(line)) {
    if (cell.continuation === true) continue;
    cells.push(cell);
    if (cells.length >= width) break;
  }
  while (cells.length < width) cells.push({ char: ' ' });
  return cells.slice(0, width);
}

/** Serialize cells back to ANSI without stripping neighboring styles. */
function cellsToAnsiLine(cells: readonly RendererCell[]): string {
  const out: string[] = [];
  let activeFg: string | undefined;
  for (const cell of cells) {
    const fg = cell.style?.fg;
    if (fg !== activeFg) {
      out.push(fg === undefined ? ANSI_RESET : styleToAnsi({ fg }));
      activeFg = fg;
    }
    out.push(cell.char.length === 0 ? ' ' : cell.char);
  }
  if (activeFg !== undefined) out.push(ANSI_RESET);
  return out.join('');
}

export function blitAt(
  canvas: string[],
  lines: readonly string[],
  top: number,
  left: number,
  width: number,
): void {
  const safeLeft = Math.max(0, Math.trunc(left));
  for (let i = 0; i < lines.length; i++) {
    const y = top + i;
    if (y < 0 || y >= canvas.length) continue;
    const line = lines[i];
    if (line === undefined) continue;
    if (safeLeft >= width) continue;
    const cells = expandLineCells(canvas[y] ?? ' '.repeat(width), width);
    const glyphCells = expandLineCells(line, Math.max(1, visibleWidth(line)));
    const fit = Math.min(glyphCells.length, width - safeLeft);
    for (let x = 0; x < fit; x++) {
      const glyph = glyphCells[x];
      if (glyph === undefined) continue;
      // Skip blank padding so we don't wipe underlying colored water/plants.
      if (glyph.char === ' ' && glyph.style?.fg === undefined) continue;
      cells[safeLeft + x] = glyph;
    }
    canvas[y] = padOrTrim(cellsToAnsiLine(cells), width);
  }
}

function hash2(a: number, b: number): number {
  let x = Math.imul(a, 374761393) + Math.imul(b, 668265263);
  x = Math.imul(x ^ (x >>> 13), 1274126177);
  return (x ^ (x >>> 16)) >>> 0;
}

export function resolveSeaweedSpacing(width: number): number {
  if (width >= 80) return 6;
  if (width >= 50) return 8;
  return 10;
}

export interface AquariumPalette {
  readonly water: string;
  readonly waterDeep: string;
  readonly waterSoft: string;
  readonly plant: string;
  readonly plantSoft: string;
  readonly sand: string;
  readonly coral: string;
  readonly coralSoft: string;
  readonly food: string;
  readonly fishGold: string;
  readonly fishSky: string;
  readonly fishTeal: string;
  readonly fishSoft: string;
  readonly bubble: string;
  readonly dim: string;
}

type IdleSceneColors = {
  readonly glow: string;
  readonly particle: string;
  readonly primary: string;
  readonly accent: string;
  readonly textDim: string;
  readonly textMuted: string;
  readonly gradientStart?: string;
  readonly gradientEnd?: string;
  readonly roleUser?: string;
  readonly shellMode?: string;
  /** Natural plant green — aquarium uses this on purpose. */
  readonly success?: string;
};

/**
 * Map theme tokens to aquarium paint roles.
 * Water / surface stay sky-cyan; plants use success green (intentional).
 * Never warning / error for sand or food.
 */
export function resolveAquariumPalette(
  colors: IdleSceneColors,
  _theme: 'dark' | 'light' = 'dark',
): AquariumPalette {
  // Explicit sky stack (glow / gradientStart / primary).
  const water = colors.glow;
  const waterDeep = colors.gradientStart ?? colors.glow;
  const waterSoft = colors.primary;
  const plantGreen = colors.success ?? colors.accent;
  const roleWarm = colors.roleUser ?? colors.primary;
  const roleCool = colors.shellMode ?? colors.accent;

  return {
    water,
    waterDeep,
    waterSoft,
    plant: plantGreen,
    plantSoft: colors.accent,
    sand: colors.textDim,
    coral: roleCool,
    coralSoft: colors.primary,
    food: colors.particle,
    fishGold: roleWarm,
    fishSky: water,
    fishTeal: colors.accent,
    fishSoft: colors.textDim,
    bubble: colors.glow,
    dim: colors.textDim,
  };
}

const SOFT_CELLS = new Set([' ', '·', '˙', '~', '∼', '˚']);

/** One cell. `glyph` may include full ANSI — preserve other cells' styles. */
function putCell(
  canvas: string[],
  y: number,
  x: number,
  width: number,
  glyph: string,
  force = false,
): void {
  if (y < 0 || y >= canvas.length || x < 0 || x >= width) return;
  const cells = expandLineCells(canvas[y] ?? ' '.repeat(width), width);
  const here = cells[x]?.char ?? ' ';
  if (!force && !SOFT_CELLS.has(here)) return;
  const painted = expandLineCells(glyph, 1)[0] ?? { char: stripAnsi(glyph).slice(0, 1) || ' ' };
  cells[x] = painted;
  canvas[y] = padOrTrim(cellsToAnsiLine(cells), width);
}

export function resolveFishGlyphRows(
  width: number,
  availableRows: number,
  elapsedMs = 0,
): readonly string[] {
  const safeWidth = Math.max(0, Math.trunc(width));
  const rows = Math.max(0, Math.trunc(availableRows));
  const facingRight = Math.sin((elapsedMs / FISH_SWIM_MS) * Math.PI * 2) >= 0;
  let base: readonly string[];
  if (safeWidth >= 36 && rows >= FISH_LARGE_RIGHT.length) {
    base = facingRight ? FISH_LARGE_RIGHT : FISH_LARGE_LEFT;
  } else if (rows >= FISH_COMPACT_RIGHT.length) {
    base = facingRight ? FISH_COMPACT_RIGHT : FISH_COMPACT_LEFT;
  } else {
    const compact = facingRight ? FISH_COMPACT_RIGHT : FISH_COMPACT_LEFT;
    base = compact.slice(0, Math.max(1, Math.min(compact.length, rows)));
  }
  return applyFishTail(base, elapsedMs, facingRight);
}

/** @deprecated */
export function resolveFoxGlyphRows(
  width: number,
  availableRows: number,
  elapsedMs = 0,
): readonly string[] {
  return resolveFishGlyphRows(width, availableRows, elapsedMs);
}

/** Soft cheek / tail pulse — ≥4 frames, never a hard blink. */
export function applyFishTail(
  rows: readonly string[],
  elapsedMs: number,
  facingRight = true,
): string[] {
  if (rows.length === 0) return [];
  const frame = Math.floor(elapsedMs / FISH_TAIL_MS) % 4;
  const out = rows.map((line) => line);
  const bodyIdx = out.findIndex((line) => /[<>]/.test(line));
  if (bodyIdx < 0) return out;
  const line = out[bodyIdx];
  if (line === undefined) return out;

  if (line.includes('(((º>') || line.includes('<º)))')) {
    const cheeks = facingRight
      ? (['(((º>', '((º> ', '(((º>', '((((º>'] as const)
      : (['<º)))', '<º)) ', '<º)))', '<º))))'] as const);
    const cheek = cheeks[frame] ?? cheeks[0]!;
    out[bodyIdx] = facingRight
      ? line.replace(/\({2,4}º>/u, cheek)
      : line.replace(/<º\){2,4}/u, cheek);
    return out;
  }

  if (facingRight) {
    const tips = ['>', '◦', '>', '~'] as const;
    out[bodyIdx] = line.replace(/>\s*$/u, `${tips[frame] ?? '>'} `);
  } else {
    const tips = ['<', '◦', '<', '~'] as const;
    out[bodyIdx] = line.replace(/^\s*</u, ` ${tips[frame] ?? '<'}`);
  }
  return out;
}

/** @deprecated */
export function applyFoxTail(rows: readonly string[], elapsedMs: number): string[] {
  return applyFishTail(rows, elapsedMs, true);
}

/** Air-stone head — four flicker frames, no solid splash-moon blocks. */
export function resolveAirStoneGlyph(elapsedMs: number, seed: number): readonly string[] {
  const frame = Math.floor((elapsedMs + seed * 40) / 220) % BUBBLE_GLYPHS.length;
  const top = BUBBLE_GLYPHS[frame] ?? 'o';
  return [` ${top} `, '╒═╕', ' ╨ '];
}

/** @deprecated transitional alias */
export function resolveLanternGlyph(elapsedMs: number, seed: number): readonly string[] {
  return resolveAirStoneGlyph(elapsedMs, seed);
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

/** @deprecated */
export function paintRain(
  canvas: string[],
  width: number,
  rows: number,
  elapsedMs: number,
  paintGlyph: (glyph: string, intensity?: number) => string,
): void {
  paintBubbles(canvas, width, rows, elapsedMs, (g, intensity) => paintGlyph(g, intensity));
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

/** @deprecated transitional alias */
export function paintMoonlightPath(
  canvas: string[],
  top: number,
  bandRows: number,
  width: number,
  elapsedMs: number,
  paintCh: (ch: string) => string,
): void {
  paintCausticPath(canvas, top, bandRows, width, elapsedMs, paintCh);
}

export function renderWaterline(width: number, elapsedMs: number): string {
  if (width <= 0) return '';
  const cells: string[] = [];
  for (let x = 0; x < width; x++) {
    const phase = Math.sin(x * 0.28 + elapsedMs / 2_200);
    if (phase > 0.55) cells.push('≈');
    else if (phase > 0.1) cells.push('~');
    else if (phase > -0.35) cells.push('∼');
    else cells.push('·');
  }
  return cells.join('');
}

export function renderSandLine(width: number, elapsedMs: number, rowSeed: number): string {
  if (width <= 0) return '';
  const cells: string[] = [];
  for (let x = 0; x < width; x++) {
    const twinkle = Math.sin(elapsedMs / 2_800 + x * 0.27 + rowSeed) > 0.985;
    const pebble = hash2(x + 3, rowSeed + 11) % 17 === 0;
    if (twinkle) cells.push('·');
    else if (pebble) cells.push('˚');
    else cells.push('.');
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

/** Surface light shafts — thin vertical glints under the waterline. */
export function paintSurfaceLight(
  canvas: string[],
  width: number,
  rows: number,
  elapsedMs: number,
  paintGlyph: (glyph: string, intensity: number) => string,
): void {
  if (width < 32 || rows < 5) return;
  const shafts = Math.max(2, Math.min(4, Math.floor(width / 28)));
  for (let i = 0; i < shafts; i++) {
    const seed = hash2(i * 41 + 9, 113);
    const x = 4 + (seed % Math.max(1, width - 8));
    const len = 2 + (seed % 3);
    const phase = Math.sin(elapsedMs / 1_100 + seed) > 0;
    if (!phase && seed % 3 === 0) continue;
    for (let d = 0; d < len; d++) {
      putCell(canvas, 1 + d, x, width, paintGlyph(d === 0 ? '˚' : '·', 0.55 - d * 0.12));
    }
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

/** Occasional jewel sparkles — premium only, very sparse. */
function paintSparkles(
  canvas: string[],
  width: number,
  rows: number,
  elapsedMs: number,
  paint: (hex: string, text: string) => string,
  hex: string,
): void {
  if (width < 40 || rows < 6) return;
  const count = Math.max(1, Math.floor(width / 40));
  for (let i = 0; i < count; i++) {
    const seed = hash2(i * 53 + 7, 131);
    const period = SPARKLE_MS + (seed % 600);
    const frame = Math.floor((elapsedMs + seed) / (period / 4)) % 4;
    if (frame === 0 || frame === 2) continue; // off / rest — not a hard blink loop
    const x = 2 + (seed % Math.max(1, width - 4));
    const y = 1 + (hash2(i * 19 + 3, 71) % Math.max(1, rows - 3));
    const glyph = frame === 1 ? '·' : '˚';
    putCell(canvas, y, x, width, paint(hex, glyph));
  }
}

type FishColor = 'gold' | 'sky' | 'teal' | 'soft';

interface FishActor {
  readonly kind: 'large' | 'compact' | 'tiny';
  readonly seed: number;
  readonly speed: number;
  readonly baseYRatio: number;
  readonly phase: number;
  readonly color: FishColor;
  readonly goesRight: boolean;
}

function buildSchool(width: number, storyRows: number, premium: boolean): FishActor[] {
  // Curated cast — lead + companions, never a crowd.
  const count = premium ? (width >= 72 ? 3 : 2) : width >= 50 ? 2 : 1;
  const colors: FishColor[] = ['gold', 'sky', 'teal', 'soft'];
  // Staggered depth bands so the lead lane stays readable.
  const bands = [0.22, 0.38, 0.3, 0.48] as const;
  const school: FishActor[] = [];
  for (let i = 0; i < count; i++) {
    const seed = hash2(i * 47 + 11, 203);
    const kind: FishActor['kind'] =
      i === 0 && storyRows >= 7 ? 'large' : i === 1 && storyRows >= 6 ? 'compact' : 'tiny';
    school.push({
      kind,
      seed,
      speed: 0.28 + (seed % 26) / 110 + (i === 0 ? 0.06 : 0),
      baseYRatio: bands[i] ?? 0.34,
      phase: (i * 0.23 + (seed % 200) / 1_000) % 1,
      color: colors[i % colors.length]!,
      goesRight: i % 2 === 0,
    });
  }
  return school;
}

function glyphForSnapshotFish(fish: IdleFish, elapsedMs: number): readonly string[] {
  const t = elapsedMs + fish.seed;
  if (fish.kind === 'large') {
    const base = fish.goesRight ? FISH_LARGE_RIGHT : FISH_LARGE_LEFT;
    return applyFishTail(base, t, fish.goesRight);
  }
  if (fish.kind === 'compact') {
    const base = fish.goesRight ? FISH_COMPACT_RIGHT : FISH_COMPACT_LEFT;
    return applyFishTail(base, t, fish.goesRight);
  }
  const pair = FISH_TINY[fish.seed % FISH_TINY.length] ?? FISH_TINY[0]!;
  return applyFishTail([fish.goesRight ? pair[0] : pair[1]], t, fish.goesRight);
}

function fishColorHex(
  color: IdleFish['color'],
  showAmbient: boolean,
  palette: AquariumPalette,
): string {
  if (!showAmbient) return palette.dim;
  switch (color) {
    case 'gold':
      return palette.fishGold;
    case 'sky':
      return palette.fishSky;
    case 'teal':
      return palette.fishTeal;
    default:
      return palette.fishSoft;
  }
}

function paintFoodFromSnapshot(
  canvas: string[],
  width: number,
  paint: (hex: string, text: string) => string,
  palette: AquariumPalette,
  food: IdleTankSnapshot['food'],
): void {
  for (const pellet of food) {
    putCell(
      canvas,
      Math.trunc(pellet.y),
      Math.trunc(pellet.x),
      width,
      paint(palette.food, '*'),
      true,
    );
  }
}

function paintFishFromSnapshot(
  canvas: string[],
  width: number,
  elapsedMs: number,
  showAmbient: boolean,
  paint: (hex: string, text: string) => string,
  palette: AquariumPalette,
  fish: IdleTankSnapshot['fish'],
): void {
  for (const actor of fish) {
    const hex = fishColorHex(actor.color, showAmbient, palette);
    blitAt(
      canvas,
      glyphForSnapshotFish(actor, elapsedMs).map((line) => paint(hex, line)),
      Math.trunc(actor.y),
      Math.trunc(actor.x),
      width,
    );
  }
}

function glyphForActor(actor: FishActor, elapsedMs: number): readonly string[] {
  const t = elapsedMs + actor.seed;
  if (actor.kind === 'large') {
    const base = actor.goesRight ? FISH_LARGE_RIGHT : FISH_LARGE_LEFT;
    return applyFishTail(base, t, actor.goesRight);
  }
  if (actor.kind === 'compact') {
    const base = actor.goesRight ? FISH_COMPACT_RIGHT : FISH_COMPACT_LEFT;
    return applyFishTail(base, t, actor.goesRight);
  }
  const pair = FISH_TINY[actor.seed % FISH_TINY.length] ?? FISH_TINY[0]!;
  const tip = applyFishTail([actor.goesRight ? pair[0] : pair[1]], t, actor.goesRight);
  return tip;
}

function paintFishSchool(
  canvas: string[],
  width: number,
  storyRows: number,
  elapsedMs: number,
  premium: boolean,
  showAmbient: boolean,
  paint: (hex: string, text: string) => string,
  palette: {
    readonly gold: string;
    readonly sky: string;
    readonly teal: string;
    readonly soft: string;
    readonly dim: string;
  },
): void {
  const school = buildSchool(width, storyRows, premium);
  const floor = Math.max(2, storyRows - 2);

  for (const actor of school) {
    const travel = elapsedMs * 0.001 * actor.speed * 5.6 + actor.phase * width * 2;
    const loop = Math.max(1, width + 16);
    const x = actor.goesRight
      ? Math.floor(travel % loop) - 8
      : width + 8 - Math.floor(travel % loop);
    const bob = Math.sin(elapsedMs / FISH_SWIM_MS + actor.phase * Math.PI * 2) * 0.95;
    const y = Math.max(1, Math.min(floor - 1, Math.floor(actor.baseYRatio * floor + bob)));
    const hex = showAmbient
      ? actor.color === 'gold'
        ? palette.gold
        : actor.color === 'sky'
          ? palette.sky
          : actor.color === 'teal'
            ? palette.teal
            : palette.soft
      : palette.dim;
    blitAt(
      canvas,
      glyphForActor(actor, elapsedMs).map((line) => paint(hex, line)),
      y,
      x,
      width,
    );
  }
}

/** Cool green seaweed forest along the bed. */
function paintSeaweed(
  canvas: string[],
  width: number,
  storyRows: number,
  elapsedMs: number,
  paint: (hex: string, text: string) => string,
  green: string,
  greenSoft: string,
): void {
  if (width < 24 || storyRows < 6) return;
  const spacing = resolveSeaweedSpacing(width);
  const count = Math.max(3, Math.floor((width - 2) / spacing));
  const sandY = storyRows - 1;

  for (let i = 0; i < count; i++) {
    const seed = hash2(i * 31 + 2, 61);
    const x = 1 + i * spacing + ((seed % 3) - 1);
    const frameIdx = Math.floor(elapsedMs / PLANT_SWAY_MS + seed * 0.2) % 4;
    // 2–3 row bushes on the bed — never tall pole stacks.
    const rows = seed % 3 === 0 ? 2 : 3;
    const frames = PLANT_FRAMES.slice(PLANT_FRAMES.length - rows);
    // Prefer solid plant green; soft accent only as a rare tint.
    const hex = seed % 5 === 0 ? greenSoft : green;
    const lines = frames.map((row) => paint(hex, row[frameIdx] ?? ')~)('));
    const top = Math.max(1, sandY - lines.length);
    blitAt(canvas, lines, top, Math.max(0, Math.min(width - 4, x)), width);
  }
}

/** Coral / rock accents resting on the sand. */
function paintCoral(
  canvas: string[],
  width: number,
  storyRows: number,
  elapsedMs: number,
  paint: (hex: string, text: string) => string,
  hex: string,
  soft: string,
): void {
  if (width < 36 || storyRows < 7) return;
  const sandY = storyRows - 1;
  const count = width >= 80 ? 3 : 2;
  for (let i = 0; i < count; i++) {
    const seed = hash2(i * 59 + 13, 97);
    const form = CORAL_FORMS[seed % CORAL_FORMS.length] ?? CORAL_FORMS[0]!;
    const x = 6 + Math.floor(((i + 0.5) / count) * (width - 16)) + ((seed % 5) - 2);
    const color = seed % 2 === 0 ? hex : soft;
    // Tiny shimmer on the crown.
    const lines = [paint(color, form[0] ?? '/\\'), paint(color, form[1] ?? '/__\\')];
    const top = Math.max(1, sandY - lines.length);
    blitAt(canvas, lines, top, Math.max(0, Math.min(width - 6, x)), width);
    // Soft sparkle above the crown — never mutate the silhouette.
    if (Math.sin(elapsedMs / 1_500 + seed) > 0.72) {
      putCell(canvas, top - 1, Math.max(0, Math.min(width - 1, x + 1)), width, paint(soft, '·'));
    }
  }
}

/** Air-stone on the bed with a local bubble plume. */
function paintAirStone(
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
  const x = Math.floor(width * 0.22);
  const glyph = resolveAirStoneGlyph(elapsedMs, seed).map((line) => paint(stone, line));
  blitAt(canvas, glyph, Math.max(1, sandY - glyph.length), x, width);

  // Tight plume above the stone.
  for (let i = 0; i < 3; i++) {
    const pSeed = hash2(i * 17 + 3, seed);
    const period = 1_600 + (pSeed % 900);
    const progress = ((elapsedMs + pSeed * 30) % period) / period;
    const y = sandY - glyph.length - 1 - Math.floor(progress * Math.max(2, storyRows * 0.45));
    const bx = x + 1 + (Math.sin(elapsedMs / 380 + i) > 0 ? 1 : 0);
    const g = BUBBLE_GLYPHS[Math.min(BUBBLE_GLYPHS.length - 1, Math.floor(progress * 3))] ?? 'o';
    putCell(canvas, y, bx, width, paint(progress > 0.6 ? bubble : bubbleSoft, g));
  }
}

/**
 * Paint the Jewel Tank into `canvas[0..storyRows)`.
 *
 * Feeling: clear water, green curtain, coral accents, air-stone plume,
 * a soft caustic band, and a curated fish school.
 */
export function paintIdleStoryScene(options: {
  readonly canvas: string[];
  readonly width: number;
  readonly storyRows: number;
  readonly elapsedMs: number;
  readonly showAmbient: boolean;
  readonly premium: boolean;
  readonly paint: (hex: string, text: string) => string;
  readonly colors: IdleSceneColors;
  readonly themeMode?: 'dark' | 'light';
  readonly sim?: IdleTankSnapshot;
}): void {
  const {
    canvas,
    width,
    storyRows,
    elapsedMs,
    showAmbient,
    premium,
    paint,
    colors,
    themeMode = 'dark',
    sim,
  } = options;
  if (width <= 0 || storyRows <= 0) return;

  const palette = resolveAquariumPalette(colors, themeMode);

  // Mid-water stays blank (open water); helpers like paintWaterBase remain unused here.

  // 1) Surface line — sky water (glow), not a deep/green-leaning token
  if (storyRows >= 4) {
    canvas[0] = padOrTrim(
      paint(showAmbient ? palette.water : colors.textMuted, renderWaterline(width, elapsedMs)),
      width,
    );
  }

  // 2) Warm sand bed
  const sandY = storyRows - 1;
  if (sandY > 0) {
    canvas[sandY] = padOrTrim(paint(palette.sand, renderSandLine(width, elapsedMs, 1)), width);
  }

  // 3) Seaweed curtain
  if (showAmbient) {
    paintSeaweed(canvas, width, storyRows, elapsedMs, paint, palette.plant, palette.plantSoft);
  }

  // 4) Quiet rising bubbles (tank-wide)
  if (showAmbient) {
    paintBubbles(canvas, width, Math.max(1, storyRows - 1), elapsedMs, (glyph, intensity) =>
      paint(intensity > 0.7 ? palette.bubble : colors.textMuted, glyph),
    );
  }

  // 5) Fish + food — snapshot when provided, patrol school as fallback
  if (sim) {
    paintFoodFromSnapshot(canvas, width, paint, palette, sim.food);
    paintFishFromSnapshot(canvas, width, elapsedMs, showAmbient, paint, palette, sim.fish);
  } else {
    paintFishSchool(canvas, width, storyRows, elapsedMs, premium, showAmbient, paint, {
      gold: palette.fishGold,
      sky: palette.fishSky,
      teal: palette.fishTeal,
      soft: palette.fishSoft,
      dim: palette.dim,
    });
  }
}
