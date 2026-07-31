/**
 * Jewel Tank canvas/cell primitives — text layout helpers, the ANSI
 * cell-expand/serialize pair, the per-frame "story cell session" batching
 * layer, and the low-level `blitAt`/`putCell` paint primitives.
 *
 * Split out of `idle-scene.ts`; no behavior change.
 */

import {
  ansiTextToCells,
  styleToAnsi,
  truncateToWidth,
  visibleWidth,
  type RendererCell,
} from '#/tui/renderer';

export const ANSI_RESET = '\u001B[0m';

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
export function expandLineCells(line: string, width: number): RendererCell[] {
  const cells: RendererCell[] = [];
  for (const cell of ansiTextToCells(line)) {
    if (cell.continuation === true) continue;
    cells.push(cell);
    if (cells.length >= width) break;
  }
  while (cells.length < width) {
    const prev = cells.at(-1);
    const bg = prev?.style?.bg;
    cells.push(bg === undefined ? { char: ' ' } : { char: ' ', style: { bg } });
  }
  return cells.slice(0, width);
}

/** Serialize cells back to ANSI without stripping neighboring styles. */
export function cellsToAnsiLine(cells: readonly RendererCell[]): string {
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

export function beginStoryCellSession(canvas: string[], storyRows: number, width: number): void {
  storyAnsiCanvas = canvas;
  storyCellRows = Array.from({ length: storyRows }, () =>
    Array.from({ length: width }, () => ({ char: ' ' })),
  );
}

export function flushStoryCellSession(storyRows: number): void {
  if (storyCellRows === undefined || storyAnsiCanvas === undefined) return;
  for (let y = 0; y < storyRows; y++) {
    const row = storyCellRows[y];
    if (row !== undefined) storyAnsiCanvas[y] = cellsToAnsiLine(row);
  }
  storyCellRows = undefined;
  storyAnsiCanvas = undefined;
}

export function inStoryCellSession(canvas: string[]): boolean {
  return storyCellRows !== undefined && storyAnsiCanvas === canvas;
}

/** Overwrite one row of the active story cell layer (no-op outside a session). */
export function setStoryCellRow(y: number, row: RendererCell[]): void {
  if (storyCellRows === undefined) return;
  storyCellRows[y] = row;
}

const waterCellStyleCache = new Map<string, RendererCell>();

export function waterCell(char: string, fg: string | undefined, bg: string): RendererCell {
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

/** Test helper — drop the canvas-layer paint caches owned by this module. */
export function resetIdleSceneCanvasCachesForTests(): void {
  waterCellStyleCache.clear();
  storyCellRows = undefined;
  storyAnsiCanvas = undefined;
}

export function cloneCellRow(row: readonly RendererCell[]): RendererCell[] {
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

export function hash2(a: number, b: number): number {
  let x = Math.imul(a, 374761393) + Math.imul(b, 668265263);
  x = Math.imul(x ^ (x >>> 13), 1274126177);
  return (x ^ (x >>> 16)) >>> 0;
}

export function resolveSeaweedSpacing(width: number): number {
  if (width >= 80) return 6;
  if (width >= 50) return 8;
  return 10;
}

const SOFT_CELLS = new Set([' ', '·', '˙', '~', '∼', '˚']);

/** One cell. `glyph` may include full ANSI — preserve other cells' styles. */
export function putCell(
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
