/**
 * Empty-transcript idle scene — "Peaceful Aquarium" (minimal).
 *
 * A calm, colorful tank: a few fish, soft bubbles, a plant or two, thin sand.
 * No dense particle fields, no rock castles, no heavy caustics. Color does the
 * work; glyphs stay sparse so the stage stays readable.
 */

import { truncateToWidth, visibleWidth } from '#/tui/renderer';

/** Large fish (3 rows) — facing right. */
export const FISH_LARGE_RIGHT = [
  '  ,-.   ',
  ' <°)><~ ',
  '  `-´   ',
] as const;

/** Large fish (3 rows) — facing left. */
export const FISH_LARGE_LEFT = [
  '   ,-.  ',
  ' ~><(°> ',
  '   `-´  ',
] as const;

/** Compact fish (3 rows). */
export const FISH_COMPACT_RIGHT = [
  '  ·    ',
  ' <°)>< ',
  '  ~    ',
] as const;
export const FISH_COMPACT_LEFT = [
  '    ·  ',
  ' ><(°> ',
  '    ~  ',
] as const;

/** Tiny single-cell school members. */
export const FISH_TINY = [
  ['><>', '<><'],
  ['>°>', '<°<'],
] as const;

/** Simple plant frames (sway). */
export const PLANT_FRAMES = [
  [' ) ', ' ( ', ' ) ', ' ( '],
  [' )(', ' ()', ' )(', ' ()'],
  [' | ', ' | ', ' | ', ' | '],
] as const;

export const BUBBLE_GLYPHS = ['·', 'o', '°'] as const;

/** Slow swim / bob period (ms). */
export const FISH_SWIM_MS = 3_200;
/** Tail flick frame (ms). */
export const FISH_TAIL_MS = 420;
/** Bubble rise step (ms). */
export const BUBBLE_STEP_MS = 180;
/** Plant sway period (ms). */
export const PLANT_SWAY_MS = 2_000;

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
      canvas[y] = padOrTrim(`${plain.slice(0, safeLeft)}${slice}${plain.slice(safeLeft + fit)}`, width);
      continue;
    }
    canvas[y] = padOrTrim(
      `${plain.slice(0, safeLeft)}${line}${plain.slice(safeLeft + glyphW)}`,
      width,
    );
  }
}

function hash2(a: number, b: number): number {
  let x = Math.imul(a, 374761393) + Math.imul(b, 668265263);
  x = Math.imul(x ^ (x >>> 13), 1274126177);
  return (x ^ (x >>> 16)) >>> 0;
}

/**
 * Paint one display column. `glyph` may carry full ANSI (never slice styled text).
 * Only paints empty water cells unless `force` is set.
 */
function putCell(
  canvas: string[],
  y: number,
  x: number,
  width: number,
  glyph: string,
  force = false,
): void {
  if (y < 0 || y >= canvas.length || x < 0 || x >= width) return;
  const plain = stripAnsi(canvas[y] ?? ' '.repeat(width)).padEnd(width).slice(0, width);
  const here = plain[x] ?? ' ';
  if (!force && here !== ' ' && here !== '·' && here !== '˙' && here !== '~' && here !== '∼') {
    return;
  }
  canvas[y] = padOrTrim(`${plain.slice(0, x)}${glyph}${plain.slice(x + 1)}`, width);
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
  if (safeWidth >= 40 && rows >= FISH_LARGE_RIGHT.length) {
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

export function applyFishTail(
  rows: readonly string[],
  elapsedMs: number,
  facingRight = true,
): string[] {
  if (rows.length === 0) return [];
  const frame = Math.floor(elapsedMs / FISH_TAIL_MS) % 4;
  const out = rows.map((line) => line);
  const bodyIdx = out.findIndex((line) => line.includes('<') || line.includes('>'));
  if (bodyIdx < 0) return out;
  const line = out[bodyIdx];
  if (line === undefined) return out;

  if (facingRight) {
    const tips = ['~ ', '- ', '~ ', '· '] as const;
    out[bodyIdx] = line.replace(/[~\-·]\s*$/u, tips[frame] ?? '~ ');
  } else {
    const tips = [' ~', ' -', ' ~', ' ·'] as const;
    out[bodyIdx] = line.replace(/^\s*[~\-·]/u, tips[frame] ?? ' ~');
  }
  return out;
}

/** @deprecated */
export function applyFoxTail(rows: readonly string[], elapsedMs: number): string[] {
  return applyFishTail(rows, elapsedMs, true);
}

/** Sparse rising bubbles — few columns, soft glyphs. */
export function paintBubbles(
  canvas: string[],
  width: number,
  rows: number,
  elapsedMs: number,
  paintGlyph: (glyph: string, intensity: number) => string,
): void {
  if (width <= 0 || rows <= 0) return;
  const columns = Math.max(2, Math.min(5, Math.floor(width / 16)));
  for (let i = 0; i < columns; i++) {
    const seed = hash2(i * 29 + 5, 77);
    const x = 3 + (seed % Math.max(1, width - 6));
    const period = 2_400 + (seed % 1_600);
    const phase = (elapsedMs + seed) % period;
    const progress = phase / period;
    const y = Math.floor((1 - progress) * (rows - 1));
    const sizeIdx = Math.min(BUBBLE_GLYPHS.length - 1, Math.floor(progress * BUBBLE_GLYPHS.length));
    const glyph = BUBBLE_GLYPHS[sizeIdx] ?? 'o';
    putCell(canvas, y, x, width, paintGlyph(glyph, 0.4 + progress * 0.5));
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

/** Soft mid-water highlight band (kept for tests / optional light). */
export function paintMoonlightPath(
  canvas: string[],
  top: number,
  bandRows: number,
  width: number,
  elapsedMs: number,
  paintCh: (ch: string) => string,
): void {
  if (width <= 0 || bandRows <= 0) return;
  const center = Math.floor((elapsedMs / 55) % Math.max(1, width + 8)) - 4;
  const half = Math.max(2, Math.floor(width * 0.08));
  for (let r = 0; r < bandRows; r++) {
    const y = top + r;
    if (y < 0 || y >= canvas.length) continue;
    for (let x = Math.max(0, center - half); x <= Math.min(width - 1, center + half); x++) {
      const dist = Math.abs(x - center);
      // Force so unit tests can seed a full water band with `~` and still see the path.
      putCell(canvas, y, x, width, paintCh(dist < half * 0.45 ? '≈' : '·'), true);
    }
  }
}

/** Decorative air-stone glyph (test surface; not drawn in minimal scene). */
export function resolveLanternGlyph(elapsedMs: number, seed: number): readonly string[] {
  const frame = Math.floor((elapsedMs + seed * 40) / 220) % BUBBLE_GLYPHS.length;
  const top = BUBBLE_GLYPHS[frame] ?? 'o';
  return [` ${top} `, '╒▓╕', ' ╵ '];
}

export function renderWaterline(width: number, elapsedMs: number): string {
  if (width <= 0) return '';
  const cells: string[] = [];
  for (let x = 0; x < width; x++) {
    const phase = Math.sin(x * 0.38 + elapsedMs / 900);
    if (phase > 0.45) cells.push('~');
    else if (phase > -0.15) cells.push('∼');
    else cells.push('·');
  }
  return cells.join('');
}

export function renderSandLine(width: number, elapsedMs: number, rowSeed: number): string {
  if (width <= 0) return '';
  // One calm dotted bed — no noisy mixed punctuation.
  const cells: string[] = [];
  for (let x = 0; x < width; x++) {
    const twinkle = Math.sin(elapsedMs / 2_800 + x * 0.35 + rowSeed) > 0.82;
    cells.push(twinkle ? '·' : '.');
  }
  return cells.join('');
}

export function renderBankRail(width: number, elapsedMs: number, _fancy: boolean): string {
  return renderSandLine(width, elapsedMs, 1);
}

export function renderHillLine(width: number, elapsedMs: number): string {
  if (width <= 0) return '';
  // Unused in minimal scene; keep a quiet plant-hint row for callers.
  const cells: string[] = [];
  for (let x = 0; x < width; x++) {
    const h = hash2(x + 1, 19);
    if (h % 11 === 0) cells.push(Math.sin(elapsedMs / PLANT_SWAY_MS + x) > 0 ? ')' : '(');
    else cells.push(' ');
  }
  return cells.join('');
}

/** Very light surface sparkle (almost empty). */
export function paintWaterShimmer(
  canvas: string[],
  width: number,
  rows: number,
  elapsedMs: number,
  density: number,
  paintGlyph: (glyph: string, intensity: number) => string,
): void {
  if (width <= 0 || rows <= 0) return;
  const count = Math.max(1, Math.floor(width * density * 0.03));
  for (let i = 0; i < count; i++) {
    const seed = hash2(i * 17 + 3, 91);
    const x = seed % width;
    const y = (hash2(i * 13 + 7, 53) + Math.floor(elapsedMs / 1_400)) % Math.max(1, Math.floor(rows * 0.45));
    putCell(canvas, y, x, width, paintGlyph('·', 0.35));
  }
}

export function paintSurfaceLight(
  canvas: string[],
  width: number,
  rows: number,
  elapsedMs: number,
  paintGlyph: (glyph: string, intensity: number) => string,
): void {
  // Minimal: only the waterline row is painted by the scene composer.
  void canvas;
  void width;
  void rows;
  void elapsedMs;
  void paintGlyph;
}

export function paintMist(
  canvas: string[],
  width: number,
  rows: number,
  elapsedMs: number,
  paintGlyph: (glyph: string, intensity: number) => string,
): void {
  paintWaterShimmer(canvas, width, rows, elapsedMs, 0.4, paintGlyph);
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

interface FishActor {
  readonly kind: 'large' | 'compact' | 'tiny';
  readonly seed: number;
  readonly speed: number;
  readonly baseYRatio: number;
  readonly phase: number;
  readonly colorKey: 'primary' | 'accent' | 'glow' | 'particle' | 'success' | 'warning';
  readonly goesRight: boolean;
}

function buildSchool(width: number, storyRows: number, premium: boolean): FishActor[] {
  // Minimal: 2–4 fish total. Color does the personality work.
  const count = premium
    ? width >= 72
      ? 4
      : width >= 40
        ? 3
        : 2
    : width >= 56
      ? 3
      : 2;

  const paletteKeys: FishActor['colorKey'][] = [
    'primary',
    'accent',
    'glow',
    'particle',
    'success',
    'warning',
  ];

  const school: FishActor[] = [];
  for (let i = 0; i < count; i++) {
    const seed = hash2(i * 47 + 11, 203);
    const kind: FishActor['kind'] =
      i === 0 && storyRows >= 7 ? 'large' : i === 1 && storyRows >= 6 ? 'compact' : 'tiny';
    school.push({
      kind,
      seed,
      speed: 0.45 + (seed % 30) / 80,
      baseYRatio: 0.28 + ((seed % 40) / 100) * 0.35,
      phase: (seed % 1_000) / 1_000,
      colorKey: paletteKeys[i % paletteKeys.length]!,
      goesRight: seed % 2 === 0,
    });
  }
  return school;
}

function glyphForActor(actor: FishActor, elapsedMs: number): readonly string[] {
  const t = elapsedMs + actor.seed;
  if (actor.kind === 'large') {
    const facingRight = actor.goesRight;
    const base = facingRight ? FISH_LARGE_RIGHT : FISH_LARGE_LEFT;
    return applyFishTail(base, t, facingRight);
  }
  if (actor.kind === 'compact') {
    const base = actor.goesRight ? FISH_COMPACT_RIGHT : FISH_COMPACT_LEFT;
    return applyFishTail(base, t, actor.goesRight);
  }
  const pair = FISH_TINY[actor.seed % FISH_TINY.length] ?? FISH_TINY[0]!;
  return [actor.goesRight ? pair[0] : pair[1]];
}

function paintFishSchool(
  canvas: string[],
  width: number,
  storyRows: number,
  elapsedMs: number,
  premium: boolean,
  showAmbient: boolean,
  paint: (hex: string, text: string) => string,
  colors: Record<FishActor['colorKey'] | 'textDim', string>,
): void {
  const school = buildSchool(width, storyRows, premium);
  const sandRows = 1;
  const floor = Math.max(2, storyRows - sandRows - 1);

  for (const actor of school) {
    const travel = elapsedMs * 0.001 * actor.speed * 5.5 + actor.phase * width * 2;
    const loop = Math.max(1, width + 12);
    const x = actor.goesRight
      ? Math.floor(travel % loop) - 6
      : width + 6 - Math.floor(travel % loop);
    const bob = Math.sin(elapsedMs / FISH_SWIM_MS + actor.phase * Math.PI * 2) * 0.9;
    const y = Math.max(1, Math.min(floor - 1, Math.floor(actor.baseYRatio * floor + bob)));
    const hex = showAmbient ? colors[actor.colorKey] : colors.textDim;
    const lines = glyphForActor(actor, elapsedMs).map((line) => paint(hex, line));
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
  const count = width >= 70 ? 3 : 2;
  const sandY = storyRows - 1;
  for (let i = 0; i < count; i++) {
    const seed = hash2(i * 31 + 2, 61);
    const x = Math.floor(((i + 0.5) / count) * (width - 4)) + 1;
    const frameIdx = Math.floor(elapsedMs / PLANT_SWAY_MS + seed) % 4;
    const lines = PLANT_FRAMES.map((frames) => paint(plantHex, frames[frameIdx] ?? ' | '));
    blitAt(canvas, lines, Math.max(1, sandY - lines.length), Math.max(0, Math.min(width - 3, x)), width);
  }
}

/**
 * Paint the aquarium into `canvas[0..storyRows)`.
 * Layers (bottom → top): waterline, sparse shimmer, sand, plants, bubbles, fish.
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
    readonly success?: string;
  };
}): void {
  const { canvas, width, storyRows, elapsedMs, showAmbient, premium, paint, colors } = options;
  if (width <= 0 || storyRows <= 0) return;

  const success = colors.success ?? colors.accent;

  // Waterline — one calm top edge.
  if (storyRows >= 4) {
    const line = renderWaterline(width, elapsedMs);
    canvas[0] = padOrTrim(
      paint(showAmbient ? colors.glow : colors.textMuted, line),
      width,
    );
  }

  // Sparse shimmer only when ambient is on (premium gets a touch more).
  if (showAmbient && storyRows >= 8) {
    paintWaterShimmer(
      canvas,
      width,
      storyRows,
      elapsedMs,
      premium ? 0.55 : 0.3,
      (glyph) => paint(colors.particle, glyph),
    );
  }

  // Single sand row.
  const sandY = storyRows - 1;
  if (sandY > 0) {
    canvas[sandY] = padOrTrim(
      paint(colors.warning, renderSandLine(width, elapsedMs, 1)),
      width,
    );
  }

  // Plants — green/success when available.
  if (showAmbient) {
    paintPlants(canvas, width, storyRows, elapsedMs, paint, success);
  }

  // Bubbles — few, soft.
  if (showAmbient) {
    paintBubbles(canvas, width, Math.max(1, storyRows - 1), elapsedMs, (glyph, intensity) =>
      paint(intensity > 0.65 ? colors.glow : colors.textMuted, glyph),
    );
  }

  // Optional soft light band (premium only, one row — not a thick path).
  if (showAmbient && premium && storyRows >= 10 && width >= 48) {
    const y = Math.floor(storyRows * 0.35);
    paintMoonlightPath(canvas, y, 1, width, elapsedMs, (ch) =>
      paint(ch === '≈' ? colors.glow : colors.particle, ch),
    );
  }

  // Fish last so they read cleanly on top.
  paintFishSchool(canvas, width, storyRows, elapsedMs, premium, showAmbient, paint, {
    primary: colors.primary,
    accent: colors.accent,
    glow: colors.glow,
    particle: colors.particle,
    success,
    warning: colors.warning,
    textDim: colors.textDim,
  });
}
