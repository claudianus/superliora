/**
 * Empty-transcript idle scene — a little aquarium.
 *
 * Cute fish, cool green seaweed, soft sky-blue water.
 * Sparse and pretty. No gadget clutter.
 */

import { truncateToWidth, visibleWidth } from '#/tui/renderer';

/** Cute large fish — right. Classic aquarium smile. */
export const FISH_LARGE_RIGHT = [
  '   ︵     ',
  ' ><(((º>  ',
  '   ︶     ',
] as const;

/** Cute large fish — left. */
export const FISH_LARGE_LEFT = [
  '     ︵   ',
  '  <º)))>< ',
  '     ︶   ',
] as const;

/** Compact school fish — right. */
export const FISH_COMPACT_RIGHT = [
  '  ·  ',
  ' ><> ',
  '  ~  ',
] as const;

/** Compact school fish — left. */
export const FISH_COMPACT_LEFT = [
  '  ·  ',
  ' <>< ',
  '  ~  ',
] as const;

/** Tiny darting friends. */
export const FISH_TINY = [
  ['><>', '<><'],
  ['>º>', '<º<'],
] as const;

/**
 * Tall seaweed — four sway frames per row (top → root).
 * Meant to feel like a cool green curtain, not sparse sticks.
 */
export const PLANT_FRAMES = [
  ['  )  ', '  (  ', '  )  ', '  (  '],
  [' )(  ', ' ( ) ', ' )(  ', ' ( ) '],
  [')||( ', '(||) ', ')||( ', '(||) '],
  [' ||  ', ' ||  ', ' ||  ', ' ||  '],
  [' ||  ', ' ||  ', ' ||  ', ' ||  '],
] as const;

export const BUBBLE_GLYPHS = ['·', 'o', '°'] as const;

export const FISH_SWIM_MS = 3_600;
export const FISH_TAIL_MS = 480;
export const BUBBLE_STEP_MS = 200;
export const PLANT_SWAY_MS = 2_200;

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

/** One cell. `glyph` may include full ANSI — never slice styled text. */
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

/** Soft fin / cheek pulse so the fish feels alive without looking twitchy. */
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
    // Large: breathe the cheek parentheses.
    const cheeks = facingRight
      ? (['(((º>', '((º> ', '(((º>', '((((º>'] as const)
      : (['<º)))', '<º)) ', '<º)))', '<º))))'] as const);
    const cheek = cheeks[frame] ?? cheeks[0]!;
    out[bodyIdx] = facingRight
      ? line.replace(/\({2,4}º>/u, cheek)
      : line.replace(/<º\){2,4}/u, cheek);
    return out;
  }

  // Compact / tiny: gentle tail tip.
  if (facingRight) {
    const tips = ['>', '·', '>', '~'] as const;
    out[bodyIdx] = line.replace(/>\s*$/u, `${tips[frame] ?? '>'} `);
  } else {
    const tips = ['<', '·', '<', '~'] as const;
    out[bodyIdx] = line.replace(/^\s*</u, ` ${tips[frame] ?? '<'}`);
  }
  return out;
}

/** @deprecated */
export function applyFoxTail(rows: readonly string[], elapsedMs: number): string[] {
  return applyFishTail(rows, elapsedMs, true);
}

export function paintBubbles(
  canvas: string[],
  width: number,
  rows: number,
  elapsedMs: number,
  paintGlyph: (glyph: string, intensity: number) => string,
): void {
  if (width <= 0 || rows <= 0) return;
  // A few quiet bubbles — not a soda fountain.
  const columns = Math.max(2, Math.min(4, Math.floor(width / 18)));
  for (let i = 0; i < columns; i++) {
    const seed = hash2(i * 29 + 5, 77);
    const x = 4 + (seed % Math.max(1, width - 8));
    const period = 2_800 + (seed % 1_800);
    const progress = ((elapsedMs + seed) % period) / period;
    const y = Math.floor((1 - progress) * (rows - 1));
    const sizeIdx = Math.min(BUBBLE_GLYPHS.length - 1, Math.floor(progress * BUBBLE_GLYPHS.length));
    putCell(canvas, y, x, width, paintGlyph(BUBBLE_GLYPHS[sizeIdx] ?? 'o', 0.45 + progress * 0.4));
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

export function paintMoonlightPath(
  canvas: string[],
  top: number,
  bandRows: number,
  width: number,
  elapsedMs: number,
  paintCh: (ch: string) => string,
): void {
  if (width <= 0 || bandRows <= 0) return;
  const center = Math.floor((elapsedMs / 60) % Math.max(1, width + 8)) - 4;
  const half = Math.max(2, Math.floor(width * 0.07));
  for (let r = 0; r < bandRows; r++) {
    const y = top + r;
    if (y < 0 || y >= canvas.length) continue;
    for (let x = Math.max(0, center - half); x <= Math.min(width - 1, center + half); x++) {
      const dist = Math.abs(x - center);
      putCell(canvas, y, x, width, paintCh(dist < half * 0.4 ? '≈' : '·'), true);
    }
  }
}

export function resolveLanternGlyph(elapsedMs: number, seed: number): readonly string[] {
  const frame = Math.floor((elapsedMs + seed * 40) / 220) % BUBBLE_GLYPHS.length;
  const top = BUBBLE_GLYPHS[frame] ?? 'o';
  return [` ${top} `, '╒▓╕', ' ╵ '];
}

export function renderWaterline(width: number, elapsedMs: number): string {
  if (width <= 0) return '';
  const cells: string[] = [];
  for (let x = 0; x < width; x++) {
    const phase = Math.sin(x * 0.32 + elapsedMs / 1_050);
    if (phase > 0.4) cells.push('~');
    else if (phase > -0.25) cells.push('∼');
    else cells.push('·');
  }
  return cells.join('');
}

export function renderSandLine(width: number, elapsedMs: number, rowSeed: number): string {
  if (width <= 0) return '';
  const cells: string[] = [];
  for (let x = 0; x < width; x++) {
    const twinkle = Math.sin(elapsedMs / 3_200 + x * 0.3 + rowSeed) > 0.88;
    cells.push(twinkle ? '·' : '.');
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

/** Soft sky-blue water body — airy, not noisy. */
export function paintWaterField(
  canvas: string[],
  width: number,
  rows: number,
  elapsedMs: number,
  paint: (hex: string, text: string) => string,
  sky: string,
  skySoft: string,
): void {
  if (width <= 0 || rows <= 1) return;
  // Gentle horizontal drift of soft blue dots — like light in water.
  const count = Math.max(3, Math.floor(width * 0.12));
  for (let i = 0; i < count; i++) {
    const seed = hash2(i * 23 + 4, 61);
    const drift = Math.floor(elapsedMs / 120 + seed * 0.01) % Math.max(1, width);
    const x = (seed + drift) % width;
    const y = 1 + (hash2(i * 11 + 2, 29) % Math.max(1, rows - 2));
    const soft = seed % 3 !== 0;
    putCell(canvas, y, x, width, paint(soft ? skySoft : sky, soft ? '·' : '˙'));
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
  const count = Math.max(1, Math.floor(width * density * 0.04));
  for (let i = 0; i < count; i++) {
    const seed = hash2(i * 17 + 3, 91);
    const x = seed % width;
    const y =
      (hash2(i * 13 + 7, 53) + Math.floor(elapsedMs / 1_600)) %
      Math.max(1, Math.floor(rows * 0.5));
    putCell(canvas, y, x, width, paintGlyph('·', 0.4));
  }
}

export function paintSurfaceLight(
  canvas: string[],
  width: number,
  rows: number,
  elapsedMs: number,
  paintGlyph: (glyph: string, intensity: number) => string,
): void {
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
  // A small, cute cast — not a crowd.
  const count = premium ? (width >= 70 ? 4 : 3) : width >= 50 ? 3 : 2;
  const colors: FishColor[] = ['gold', 'sky', 'teal', 'soft'];
  const school: FishActor[] = [];
  for (let i = 0; i < count; i++) {
    const seed = hash2(i * 47 + 11, 203);
    const kind: FishActor['kind'] =
      i === 0 && storyRows >= 7 ? 'large' : i === 1 && storyRows >= 6 ? 'compact' : 'tiny';
    school.push({
      kind,
      seed,
      speed: 0.38 + (seed % 28) / 90,
      baseYRatio: 0.22 + ((seed % 38) / 100) * 0.32,
      phase: (seed % 1_000) / 1_000,
      color: colors[i % colors.length]!,
      goesRight: seed % 2 === 0,
    });
  }
  return school;
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
  palette: {
    readonly gold: string;
    readonly sky: string;
    readonly teal: string;
    readonly soft: string;
    readonly dim: string;
  },
): void {
  const school = buildSchool(width, storyRows, premium);
  // Keep fish above the seaweed crowns a little.
  const floor = Math.max(2, storyRows - 2);

  for (const actor of school) {
    const travel = elapsedMs * 0.001 * actor.speed * 5.2 + actor.phase * width * 2;
    const loop = Math.max(1, width + 14);
    const x = actor.goesRight
      ? Math.floor(travel % loop) - 7
      : width + 7 - Math.floor(travel % loop);
    const bob = Math.sin(elapsedMs / FISH_SWIM_MS + actor.phase * Math.PI * 2) * 0.85;
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

/** Cool green seaweed forest along the bed — generous, calm sway. */
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
  // Spread plants across the tank — a soft green curtain, not three lonely stems.
  const spacing = width >= 80 ? 6 : width >= 50 ? 7 : 8;
  const count = Math.max(3, Math.floor((width - 2) / spacing));
  const sandY = storyRows - 1;

  for (let i = 0; i < count; i++) {
    const seed = hash2(i * 31 + 2, 61);
    // Slight jitter so the bed doesn't look like a grid.
    const x = 1 + i * spacing + ((seed % 3) - 1);
    const frameIdx = Math.floor(elapsedMs / PLANT_SWAY_MS + seed * 0.2) % 4;
    // Vary height: some short, most tall.
    const tall = seed % 5 !== 0 && storyRows >= 8;
    const frames = tall ? PLANT_FRAMES : PLANT_FRAMES.slice(2);
    const hex = seed % 2 === 0 ? green : greenSoft;
    const lines = frames.map((row) => paint(hex, row[frameIdx] ?? ' | '));
    const top = Math.max(1, sandY - lines.length);
    blitAt(canvas, lines, top, Math.max(0, Math.min(width - 4, x)), width);
  }
}

/**
 * Paint the aquarium into `canvas[0..storyRows)`.
 *
 * Feeling first: sky-blue water, a green seaweed bed, a few cute fish.
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
    readonly gradientStart?: string;
    readonly roleUser?: string;
  };
}): void {
  const { canvas, width, storyRows, elapsedMs, showAmbient, premium, paint, colors } = options;
  if (width <= 0 || storyRows <= 0) return;

  const sky = colors.glow;
  const skyDeep = colors.gradientStart ?? colors.primary;
  const skySoft = colors.primary;
  const green = colors.success ?? colors.accent;
  // Slightly softer green for alternating fronds (accent leans teal — still watery).
  const greenSoft = colors.accent;
  const gold = colors.roleUser ?? colors.warning;
  const sand = colors.warning;

  // 1) Sky-blue water body
  if (showAmbient) {
    paintWaterField(canvas, width, storyRows, elapsedMs, paint, sky, skySoft);
  }

  // 2) Soft surface line
  if (storyRows >= 4) {
    canvas[0] = padOrTrim(
      paint(showAmbient ? skyDeep : colors.textMuted, renderWaterline(width, elapsedMs)),
      width,
    );
  }

  // 3) Warm sand bed
  const sandY = storyRows - 1;
  if (sandY > 0) {
    canvas[sandY] = padOrTrim(paint(sand, renderSandLine(width, elapsedMs, 1)), width);
  }

  // 4) Green seaweed — generous
  if (showAmbient) {
    paintSeaweed(canvas, width, storyRows, elapsedMs, paint, green, greenSoft);
  }

  // 5) Quiet bubbles
  if (showAmbient) {
    paintBubbles(canvas, width, Math.max(1, storyRows - 1), elapsedMs, (glyph, intensity) =>
      paint(intensity > 0.7 ? sky : colors.textMuted, glyph),
    );
  }

  // 6) One soft light band when premium (barely there)
  if (showAmbient && premium && storyRows >= 11 && width >= 52) {
    paintMoonlightPath(canvas, Math.floor(storyRows * 0.32), 1, width, elapsedMs, (ch) =>
      paint(ch === '≈' ? sky : skySoft, ch),
    );
  }

  // 7) Cute fish on top
  paintFishSchool(canvas, width, storyRows, elapsedMs, premium, showAmbient, paint, {
    gold,
    sky: skyDeep,
    teal: colors.accent,
    soft: sky,
    dim: colors.textDim,
  });
}
