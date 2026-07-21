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
  mixHexColor,
  styleToAnsi,
  truncateToWidth,
  visibleWidth,
  type RendererCell,
} from '#/tui/renderer';

import type { IdleFish, IdleTankFx, IdleTankSnapshot } from '#/tui/utils/idle-tank-sim';

/**
 * Ornamental school — multi-row silhouettes with dorsal/ventral fins.
 * Large ≈ clownfish (3-row with flowing fins). Compact ≈ betta (2-row).
 * Tiny ≈ neon danios (single-row darts).
 */
export const FISH_LARGE_RIGHT = [
  '  /~\\  ',
  '>═((º═>',
  '  \\~/  ',
] as const;

/** Lead fish — left (3-row). */
export const FISH_LARGE_LEFT = [
  '  /~\\  ',
  '<═º))═<',
  '  \\~/  ',
] as const;

/** Mid-size betta companion — right (2-row with dorsal crest). */
export const FISH_COMPACT_RIGHT = [
  ' .~~. ',
  '>∽((º≈',
] as const;

/** Mid-size betta companion — left (2-row). */
export const FISH_COMPACT_LEFT = [
  ' .~~. ',
  '≈º))∽<',
] as const;

/** Tiny neon danios (right / left pairs). */
export const FISH_TINY = [
  ['>◦≡>', '<≡◦<'],
  ['>º≡>', '<≡º<'],
  ['>◦~>', '<~◦<'],
] as const;

/**
 * Jellyfish — pulsing bell with trailing tentacles (3 rows).
 * Adds vertical movement and bioluminescent glow to the mid-water column.
 */
export const JELLYFISH_FRAMES = [
  [' .oOo. ', ' )~~~( ', '  )|(| '],
  [' .oOo. ', ' )~~~( ', '  |)|  '],
  ['  oOo  ', '  )~(  ', '  )|(  '],
  [' .oOo. ', ' )~~~( ', '  )|(| '],
] as const;

/** Seahorse — slow drift, curled tail (3 rows). */
export const SEAHORSE_FRAMES = [
  [' .o. ', ' (º) ', '  )~ '],
  [' .o. ', ' (º) ', '  ~( '],
  [' .o. ', ' (º) ', '  )~ '],
  [' .o. ', ' (º) ', '  ~( '],
] as const;

/**
 * Aquascape plant kits — each row is 4 sway frames.
 * Carpet / fine bush / broad mid / tall sword. Avoid bamboo `|` poles.
 */
export const PLANT_CARPET = [['.,.~', '~.,.', '.,.~', '~.,.']] as const;

/** Fluffy fine-leaf bush (hornwort / milfoil). */
export const PLANT_BUSH = [
  [' )~) ', ' (~( ', ' )~) ', ' (~( '],
  [')~)~(', '(~(~)', ')~)~(', '(~(~)'],
  [')~~)(', '(~~(~)', ')~~)(', '(~~(~)'],
] as const;

/** Broad mid leaves near the hardscape (anubias-ish). */
export const PLANT_BROAD = [
  ['  ,  ', '  .  ', '  ,  ', '  .  '],
  [' )u( ', ' (n) ', ' )u( ', ' (n) '],
  ['(_)_ ', '(_)( ', '(_)_ ', '(_)( '],
] as const;

/** Tall sword / java-fern leaves — right bank hero (8-row grand sword). */
export const PLANT_TALL = [
  ['   )   ', '   (   ', '   )   ', '   (   '],
  ['   )   ', '   (   ', '   )   ', '   (   '],
  ['  )/   ', '  \\(  ', '  )/   ', '  \\(  '],
  ['  )~(  ', '  (~)  ', '  )~(  ', '  (~)  '],
  [' )~)~( ', ' (~(~) ', ' )~)~( ', ' (~(~) '],
  [' )~~)( ', ' (~~(~ ', ' )~~)( ', ' (~~(~ '],
  ['(~)~~( ', '~(~)~) ', '(~)~~( ', '~(~)~) '],
  ['(~)~~(~', '~(~)~~)', '(~)~~(~', '~(~)~~)'],
] as const;

/** Slim stem plant for a single magenta/red accent (taller). */
export const PLANT_STEM = [
  ['   )   ', '   (   ', '   )   ', '   (   '],
  ['  )|(  ', '  (|\\ ', '  )|(  ', '  (/|  '],
  ['  )~(  ', '  (~)  ', '  )~(  ', '  (~)  '],
  [' )~)~( ', ' (~(~) ', ' )~)~( ', ' (~(~) '],
  ['(~)~(~ ', '~(~)~) ', '(~)~(~ ', '~(~)~) '],
] as const;

/** Tall grass / vallisneria — flowing ribbon leaves for left bank. */
export const PLANT_GRASS = [
  ['  |  ', '  |  ', '  |  ', '  |  '],
  ['  )  ', '  (  ', '  )  ', '  (  '],
  [' )~  ', ' (~  ', ' )~  ', ' (~  '],
  [' )~) ', ' (~( ', ' )~) ', ' (~( '],
  ['(~)~ ', '~(~) ', '(~)~ ', '~(~) '],
] as const;

const ANSI_RESET = '\u001B[0m';

/** Centerpiece rock — warm hardscape mass, not coral theatre. */
export const ROCK_FORMS = [
  ['   /¯\\/¯\\  ', '  //¯¯¯\\\\  ', ' /_______\\ '],
  ['    /¯¯\\   ', '   /||||\\  ', '  /______\\ '],
  ['   /\\/\\    ', '  /____\\   '],
] as const;

export const BUBBLE_GLYPHS = ['·', 'o', '°', '○'] as const;

export const FISH_SWIM_MS = 4_200;
export const FISH_TAIL_MS = 360;
export const BUBBLE_STEP_MS = 170;
export const PLANT_SWAY_MS = 2_400;
export const CAUSTIC_DRIFT_MS = 55;

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
  while (cells.length < width) {
    const prev = cells[cells.length - 1];
    const bg = prev?.style?.bg;
    cells.push(bg === undefined ? { char: ' ' } : { char: ' ', style: { bg } });
  }
  return cells.slice(0, width);
}

/** Serialize cells back to ANSI without stripping neighboring styles. */
function cellsToAnsiLine(cells: readonly RendererCell[]): string {
  const out: string[] = [];
  let activeFg: string | undefined;
  let activeBg: string | undefined;
  for (const cell of cells) {
    const fg = cell.style?.fg;
    const bg = cell.style?.bg;
    if (fg !== activeFg || bg !== activeBg) {
      if (fg === undefined && bg === undefined) {
        out.push(ANSI_RESET);
      } else {
        out.push(styleToAnsi({
          ...(fg !== undefined ? { fg } : {}),
          ...(bg !== undefined ? { bg } : {}),
        }));
      }
      activeFg = fg;
      activeBg = bg;
    }
    out.push(cell.char.length === 0 ? ' ' : cell.char);
  }
  if (activeFg !== undefined || activeBg !== undefined) out.push(ANSI_RESET);
  return out.join('');
}

/**
 * While {@link paintIdleStoryScene} runs, painters write into this cell layer
 * and skip per-put ANSI expand/serialize. Flushed once at the end of the scene.
 */
let storyCellRows: RendererCell[][] | undefined;
let storyAnsiCanvas: string[] | undefined;

function beginStoryCellSession(canvas: string[], storyRows: number, width: number): void {
  storyAnsiCanvas = canvas;
  storyCellRows = Array.from({ length: storyRows }, () =>
    Array.from({ length: width }, () => ({ char: ' ' })),
  );
}

function flushStoryCellSession(storyRows: number): void {
  if (storyCellRows === undefined || storyAnsiCanvas === undefined) return;
  for (let y = 0; y < storyRows; y++) {
    const row = storyCellRows[y];
    if (row !== undefined) storyAnsiCanvas[y] = cellsToAnsiLine(row);
  }
  storyCellRows = undefined;
  storyAnsiCanvas = undefined;
}

function inStoryCellSession(canvas: string[]): boolean {
  return storyCellRows !== undefined && storyAnsiCanvas === canvas;
}

const waterCellStyleCache = new Map<string, RendererCell>();

function waterCell(char: string, fg: string | undefined, bg: string): RendererCell {
  const key = `${char}\0${fg ?? ''}\0${bg}`;
  const hit = waterCellStyleCache.get(key);
  if (hit !== undefined) return hit;
  const cell: RendererCell =
    fg === undefined
      ? { char, style: { bg } }
      : { char, style: { fg, bg } };
  waterCellStyleCache.set(key, cell);
  if (waterCellStyleCache.size > 768) {
    let drop = Math.floor(waterCellStyleCache.size / 2);
    for (const k of waterCellStyleCache.keys()) {
      waterCellStyleCache.delete(k);
      if (--drop <= 0) break;
    }
  }
  return cell;
}

type WaterDepthCacheEntry = {
  readonly key: string;
  readonly rows: readonly (readonly RendererCell[])[];
};

let waterDepthCache: WaterDepthCacheEntry | undefined;

type SurfaceBandCacheEntry = {
  readonly key: string;
  readonly waterline: readonly RendererCell[];
  readonly sand: readonly RendererCell[];
};

let surfaceBandCache: SurfaceBandCacheEntry | undefined;

/** Test helper — drop jewel-tank paint caches. */
export function resetIdleScenePaintCachesForTests(): void {
  waterDepthCache = undefined;
  surfaceBandCache = undefined;
  waterCellStyleCache.clear();
  storyCellRows = undefined;
  storyAnsiCanvas = undefined;
}

function cloneCellRow(row: readonly RendererCell[]): RendererCell[] {
  return row.slice();
}

export function blitAt(
  canvas: string[],
  lines: readonly string[],
  top: number,
  left: number,
  width: number,
): void {
  const safeLeft = Math.max(0, Math.trunc(left));
  const cellSession = inStoryCellSession(canvas);
  for (let i = 0; i < lines.length; i++) {
    const y = top + i;
    if (y < 0 || y >= canvas.length) continue;
    const line = lines[i];
    if (line === undefined) continue;
    if (safeLeft >= width) continue;
    const cells = cellSession
      ? storyCellRows![y]!
      : expandLineCells(canvas[y] ?? ' '.repeat(width), width);
    const glyphCells = expandLineCells(line, Math.max(1, visibleWidth(line)));
    const fit = Math.min(glyphCells.length, width - safeLeft);
    for (let x = 0; x < fit; x++) {
      const glyph = glyphCells[x];
      if (glyph === undefined) continue;
      // Skip fully transparent padding so we don't wipe underlying water/plants.
      if (glyph.char === ' ' && glyph.style?.fg === undefined && glyph.style?.bg === undefined) {
        continue;
      }
      // Keep water background under glyphs that only set foreground — including
      // chalk-colored plant padding spaces (`fg` set, `bg` absent). Those used
      // to overwrite mid-water with unstyled cells that inherited canvas black.
      const under = cells[safeLeft + x];
      if (glyph.style?.bg === undefined && under?.style?.bg !== undefined) {
        cells[safeLeft + x] = {
          ...glyph,
          style: { ...glyph.style, bg: under.style.bg },
        };
      } else {
        cells[safeLeft + x] = glyph;
      }
    }
    if (!cellSession) canvas[y] = cellsToAnsiLine(cells);
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
  /** Deepest water / abyss tint for volume. */
  readonly waterAbyss: string;
  readonly plant: string;
  readonly plantSoft: string;
  /** Occasional red/magenta tip plants. */
  readonly plantAccent: string;
  readonly sand: string;
  readonly coral: string;
  readonly coralSoft: string;
  readonly food: string;
  readonly fishGold: string;
  readonly fishSky: string;
  readonly fishTeal: string;
  readonly fishSoft: string;
  readonly bubble: string;
  /** Warm surface shaft / caustic light. */
  readonly shaft: string;
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
  /** Dark aquasoil / gravel. */
  readonly surfaceSunken?: string;
};

/**
 * Jewel-tank paint kit — fish/plants stay vivid; water wash stays subdued so
 * the stage canvas does not read as a solid cyan slab.
 */
export const JEWEL_TANK_DARK = {
  water: '#4A7FA0',
  waterSoft: '#2A4F68',
  waterDeep: '#123044',
  waterAbyss: '#0A1420',
  plant: '#2EFF7A',
  plantSoft: '#A8FF4A',
  plantAccent: '#FF2E9A',
  sand: '#14100C',
  sandGlint: '#D4A574',
  coral: '#F0A84A',
  coralSoft: '#A86B28',
  food: '#FFD60A',
  fishGold: '#FF6A00',
  fishSky: '#3B6CFF',
  fishTeal: '#00E5A8',
  fishSoft: '#FF5EC8',
  bubble: '#8AB8C8',
  shaft: '#C4B87A',
  highlight: '#FFFFFF',
  ink: '#0A0E14',
  dim: '#5A6578',
} as const;

export const JEWEL_TANK_LIGHT = {
  water: '#4B7A8F',
  waterSoft: '#3A6478',
  waterDeep: '#2A4A5C',
  waterAbyss: '#1E3340',
  plant: '#16A34A',
  plantSoft: '#65A30D',
  plantAccent: '#DB2777',
  sand: '#292524',
  sandGlint: '#A16207',
  coral: '#D97706',
  coralSoft: '#92400E',
  food: '#CA8A04',
  fishGold: '#EA580C',
  fishSky: '#2563EB',
  fishTeal: '#0D9488',
  fishSoft: '#DB2777',
  bubble: '#67A8B8',
  shaft: '#C4B06A',
  highlight: '#FFFFFF',
  ink: '#1C1917',
  dim: '#78716C',
} as const;

/**
 * Resolve aquarium paint roles: jewel kit as structure, current theme colors as
 * strong tint so red / blue / cyan chrome all retint the tank together.
 */
export function resolveAquariumPalette(
  colors: IdleSceneColors,
  theme: 'dark' | 'light' = 'dark',
): AquariumPalette {
  const jewel = theme === 'light' ? JEWEL_TANK_LIGHT : JEWEL_TANK_DARK;
  const gStart = colors.gradientStart ?? colors.glow;
  const gEnd = colors.gradientEnd ?? colors.primary;
  const plantTheme = colors.success ?? colors.accent;
  const sunken = colors.surfaceSunken ?? jewel.waterAbyss;
  const warm = colors.roleUser ?? colors.primary;
  const cool = colors.shellMode ?? colors.glow;

  return {
    // Water wash — theme glow/primary/gradient dominate; keeps depth quiet.
    water: mixHexColor(jewel.water, colors.glow, 0.62),
    waterSoft: mixHexColor(jewel.waterSoft, colors.primary, 0.55),
    waterDeep: mixHexColor(jewel.waterDeep, gStart, 0.52),
    waterAbyss: mixHexColor(jewel.waterAbyss, mixHexColor(sunken, gStart, 0.18), 0.62),
    // Plants follow theme success/accent while staying leafy.
    plant: mixHexColor(jewel.plant, plantTheme, 0.55),
    plantSoft: mixHexColor(jewel.plantSoft, colors.accent, 0.48),
    plantAccent: mixHexColor(jewel.plantAccent, colors.accent, 0.45),
    sand: mixHexColor(jewel.sand, sunken, 0.7),
    coral: mixHexColor(jewel.coral, warm, 0.42),
    coralSoft: mixHexColor(jewel.coralSoft, warm, 0.35),
    food: mixHexColor(jewel.food, warm, 0.3),
    fishGold: mixHexColor(jewel.fishGold, warm, 0.38),
    fishSky: mixHexColor(jewel.fishSky, colors.primary, 0.5),
    fishTeal: mixHexColor(jewel.fishTeal, cool, 0.48),
    fishSoft: mixHexColor(jewel.fishSoft, colors.accent, 0.42),
    bubble: mixHexColor(jewel.bubble, colors.particle, 0.55),
    shaft: mixHexColor(jewel.shaft, gEnd, 0.4),
    dim: mixHexColor(jewel.dim, colors.textDim, 0.55),
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
  const cellSession = inStoryCellSession(canvas);
  const cells = cellSession
    ? storyCellRows![y]!
    : expandLineCells(canvas[y] ?? ' '.repeat(width), width);
  const here = cells[x]?.char ?? ' ';
  if (!force && !SOFT_CELLS.has(here)) return;
  const painted = expandLineCells(glyph, 1)[0] ?? { char: stripAnsi(glyph).slice(0, 1) || ' ' };
  const under = cells[x];
  cells[x] =
    painted.style?.bg === undefined && under?.style?.bg !== undefined
      ? { ...painted, style: { ...painted.style, bg: under.style.bg } }
      : painted;
  if (!cellSession) canvas[y] = cellsToAnsiLine(cells);
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

/** Soft cheek / fin pulse — ≥4 frames, never a hard blink. Multi-row aware. */
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

  // Clownfish — cheek / stripe pulse (fixed width).
  if (line.includes('═((º═>') || line.includes('<═º))═') || line.includes('═(º═>') || line.includes('═((º≈>')) {
    const cheeks = facingRight
      ? (['>═((º═>', '>═(º═> ', '>═((º═>', '>═((º≈>'] as const)
      : (['<═º))═<', '<═º)═< ', '<═º))═<', '<≈º))═<'] as const);
    out[bodyIdx] = cheeks[frame] ?? cheeks[0]!;
    // Animate dorsal/ventral fin rows with subtle wave.
    const finFrames = ['  /~\\  ', '  /~\\  ', '  /~~\\ ', '  /~\\  '] as const;
    const finFramesB = ['  \\~/  ', '  \\~~/ ', '  \\~/  ', '  \\~/  '] as const;
    if (bodyIdx > 0 && out[bodyIdx - 1] !== undefined && /[\\/]/.test(out[bodyIdx - 1]!)) {
      out[bodyIdx - 1] = finFrames[frame] ?? finFrames[0]!;
    }
    if (bodyIdx + 1 < out.length && out[bodyIdx + 1] !== undefined && /[\\/]/.test(out[bodyIdx + 1]!)) {
      out[bodyIdx + 1] = finFramesB[frame] ?? finFramesB[0]!;
    }
    return out;
  }

  // Betta flowing fins (2-row: crest + body).
  if (line.includes('∽((º') || line.includes('º))∽')) {
    const fins = facingRight
      ? (['∽((º≈', '∼((º≈', '∽((º∼', '≈((º∽'] as const)
      : (['≈º))∽', '∼º))∽', '∽º))∼', '∽º))≈'] as const);
    out[bodyIdx] = fins[frame] ?? fins[0]!;
    // Dorsal crest wave.
    const crestFrames = [' .~~. ', ' .~~. ', '  .~. ', ' .~~. '] as const;
    if (bodyIdx > 0 && out[bodyIdx - 1] !== undefined && /[.~]/.test(out[bodyIdx - 1]!)) {
      out[bodyIdx - 1] = crestFrames[frame] ?? crestFrames[0]!;
    }
    return out;
  }

  // Tiny neon tip flick.
  if (facingRight) {
    const tips = ['>', '◦', '>', '~'] as const;
    out[bodyIdx] = line.replace(/>\s*$/u, tips[frame] ?? '>');
  } else {
    const tips = ['<', '◦', '<', '~'] as const;
    out[bodyIdx] = line.replace(/^\s*</u, tips[frame] ?? '<');
  }
  return out;
}

/**
 * Per-cell ornamental shading — punchy bands, fin accents, specular highlight.
 * Clownfish / betta / neon lighting with bold jewel hues (not theme-muted).
 * Handles multi-row fish: fin rows (top/bottom) get translucent fin coloring.
 */
export function colorizeFishLine(
  line: string,
  kind: 'large' | 'compact' | 'tiny',
  color: 'gold' | 'sky' | 'teal' | 'soft',
  facingRight: boolean,
  palette: AquariumPalette,
  paint: (hex: string, text: string) => string,
  showAmbient: boolean,
  isFinRow = false,
): string {
  if (!showAmbient) return paint(palette.dim, line);

  const body =
    color === 'gold'
      ? palette.fishGold
      : color === 'sky'
        ? palette.fishSky
        : color === 'teal'
          ? palette.fishTeal
          : palette.fishSoft;
  const hot =
    color === 'gold'
      ? mixHexColor(body, '#FFE08A', 0.55)
      : color === 'sky'
        ? mixHexColor(body, '#A5F3FC', 0.45)
        : mixHexColor(body, '#FFFFFF', 0.4);
  const stripe = color === 'gold' || color === 'teal' ? '#FFFFFF' : mixHexColor(body, '#FFFFFF', 0.85);
  const shade = mixHexColor(body, '#1A0A08', 0.42);
  const ink = '#0A0E14';
  const finAccent =
    color === 'gold'
      ? mixHexColor(body, '#FF2E9A', 0.25)
      : color === 'sky'
        ? '#FF2E9A'
        : mixHexColor(palette.plantAccent, '#FFFFFF', 0.2);
  const nose = mixHexColor(body, ink, 0.35);
  const rim = mixHexColor(hot, '#FFFFFF', 0.35);

  // Fin rows (dorsal/ventral) — translucent flowing fin color.
  if (isFinRow) {
    const finHex = mixHexColor(body, finAccent, 0.55);
    const finTip = mixHexColor(finHex, '#FFFFFF', 0.3);
    let out = '';
    for (let i = 0; i < line.length; i++) {
      const ch = line[i]!;
      if (ch === ' ') { out += ' '; continue; }
      const isEdge = ch === '/' || ch === '\\';
      out += paint(isEdge ? finTip : finHex, ch);
    }
    return out;
  }

  let bodySeen = 0;
  let out = '';
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]!;
    if (ch === ' ') {
      out += ' ';
      continue;
    }

    let hex = body;
    if (ch === '═' || ch === '≡') {
      hex = stripe;
    } else if (ch === 'º' || ch === '◦') {
      // Eye: ink with a tiny catchlight feel via bright neighbor context.
      hex = ink;
    } else if (ch === '≈' || ch === '∽' || ch === '∼' || ch === '~') {
      hex = kind === 'compact' || kind === 'tiny' ? finAccent : shade;
    } else if (ch === '(' || ch === ')') {
      bodySeen += 1;
      hex = bodySeen <= 1 ? hot : bodySeen >= 3 ? shade : body;
    } else if (ch === '>' || ch === '<') {
      const atNose = facingRight ? i === line.length - 1 : i === 0;
      const atTail = facingRight ? i === 0 : i === line.length - 1;
      if (atNose) hex = nose;
      else if (atTail) hex = kind === 'compact' ? finAccent : shade;
      else hex = rim;
    } else if (ch === '.' && kind === 'compact') {
      // Betta crest dots.
      hex = finAccent;
    }

    out += paint(hex, ch);
  }
  return out;
}

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
const IDLE_SURFACE_MOTION_QUANTUM_MS = 96;

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
      storyCellRows![y] = cloneCellRow(row);
    } else {
      canvas[y] = cellsToAnsiLine(row);
    }
  }
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
    const glyphLines = glyphForSnapshotFish(actor, elapsedMs);
    const bodyIdx = glyphLines.findIndex((l) => /[<>]/.test(l));
    const lines = glyphLines.map((line, rowIdx) => {
      const isFin = bodyIdx >= 0 && rowIdx !== bodyIdx && !/[<>]/.test(line);
      return colorizeFishLine(line, actor.kind, actor.color, actor.goesRight, palette, paint, showAmbient, isFin);
    });
    blitAt(canvas, lines, Math.trunc(actor.y), Math.trunc(actor.x), width);
  }
}

function glyphForFx(fx: IdleTankFx): string {
  const lifeT = Math.max(0, Math.min(1, fx.life / Math.max(1, fx.maxLife)));
  if (fx.kind === 'bubble') {
    if (lifeT > 0.72) return '·';
    if (lifeT > 0.4) return 'o';
    return lifeT > 0.18 ? '°' : 'O';
  }
  if (fx.kind === 'sand') {
    return lifeT > 0.5 ? '˙' : '.';
  }
  // spark — eat celebration
  if (lifeT > 0.7) return '♥';
  if (lifeT > 0.4) return '✦';
  if (lifeT > 0.2) return '˚';
  return '·';
}

function colorForFx(fx: IdleTankFx, palette: AquariumPalette): string {
  const lifeT = Math.max(0, Math.min(1, fx.life / Math.max(1, fx.maxLife)));
  if (fx.kind === 'bubble') {
    return lifeT > 0.45
      ? mixHexColor(palette.bubble, palette.shaft, 0.35)
      : mixHexColor(palette.bubble, palette.water, 0.4);
  }
  if (fx.kind === 'sand') {
    return mixHexColor(palette.coral, palette.sand, 0.35 + (1 - lifeT) * 0.35);
  }
  return lifeT > 0.55
    ? mixHexColor(palette.food, palette.plantAccent, 0.45)
    : mixHexColor(palette.shaft, palette.food, 0.4);
}

function paintFxFromSnapshot(
  canvas: string[],
  width: number,
  paint: (hex: string, text: string) => string,
  palette: AquariumPalette,
  fx: IdleTankSnapshot['fx'],
): void {
  for (const particle of fx) {
    putCell(
      canvas,
      Math.trunc(particle.y),
      Math.trunc(particle.x),
      width,
      paint(colorForFx(particle, palette), glyphForFx(particle)),
      true,
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
  palette: AquariumPalette,
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
    const glyphLines = glyphForActor(actor, elapsedMs);
    const bodyIdx = glyphLines.findIndex((l) => /[<>]/.test(l));
    const lines = glyphLines.map((line, rowIdx) => {
      const isFin = bodyIdx >= 0 && rowIdx !== bodyIdx && !/[<>]/.test(line);
      return colorizeFishLine(line, actor.kind, actor.color, actor.goesRight, palette, paint, showAmbient, isFin);
    });
    blitAt(canvas, lines, y, x, width);
  }
}

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
function paintSeaweed(
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
function paintCoral(
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

/**
 * Paint the Jewel Tank into `canvas[0..storyRows)`.
 *
 * Aquascape: sky surface, open mid-water, planted bed, rocks, left aerator,
 * fish + optional click-dropped food.
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
  beginStoryCellSession(canvas, storyRows, width);

  try {
    const motionMs =
      Math.floor(Math.max(0, elapsedMs) / IDLE_SURFACE_MOTION_QUANTUM_MS) *
      IDLE_SURFACE_MOTION_QUANTUM_MS;

    // 1) Surface line — muted water wash (not an electric cyan banner)
    if (storyRows >= 4) {
      if (!showAmbient) {
        canvas[0] = padOrTrim(paint(colors.textMuted, renderWaterline(width, elapsedMs)), width);
        // Still seed the cell layer so later flush keeps row 0 consistent.
        const muted = expandLineCells(canvas[0]!, width);
        storyCellRows![0] = muted;
      } else {
        const band = resolveSurfaceBandCells(width, motionMs, palette);
        storyCellRows![0] = cloneCellRow(band.waterline);
      }
    }

    // 2) Dark gravel bed with warm light glints (2-row substrate)
    const sandY = storyRows - 1;
    if (sandY > 0) {
      if (showAmbient) {
        const band = resolveSurfaceBandCells(width, motionMs, palette);
        storyCellRows![sandY] = cloneCellRow(band.sand);
        // Upper substrate row: smaller pebbles, shell fragments, debris.
        if (sandY > 1) {
          const upperBed = renderSandLine(width, motionMs, 47);
          const upperSand: RendererCell[] = [];
          for (const ch of upperBed) {
            const isGlint = ch === '˚';
            const hex = isGlint
              ? mixHexColor(palette.coral, palette.shaft, 0.35)
              : mixHexColor(palette.sand, palette.waterAbyss, 0.45);
            const fg = isGlint
              ? mixHexColor(palette.shaft, '#FFF7ED', 0.5)
              : mixHexColor(hex, palette.waterDeep, 0.3);
            upperSand.push(waterCell(ch === 'o' ? '.' : ch === ':' ? '˙' : ch, fg, hex));
          }
          storyCellRows![sandY - 1] = upperSand;
        }
      } else {
        const bed = renderSandLine(width, elapsedMs, 1);
        let sandPainted = '';
        for (const ch of bed) {
          const hex =
            ch === '˚' ? mixHexColor(palette.coral, palette.shaft, 0.45) : palette.sand;
          sandPainted += `${styleToAnsi({
            fg: mixHexColor(hex, '#FFF7ED', 0.4),
            bg: hex,
          })}${ch}${ANSI_RESET}`;
        }
        canvas[sandY] = sandPainted;
        storyCellRows![sandY] = expandLineCells(sandPainted, width);
      }
    }

    // 3) Quiet mid-water volume (abyss wash — not neon sky fill)
    if (showAmbient) {
      paintWaterDepth(
        canvas,
        width,
        storyRows,
        paint,
        palette.water,
        palette.waterSoft,
        palette.waterDeep,
        palette.waterAbyss,
      );
    }

    // 4) Volumetric light cones (wide beams from surface)
    if (showAmbient && premium) {
      paintVolumetricLight(
        canvas,
        width,
        storyRows,
        elapsedMs,
        paint,
        palette.shaft,
        mixHexColor(palette.water, palette.bubble, 0.4),
      );
    }

    // 5) Surface god-rays + warm caustic ribbon
    if (showAmbient && premium) {
      paintSurfaceLight(
        canvas,
        width,
        storyRows,
        elapsedMs,
        paint,
        palette.shaft,
        mixHexColor(palette.water, palette.bubble, 0.4),
      );
    }

    // 6) Floating plankton / detritus motes in the water column
    if (showAmbient) {
      paintPlankton(canvas, width, storyRows, elapsedMs, paint, palette);
    }

    // 7) Plants first (carpet / banks / stem)
    if (showAmbient) {
      paintSeaweed(
        canvas,
        width,
        storyRows,
        elapsedMs,
        paint,
        palette.plant,
        palette.plantSoft,
        palette.plantAccent,
        mixHexColor(palette.waterDeep, palette.sand, 0.55),
      );
    }

    // 8) Centerpiece rock on top so hardscape stays readable
    if (showAmbient && premium) {
      paintCoral(
        canvas,
        width,
        storyRows,
        elapsedMs,
        paint,
        palette.coral,
        palette.coralSoft,
        palette.sand,
      );
    }

    // 9) Left filter + bubble column (bright jewel bubbles)
    if (showAmbient && premium) {
      paintAirStone(
        canvas,
        width,
        storyRows,
        elapsedMs,
        paint,
        mixHexColor(palette.dim, palette.waterDeep, 0.35),
        palette.bubble,
        mixHexColor(palette.bubble, palette.water, 0.4),
      );
    }

    // 10) Jellyfish — bioluminescent drifters in the mid-water column
    if (showAmbient && premium) {
      paintJellyfish(canvas, width, storyRows, elapsedMs, paint, palette);
    }

    // 11) Seahorse — accent creature near the right plant bank
    if (showAmbient && premium) {
      paintSeahorse(canvas, width, storyRows, elapsedMs, paint, palette);
    }

    // 12) Fish + food + interactive physics FX
    if (sim) {
      paintFoodFromSnapshot(canvas, width, paint, palette, sim.food);
      paintFishFromSnapshot(canvas, width, elapsedMs, showAmbient, paint, palette, sim.fish);
      paintFxFromSnapshot(canvas, width, paint, palette, sim.fx);
    } else {
      paintFishSchool(canvas, width, storyRows, elapsedMs, premium, showAmbient, paint, palette);
    }
  } finally {
    flushStoryCellSession(storyRows);
  }
}

function resolveSurfaceBandCells(
  width: number,
  motionMs: number,
  palette: AquariumPalette,
): SurfaceBandCacheEntry {
  const key = `${width}|${motionMs}|${palette.water}|${palette.waterSoft}|${palette.waterDeep}|${palette.waterAbyss}|${palette.sand}|${palette.shaft}|${palette.coral}|${palette.bubble}`;
  if (surfaceBandCache?.key === key) return surfaceBandCache;

  const line = renderWaterline(width, motionMs);
  const wash = mixHexColor(palette.waterAbyss, palette.waterDeep, 0.55);
  const waterline: RendererCell[] = [];
  for (let x = 0; x < line.length; x++) {
    const ch = line[x]!;
    const hex =
      ch === '≈'
        ? mixHexColor(wash, palette.shaft, 0.2)
        : ch === '~'
          ? mixHexColor(wash, palette.water, 0.35)
          : mixHexColor(wash, palette.waterSoft, 0.25);
    waterline.push(waterCell(ch, mixHexColor(palette.water, palette.bubble, 0.35), hex));
  }

  const bed = renderSandLine(width, motionMs, 1);
  const sand: RendererCell[] = [];
  for (const ch of bed) {
    const hex = ch === '˚' ? mixHexColor(palette.coral, palette.shaft, 0.45) : palette.sand;
    sand.push(waterCell(ch, mixHexColor(hex, '#FFF7ED', 0.4), hex));
  }

  surfaceBandCache = { key, waterline, sand };
  return surfaceBandCache;
}
