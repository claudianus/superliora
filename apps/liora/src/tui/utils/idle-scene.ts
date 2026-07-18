/**
 * Empty-transcript idle scene — "Peaceful Aquarium".
 *
 * A calm tank of living fish: soft water shimmer, swaying plants, rising
 * bubbles, and several fish that swim on independent paths. Deliberately
 * separate from splash Blood Moon language (no solid █ moon blocks).
 */

import { truncateToWidth, visibleWidth } from '#/tui/renderer';

/** Large tropical fish (5 rows) — facing right. */
export const FISH_LARGE_RIGHT = [
  '  ,--.     ',
  ' <° )))><  ',
  '  `--´     ',
  '    ~      ',
  '           ',
] as const;

/** Large tropical fish (5 rows) — facing left. */
export const FISH_LARGE_LEFT = [
  '     ,--.  ',
  '  ><((( °> ',
  '     `´--  ',
  '      ~    ',
  '           ',
] as const;

/** Compact fish (3 rows) — facing right. */
export const FISH_COMPACT_RIGHT = [
  '  ,-.  ',
  ' <°)>< ',
  '  `-´  ',
] as const;

/** Compact fish (3 rows) — facing left. */
export const FISH_COMPACT_LEFT = [
  '  ,-.  ',
  ' ><(°> ',
  '  `-´  ',
] as const;

/** Tiny fish glyph pairs [right, left]. */
export const FISH_TINY = [
  ['><>', '<><'],
  ['>°>', '<°<'],
  ['>~>', '<~<'],
  ['›·›', '‹·‹'],
] as const;

/** Tall plant (seaweed) frames for sway. */
export const PLANT_TALL = [
  ['  )  ', '  (  ', '  )  ', '  (  '],
  [' )(  ', ' )(  ', ' ( ) ', ' ( ) '],
  [' )(  ', ' )(  ', ' )(  ', ' )(  '],
  [' )|( ', ' (| )', ' )|( ', ' (| )'],
  ['  |  ', '  |  ', '  |  ', '  |  '],
] as const;

/** Short plant clump. */
export const PLANT_SHORT = [
  [' )( ', ' ( )', ' )( ', ' ( )'],
  [' )| ', ' (| ', ' )| ', ' (| '],
  ['  | ', '  | ', '  | ', '  | '],
] as const;

/** Small rock / castle silhouette on the sand. */
export const ROCK_CASTLE = [
  '  /\\  ',
  ' /||\\ ',
  '/_||_\\',
] as const;

/** Bubble glyphs by size / age. */
export const BUBBLE_GLYPHS = ['·', 'o', 'O', '°', '˚'] as const;

/** Soft water shimmer characters. */
const WATER_CHARS = [' ', ' ', ' ', '·', '˙', '˚', ' '] as const;
const SAND_CHARS = ['.', '·', ':', '˙', ',', '`'] as const;
const CAUSTIC_CHARS = [' ', '·', '~', '∼', ' '] as const;

/** Slow body-wave period for large fish (ms). */
export const FISH_SWIM_MS = 2_400;
/** Tail flick frame length (ms). */
export const FISH_TAIL_MS = 320;
/** Bubble rise step (ms). */
export const BUBBLE_STEP_MS = 140;
/** Plant sway period (ms). */
export const PLANT_SWAY_MS = 1_600;

/** @deprecated alias kept for any leftover imports during port. */
export const FOX_BREATH_MS = FISH_SWIM_MS;
/** @deprecated */
export const FOX_TAIL_MS = FISH_TAIL_MS;
/** @deprecated */
export const RAIN_STEP_MS = BUBBLE_STEP_MS;

export function stripAnsi(text: string): string {
  return text.replace(/\u001B\[[0-9;]*m/g, '');
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

/** Center-blit styled lines onto a canvas starting at `top`. */
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

/** Left-aligned blit at column `left` (clamped). */
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
    const plain = stripAnsi(canvas[y] ?? ' '.repeat(width)).padEnd(width).slice(0, width);
    const glyphPlain = stripAnsi(line);
    const glyphW = visibleWidth(line);
    if (safeLeft >= width) continue;
    const fit = Math.min(glyphW, width - safeLeft);
    if (fit < glyphW) {
      const slice = glyphPlain.slice(0, fit);
      const next = `${plain.slice(0, safeLeft)}${slice}${plain.slice(safeLeft + fit)}`;
      canvas[y] = padOrTrim(next, width);
      continue;
    }
    const next = `${plain.slice(0, safeLeft)}${line}${plain.slice(safeLeft + glyphW)}`;
    canvas[y] = padOrTrim(next, width);
  }
}

function hash2(a: number, b: number): number {
  let x = (a * 374761393 + b * 668265263) | 0;
  x = (x ^ (x >>> 13)) | 0;
  x = Math.imul(x, 1274126177);
  return (x ^ (x >>> 16)) >>> 0;
}

/**
 * Paint one display column. `glyph` may carry ANSI (full chalk string).
 * Occupancy is decided from the plain (stripAnsi) row so SGR never becomes
 * a visible cell. Never slice styled text with [0] — that keeps only ESC.
 */
function putCell(
  canvas: string[],
  y: number,
  x: number,
  width: number,
  glyph: string,
  options?: { readonly force?: boolean; readonly soft?: boolean },
): void {
  if (y < 0 || y >= canvas.length || x < 0 || x >= width) return;
  const plain = stripAnsi(canvas[y] ?? ' '.repeat(width)).padEnd(width).slice(0, width);
  const here = plain[x] ?? ' ';
  if (!options?.force) {
    // Soft water cells may be over-painted; solid art must stay.
    const softOk = options?.soft
      ? here === ' ' || here === '·' || here === '˙' || here === '˚' || here === '~' || here === '∼'
      : here === ' ' || here === '·' || here === '˙' || here === '˚';
    if (!softOk) return;
  }
  // Insert the full styled glyph (not glyph[0]) over one plain column.
  canvas[y] = padOrTrim(`${plain.slice(0, x)}${glyph}${plain.slice(x + 1)}`, width);
}

function putCellForced(canvas: string[], y: number, x: number, width: number, glyph: string): void {
  putCell(canvas, y, x, width, glyph, { force: true });
}

/**
 * Resolve a multi-row "hero" fish glyph set for the stage size.
 * Picks left/right facing from a slow sine so the school feels alive.
 */
export function resolveFishGlyphRows(
  width: number,
  availableRows: number,
  elapsedMs = 0,
): readonly string[] {
  const safeWidth = Math.max(0, Math.trunc(width));
  const rows = Math.max(0, Math.trunc(availableRows));
  const facingRight = Math.sin((elapsedMs / FISH_SWIM_MS) * Math.PI * 2) >= 0;
  let base: readonly string[];
  if (safeWidth >= 48 && rows >= FISH_LARGE_RIGHT.length) {
    base = facingRight ? FISH_LARGE_RIGHT : FISH_LARGE_LEFT;
  } else if (rows >= FISH_COMPACT_RIGHT.length) {
    base = facingRight ? FISH_COMPACT_RIGHT : FISH_COMPACT_LEFT;
  } else {
    const compact = facingRight ? FISH_COMPACT_RIGHT : FISH_COMPACT_LEFT;
    base = compact.slice(0, Math.max(1, Math.min(compact.length, rows)));
  }
  return applyFishTail(base, elapsedMs, facingRight);
}

/** @deprecated fox name — maps to fish for external callers during transition. */
export function resolveFoxGlyphRows(
  width: number,
  availableRows: number,
  elapsedMs = 0,
): readonly string[] {
  return resolveFishGlyphRows(width, availableRows, elapsedMs);
}

/**
 * Flick the fish tail on the trailing edge.
 * Large: animate the `)` / `(` cascade; compact: tip pulse.
 */
export function applyFishTail(
  rows: readonly string[],
  elapsedMs: number,
  facingRight = true,
): string[] {
  if (rows.length === 0) return [];
  const frame = Math.floor(elapsedMs / FISH_TAIL_MS) % 4;
  const out = rows.map((line) => line);
  const isLarge = (rows[0]?.length ?? 0) >= 10;

  if (isLarge && out.length >= 2) {
    // Animate the body-line middle of the fish.
    const bodyIdx = 1;
    const line = out[bodyIdx];
    if (line !== undefined) {
      if (facingRight) {
        // <° )))><  → pulse the ))) cluster
        const tails = [')))', '))·', ')·)', '·))'] as const;
        const tail = tails[frame] ?? ')))';
        out[bodyIdx] = line.replace(/\){2,3}/u, tail);
      } else {
        const tails = ['(((', '·((', '(·(', '((·'] as const;
        const tail = tails[frame] ?? '(((';
        out[bodyIdx] = line.replace(/\({2,3}/u, tail);
      }
    }
  } else if (out.length >= 2) {
    const bodyIdx = 1;
    const line = out[bodyIdx];
    if (line !== undefined) {
      const tips = facingRight ? ['><', '·<', '><', '-<'] : ['><', '>·', '><', '>-'];
      const tip = tips[frame] ?? '><';
      if (facingRight) {
        out[bodyIdx] = line.replace(/><\s*$/u, `${tip} `);
      } else {
        out[bodyIdx] = line.replace(/^\s*></u, ` ${tip}`);
      }
    }
  }
  return out;
}

/** @deprecated */
export function applyFoxTail(rows: readonly string[], elapsedMs: number): string[] {
  return applyFishTail(rows, elapsedMs, true);
}

/** Soft water caustics / shimmer in the open water column. */
export function paintWaterShimmer(
  canvas: string[],
  width: number,
  rows: number,
  elapsedMs: number,
  density: number,
  paintGlyph: (glyph: string, intensity: number) => string,
): void {
  if (width <= 0 || rows <= 0) return;
  const count = Math.max(2, Math.floor(width * rows * density * 0.04));
  for (let i = 0; i < count; i++) {
    const seed = hash2(i * 17 + 3, 91);
    const baseX = seed % width;
    const drift = Math.floor(elapsedMs / 90 + seed * 0.01) % Math.max(1, width);
    const x = (baseX + Math.floor(Math.sin((elapsedMs / 1_800 + seed) * 0.01) * 2) + drift) % width;
    const yBase = hash2(i * 13 + 7, 53) % Math.max(1, rows - 1);
    const bob = Math.floor(Math.sin(elapsedMs / 1_100 + seed) * 1.2);
    const y = Math.max(0, Math.min(rows - 1, yBase + bob));
    const intensity = ((Math.sin(elapsedMs / 700 + seed) + 1) / 2) * 0.9 + 0.1;
    const idx = Math.min(WATER_CHARS.length - 1, Math.floor(intensity * (WATER_CHARS.length - 1)));
    const glyph = WATER_CHARS[idx] ?? '·';
    if (glyph === ' ') continue;
    putCell(canvas, y, x, width, paintGlyph(glyph, intensity), { soft: true });
  }
}

/** Rising bubbles — only on empty cells. */
export function paintBubbles(
  canvas: string[],
  width: number,
  rows: number,
  elapsedMs: number,
  paintGlyph: (glyph: string, intensity: number) => string,
): void {
  if (width <= 0 || rows <= 0) return;
  const columns = Math.max(3, Math.floor(width / 9));
  for (let i = 0; i < columns; i++) {
    const seed = hash2(i * 29 + 5, 77);
    const x = 2 + (seed % Math.max(1, width - 4));
    // Each column has its own rise phase and period.
    const period = 1_800 + (seed % 1_400);
    const phase = (elapsedMs + seed) % period;
    const progress = phase / period; // 0 bottom → 1 top
    const y = Math.floor((1 - progress) * (rows - 1));
    // Occasional double-bubble trail.
    const sizeIdx = Math.min(
      BUBBLE_GLYPHS.length - 1,
      Math.floor(progress * BUBBLE_GLYPHS.length),
    );
    const glyph = BUBBLE_GLYPHS[sizeIdx] ?? 'o';
    const intensity = 0.35 + progress * 0.55;
    putCell(canvas, y, x, width, paintGlyph(glyph, intensity), { soft: true });
    if (progress > 0.2 && progress < 0.85 && seed % 3 === 0) {
      const trailY = Math.min(rows - 1, y + 1);
      putCell(canvas, trailY, x, width, paintGlyph('·', intensity * 0.5), { soft: true });
    }
  }
}

/** @deprecated rain → bubbles for transitional tests. */
export function paintRain(
  canvas: string[],
  width: number,
  rows: number,
  elapsedMs: number,
  paintGlyph: (glyph: string, intensity?: number) => string,
): void {
  paintBubbles(canvas, width, rows, elapsedMs, (g, intensity) => paintGlyph(g, intensity));
}

/** Light rays / soft mist from the surface. */
export function paintSurfaceLight(
  canvas: string[],
  width: number,
  rows: number,
  elapsedMs: number,
  paintGlyph: (glyph: string, intensity: number) => string,
): void {
  if (width <= 0 || rows < 3) return;
  const band = Math.min(3, Math.max(1, Math.floor(rows * 0.18)));
  for (let y = 0; y < band; y++) {
    for (let x = 0; x < width; x++) {
      const wave = Math.sin(x * 0.35 + elapsedMs / 900 + y * 0.7);
      const intensity = (wave + 1) / 2;
      if (intensity < 0.55) continue;
      const idx = Math.min(
        CAUSTIC_CHARS.length - 1,
        Math.floor(intensity * (CAUSTIC_CHARS.length - 1)),
      );
      const glyph = CAUSTIC_CHARS[idx] ?? '·';
      if (glyph === ' ') continue;
      putCell(canvas, y, x, width, paintGlyph(glyph, intensity), { soft: true });
    }
  }
}

/** @deprecated mist name. */
export function paintMist(
  canvas: string[],
  width: number,
  rows: number,
  elapsedMs: number,
  paintGlyph: (glyph: string, intensity: number) => string,
): void {
  paintSurfaceLight(canvas, width, rows, elapsedMs, paintGlyph);
}

/** Sand / gravel bed along the bottom of the tank. */
export function renderSandLine(width: number, elapsedMs: number, rowSeed: number): string {
  if (width <= 0) return '';
  const cells: string[] = [];
  for (let x = 0; x < width; x++) {
    const h = hash2(x + 3, rowSeed * 17 + 9);
    // Gentle shimmer so the bed never looks frozen.
    const twinkle = Math.sin(elapsedMs / 2_200 + x * 0.4 + rowSeed) > 0.7;
    if (twinkle) {
      cells.push(SAND_CHARS[(h + 2) % SAND_CHARS.length] ?? '·');
    } else {
      cells.push(SAND_CHARS[h % SAND_CHARS.length] ?? '.');
    }
  }
  return cells.join('');
}

/** Glass rim / waterline at the top of the tank. */
export function renderWaterline(width: number, elapsedMs: number): string {
  if (width <= 0) return '';
  const cells: string[] = [];
  for (let x = 0; x < width; x++) {
    const phase = Math.sin(x * 0.45 + elapsedMs / 700);
    if (phase > 0.55) cells.push('~');
    else if (phase > 0.1) cells.push('∼');
    else if (phase > -0.35) cells.push('·');
    else cells.push(' ');
  }
  return cells.join('');
}

/** Soft caustic highlight drifting across mid-water (replaces moonlight path). */
export function paintMoonlightPath(
  canvas: string[],
  top: number,
  bandRows: number,
  width: number,
  elapsedMs: number,
  paintCh: (ch: string) => string,
): void {
  if (width <= 0 || bandRows <= 0) return;
  const center = Math.floor((elapsedMs / 40) % Math.max(1, width + 10)) - 5;
  for (let r = 0; r < bandRows; r++) {
    const y = top + r;
    if (y < 0 || y >= canvas.length) continue;
    const plain = stripAnsi(canvas[y] ?? ' '.repeat(width)).padEnd(width).slice(0, width);
    const half = Math.max(2, Math.floor(width * 0.12) - r);
    let out = '';
    for (let x = 0; x < width; x++) {
      const dist = Math.abs(x - center);
      if (dist <= half && (plain[x] === ' ' || plain[x] === '~' || plain[x] === '∼' || plain[x] === '·')) {
        out += paintCh(dist < half * 0.4 ? '≈' : '·');
      } else {
        out += plain[x] ?? ' ';
      }
    }
    canvas[y] = padOrTrim(out, width);
  }
}

/** Decorative "lantern" → air stone / bubble stone glyph (keeps old test surface). */
export function resolveLanternGlyph(elapsedMs: number, seed: number): readonly string[] {
  const frame = Math.floor((elapsedMs + seed * 40) / 180) % 5;
  const top = BUBBLE_GLYPHS[frame] ?? 'o';
  // Soft stone body — no solid █.
  return [` ${top} `, '╒▓╕', ' ╵ '];
}

interface FishActor {
  readonly kind: 'large' | 'compact' | 'tiny';
  readonly seed: number;
  readonly speed: number; // columns per second-ish
  readonly amplitude: number;
  readonly baseYRatio: number;
  readonly phase: number;
  readonly tinyIdx: number;
}

function buildSchool(width: number, storyRows: number, premium: boolean): FishActor[] {
  const school: FishActor[] = [];
  const count = premium
    ? width >= 80
      ? 7
      : width >= 48
        ? 5
        : 3
    : width >= 80
      ? 5
      : width >= 48
        ? 4
        : 2;

  for (let i = 0; i < count; i++) {
    const seed = hash2(i * 47 + 11, 203);
    const kindRoll = seed % 10;
    const kind: FishActor['kind'] =
      i === 0 && storyRows >= 8
        ? 'large'
        : kindRoll < 4
          ? 'compact'
          : kindRoll < 8
            ? 'tiny'
            : storyRows >= 7
              ? 'compact'
              : 'tiny';
    school.push({
      kind,
      seed,
      speed: 0.55 + (seed % 40) / 50, // ~0.55–1.35
      amplitude: 0.4 + (seed % 20) / 25,
      baseYRatio: 0.22 + ((seed % 55) / 100) * 0.45,
      phase: (seed % 1_000) / 1_000,
      tinyIdx: seed % FISH_TINY.length,
    });
  }
  return school;
}

function fishGlyphFor(
  actor: FishActor,
  elapsedMs: number,
  facingRight: boolean,
  width: number,
  storyRows: number,
): readonly string[] {
  if (actor.kind === 'large') {
    return resolveFishGlyphRows(Math.max(width, 48), Math.max(storyRows, 8), elapsedMs + actor.seed);
  }
  if (actor.kind === 'compact') {
    const base = facingRight ? FISH_COMPACT_RIGHT : FISH_COMPACT_LEFT;
    return applyFishTail(base, elapsedMs + actor.seed, facingRight);
  }
  const pair = FISH_TINY[actor.tinyIdx] ?? FISH_TINY[0]!;
  const [right, left] = pair;
  // Tiny tail pulse via alternate glyphs.
  const flick = Math.floor((elapsedMs + actor.seed) / FISH_TAIL_MS) % 2 === 0;
  const glyph = facingRight ? right : left;
  if (!flick) return [glyph];
  // Soft pulse: swap middle dot.
  return [glyph.replace('°', '·').replace('~', '·')];
}

function paintFishSchool(
  canvas: string[],
  width: number,
  storyRows: number,
  elapsedMs: number,
  premium: boolean,
  showAmbient: boolean,
  paint: (hex: string, text: string) => string,
  colors: {
    readonly glow: string;
    readonly primary: string;
    readonly accent: string;
    readonly textDim: string;
    readonly warning: string;
  },
): void {
  const school = buildSchool(width, storyRows, premium);
  // Keep fish above the sand bed (last 1–2 rows).
  const sandRows = storyRows >= 8 ? 2 : 1;
  const swimFloor = Math.max(2, storyRows - sandRows - 1);

  for (let i = 0; i < school.length; i++) {
    const actor = school[i]!;
    // Horizontal loop with per-fish speed and phase.
    const travel = elapsedMs * 0.001 * actor.speed * 6 + actor.phase * width * 2;
    // Some fish swim left, some right — alternate by seed.
    const goesRight = actor.seed % 2 === 0;
    let x: number;
    if (goesRight) {
      x = Math.floor(travel % Math.max(1, width + 14)) - 7;
    } else {
      x = width + 7 - Math.floor(travel % Math.max(1, width + 14));
    }
    // Gentle vertical bob — sine with unique phase.
    const bob =
      Math.sin(elapsedMs / FISH_SWIM_MS + actor.phase * Math.PI * 2) * actor.amplitude * 1.6;
    const baseY = Math.floor(actor.baseYRatio * swimFloor);
    const y = Math.max(1, Math.min(swimFloor - 2, Math.floor(baseY + bob)));

    const facingRight = goesRight;
    const glyph = fishGlyphFor(actor, elapsedMs, facingRight, width, storyRows);
    const hex =
      i === 0
        ? premium
          ? colors.glow
          : colors.primary
        : actor.kind === 'tiny'
          ? colors.accent
          : actor.seed % 3 === 0
            ? colors.warning
            : colors.primary;
    const lines = glyph.map((line) =>
      showAmbient ? paint(hex, line) : paint(colors.textDim, line),
    );
    blitAt(canvas, lines, y, x, width);
  }
}

function paintPlants(
  canvas: string[],
  width: number,
  storyRows: number,
  elapsedMs: number,
  paint: (hex: string, text: string) => string,
  plantHex: string,
): void {
  if (width < 28 || storyRows < 6) return;
  const plantCount = width >= 80 ? 5 : width >= 50 ? 4 : 3;
  const sandTop = storyRows - (storyRows >= 8 ? 2 : 1);
  for (let i = 0; i < plantCount; i++) {
    const seed = hash2(i * 31 + 2, 61);
    const x = 2 + Math.floor(((i + 0.5) / plantCount) * (width - 6)) + ((seed % 5) - 2);
    const tall = seed % 3 !== 0 && storyRows >= 9;
    const frames = tall ? PLANT_TALL : PLANT_SHORT;
    const frameIdx = Math.floor(elapsedMs / PLANT_SWAY_MS + seed) % 4;
    const lines = frames.map((rowFrames) => {
      const cell = rowFrames[frameIdx] ?? rowFrames[0] ?? ' | ';
      return paint(plantHex, cell);
    });
    const top = Math.max(1, sandTop - lines.length);
    blitAt(canvas, lines, top, Math.max(0, Math.min(width - 4, x)), width);
  }
}

function paintRock(
  canvas: string[],
  width: number,
  storyRows: number,
  paint: (hex: string, text: string) => string,
  hex: string,
): void {
  if (width < 40 || storyRows < 8) return;
  const sandTop = storyRows - 2;
  const lines = ROCK_CASTLE.map((line) => paint(hex, line));
  const left = Math.max(2, Math.floor(width * 0.62));
  blitAt(canvas, lines, Math.max(1, sandTop - lines.length), left, width);
}

/**
 * Paint the full aquarium story into `canvas[0..storyRows)`.
 * Canvas is pre-filled with spaces; chrome lives below storyRows.
 */
export function paintIdleStoryScene(options: {
  readonly canvas: string[];
  readonly width: number;
  readonly storyRows: number;
  readonly elapsedMs: number;
  readonly showAmbient: boolean;
  readonly premium: boolean;
  readonly paint: (hex: string, text: string) => string;
  readonly colors: {
    readonly glow: string;
    readonly particle: string;
    readonly primary: string;
    readonly accent: string;
    readonly textDim: string;
    readonly textMuted: string;
    readonly warning: string;
  };
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
  } = options;
  if (width <= 0 || storyRows <= 0) return;

  // --- Layer 1: soft water shimmer ---
  if (showAmbient) {
    paintWaterShimmer(
      canvas,
      width,
      storyRows,
      elapsedMs,
      premium ? 0.9 : 0.55,
      (glyph, intensity) => {
        const hex =
          intensity > 0.75 ? colors.particle : intensity > 0.45 ? colors.textDim : colors.textMuted;
        return paint(hex, glyph);
      },
    );
  }

  // --- Layer 2: surface light / waterline ---
  if (showAmbient && storyRows >= 6) {
    paintSurfaceLight(canvas, width, storyRows, elapsedMs, (glyph, intensity) => {
      const hex = intensity > 0.8 ? colors.glow : colors.textMuted;
      return paint(hex, glyph);
    });
    const waterline = renderWaterline(width, elapsedMs);
    canvas[0] = padOrTrim(
      showAmbient ? paint(colors.textDim, waterline) : paint(colors.textMuted, waterline),
      width,
    );
  }

  // --- Layer 3: drifting caustic path mid-tank ---
  if (showAmbient && storyRows >= 8) {
    const bandTop = Math.max(1, Math.floor(storyRows * 0.28));
    const bandRows = Math.max(2, Math.floor(storyRows * 0.18));
    paintMoonlightPath(canvas, bandTop, bandRows, width, elapsedMs, (ch) =>
      paint(ch === '≈' ? colors.glow : colors.particle, ch),
    );
  }

  // --- Layer 4: sand bed ---
  const sandRows = storyRows >= 8 ? 2 : 1;
  for (let s = 0; s < sandRows; s++) {
    const y = storyRows - sandRows + s;
    if (y < 0 || y >= storyRows) continue;
    const sand = renderSandLine(width, elapsedMs, s + 1);
    canvas[y] = padOrTrim(paint(s === sandRows - 1 ? colors.warning : colors.textMuted, sand), width);
  }

  // --- Layer 5: plants + rock ---
  if (showAmbient) {
    paintPlants(canvas, width, storyRows, elapsedMs, paint, colors.accent);
    paintRock(canvas, width, storyRows, paint, colors.textDim);
  }

  // --- Layer 6: rising bubbles ---
  if (showAmbient) {
    paintBubbles(canvas, width, storyRows - sandRows, elapsedMs, (glyph, intensity) => {
      const hex = intensity > 0.6 ? colors.particle : colors.textMuted;
      return paint(hex, glyph);
    });
  }

  // --- Layer 7: fish school (last so they read on top) ---
  paintFishSchool(canvas, width, storyRows, elapsedMs, premium, showAmbient, paint, {
    glow: colors.glow,
    primary: colors.primary,
    accent: colors.accent,
    textDim: colors.textDim,
    warning: colors.warning,
  });

  // --- Layer 8: subtle glass side rails on wide tanks ---
  if (showAmbient && width >= 48 && storyRows >= 8) {
    for (let y = 1; y < storyRows - sandRows; y++) {
      putCell(canvas, y, 0, width, paint(colors.textMuted, '│'), { soft: true });
      putCell(canvas, y, width - 1, width, paint(colors.textMuted, '│'), { soft: true });
    }
  }
}

/** Bank rail kept as a thin sand ridge helper for any leftover callers. */
export function renderBankRail(width: number, elapsedMs: number, fancy: boolean): string {
  const line = renderSandLine(width, elapsedMs, fancy ? 3 : 1);
  return line;
}

/** Distant "hill" → soft rear plant silhouettes across one row. */
export function renderHillLine(width: number, elapsedMs: number): string {
  if (width <= 0) return '';
  const cells: string[] = [];
  for (let x = 0; x < width; x++) {
    const h = hash2(x + 1, 19);
    const sway = Math.sin(elapsedMs / PLANT_SWAY_MS + x * 0.2);
    if (h % 7 === 0) cells.push(sway > 0 ? ')' : '(');
    else if (h % 5 === 0) cells.push('|');
    else cells.push(' ');
  }
  return cells.join('');
}

/** Fireflies → sparkle motes in water (same density helper shape). */
export function paintFireflies(
  canvas: string[],
  width: number,
  rows: number,
  elapsedMs: number,
  density: number,
  paintGlyph: (glyph: string, intensity: number) => string,
): void {
  paintWaterShimmer(canvas, width, rows, elapsedMs, density * 4, paintGlyph);
}
