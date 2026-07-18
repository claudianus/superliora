/**
 * Night-sky canvas primitives for the cinematic startup splash.
 * Blood Moon glyphs, starfield paint, and blit helpers live here.
 * Empty-transcript IdleStage uses its own story scene (`idle-scene.ts`)
 * and intentionally does not share this visual language.
 */

import { truncateToWidth, visibleWidth } from '#/tui/renderer';

/** Large moon glyph (7 rows). Drawn with active theme glow/primary. */
export const MOON_LARGE = [
  '        ████████        ',
  '     ██████████████     ',
  '   ██████████████████   ',
  '  ████████████████████  ',
  '   ██████████████████   ',
  '     ██████████████     ',
  '        ████████        ',
] as const;

/** Compact moon glyph (5 rows) for narrow or short stages. */
export const MOON_COMPACT = [
  '   ██████   ',
  ' ██████████ ',
  '████████████',
  ' ██████████ ',
  '   ██████   ',
] as const;

export const STAR_GLYPHS = ['.', '·', '˚', '✦', '✧', '⋆', '+', '*'] as const;

/** Pick the largest moon that fits the stage budget. */
export function resolveMoonGlyphRows(width: number, availableRows: number): readonly string[] {
  const safeWidth = Math.max(0, Math.trunc(width));
  const rows = Math.max(0, Math.trunc(availableRows));
  if (safeWidth >= 40 && rows >= MOON_LARGE.length) return MOON_LARGE;
  if (rows >= MOON_COMPACT.length) return MOON_COMPACT;
  // Last resort: top slice of compact moon (still ≥1 row when rows > 0).
  return MOON_COMPACT.slice(0, Math.max(1, Math.min(MOON_COMPACT.length, rows)));
}

/**
 * Scatter twinkling stars onto a plain-space canvas.
 * Only paints over space cells so later layers (moon, meteor) stay intact
 * when callers paint stars first.
 */
export function paintStarfield(
  canvas: string[],
  width: number,
  rows: number,
  elapsedMs: number,
  density: number,
  style: (glyph: string, intensity: number) => string,
): void {
  if (width <= 0 || rows <= 0 || density <= 0) return;
  const count = Math.max(4, Math.floor(width * rows * density * 0.08));
  for (let i = 0; i < count; i++) {
    const seed = hash2(i * 17 + 3, Math.floor(elapsedMs / 90));
    const x = seed % width;
    const y = hash2(i * 31 + 7, 99) % rows;
    const twinkle = (Math.sin(elapsedMs / 180 + i) + 1) / 2;
    if (twinkle < 0.25) continue;
    const glyph = STAR_GLYPHS[hash2(i, 4) % STAR_GLYPHS.length] ?? '·';
    const row = canvas[y];
    if (row === undefined) continue;
    const plain = stripAnsi(row);
    if (plain[x] !== ' ' && plain[x] !== undefined) continue;
    const left = plain.slice(0, x);
    const right = plain.slice(x + 1);
    canvas[y] = padOrTrim(`${left}${style(glyph, twinkle)}${right}`, width);
  }
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
    const left = ' '.repeat(pad);
    canvas[y] = padOrTrim(left + line, width);
  }
}

export function centerText(width: number, text: string): string {
  const w = visibleWidth(text);
  if (w >= width) return truncateToWidth(text, width, '…');
  const pad = Math.floor((width - w) / 2);
  return `${' '.repeat(pad)}${text}`;
}

export function padOrTrim(text: string, width: number): string {
  const w = visibleWidth(text);
  if (w === width) return text;
  if (w > width) return truncateToWidth(text, width, '…');
  return text + ' '.repeat(width - w);
}

export function stripAnsi(text: string): string {
  return text.replaceAll(/\u001B\[[0-9;]*m/g, '');
}

export function hash2(a: number, b: number): number {
  let h = (a * 374761393 + b * 668265263) | 0;
  h = (h ^ (h >>> 13)) * 1274126177;
  // Unsigned 32-bit mix — bitwise form is intentional for starfield seeds.
  return (h ^ (h >>> 16)) >>> 0;
}
