import {
  ansiTextToCells,
  mixHexColor,
  rendererPositiveModulo,
  type RendererCell,
  type RendererCellStyle,
  type RendererRegionLine,
} from '#/tui/renderer';
import type { ColorToken } from '#/tui/theme';
import { currentTheme } from '#/tui/theme';
import { appearanceAnimationNow } from '#/tui/utils/appearance-state';

/** Ultrawork editor border — multi-hue chase that stays monospace-safe. */
const ULTRAWORK_GLOW_TOKENS: readonly ColorToken[] = [
  'particle',
  'glow',
  'primary',
  'accent',
  'gradientEnd',
  'gradientStart',
  'roleUser',
  'shellMode',
];
const EDITOR_BORDER_CHARS = new Set(['╭', '╮', '╰', '╯', '│', '─', '├', '┤', '┬', '┴', '┼']);
/** ~24 border-cells/sec — readable chase without strobe. */
const ULTRAWORK_BORDER_CHASE_MS_PER_CELL = 42;
const ULTRAWORK_BORDER_HUE_CYCLE_MS = 880;

/**
 * Smooth multi-token hue for Ultrawork chrome (border + region VFX).
 * Blends adjacent palette tokens so the edge never snaps between solids.
 */
export function resolveUltraworkBorderGlowHex(nowMs: number = appearanceAnimationNow()): string {
  const count = ULTRAWORK_GLOW_TOKENS.length;
  const phase = (Math.max(0, nowMs) / ULTRAWORK_BORDER_HUE_CYCLE_MS) % count;
  const i0 = Math.floor(phase) % count;
  const i1 = (i0 + 1) % count;
  const t = phase - Math.floor(phase);
  // Smoothstep — eases the mid-blend so the hue feels liquid, not linear RGB crawl.
  const s = t * t * (3 - 2 * t);
  return mixHexColor(
    currentTheme.color(ULTRAWORK_GLOW_TOKENS[i0]!),
    currentTheme.color(ULTRAWORK_GLOW_TOKENS[i1]!),
    s,
  );
}

export function resolveUltraworkEditorBorderStyle(
  nowMs: number = appearanceAnimationNow(),
): RendererCellStyle {
  return {
    fg: resolveUltraworkBorderGlowHex(nowMs),
    bold: true,
  };
}

/**
 * Paint a traveling highlight along the editor frame perimeter.
 * Only touches box-drawing border glyphs — prompt/text stay untouched.
 */
export function paintUltraworkEditorBorderGlow(
  lines: readonly RendererRegionLine[],
  nowMs: number = appearanceAnimationNow(),
): RendererRegionLine[] {
  if (lines.length === 0) return [];

  // Editor-replacement dialogs (approval / permission prompts) still yield ANSI
  // strings. Never Array.from() those — ESC bodies become visible `[0;1;38;2…`.
  const rows: RendererCell[][] = lines.map((line) => {
    if (typeof line === 'string') {
      return ansiTextToCells(line).map((cell) => ({
        ...cell,
        style: cell.style === undefined ? undefined : { ...cell.style },
      }));
    }
    return line.map((cell) => ({ ...cell, style: cell.style === undefined ? undefined : { ...cell.style } }));
  });

  const height = rows.length;
  const width = rows.reduce((max, row) => Math.max(max, row.length), 0);
  if (width === 0) return lines.slice();

  for (const row of rows) {
    while (row.length < width) row.push({ char: ' ' });
  }

  const path: Array<{ readonly x: number; readonly y: number }> = [];
  if (height === 1) {
    for (let x = 0; x < width; x++) path.push({ x, y: 0 });
  } else {
    for (let x = 0; x < width; x++) path.push({ x, y: 0 });
    for (let y = 1; y < height - 1; y++) path.push({ x: width - 1, y });
    for (let x = width - 1; x >= 0; x--) path.push({ x, y: height - 1 });
    for (let y = height - 2; y >= 1; y--) path.push({ x: 0, y });
  }
  if (path.length === 0) return rows;

  const head = resolveUltraworkBorderGlowHex(nowMs);
  const mid = mixHexColor(head, currentTheme.color('primary'), 0.32);
  const soft = mixHexColor(head, currentTheme.color('border'), 0.35);
  const dim = mixHexColor(soft, currentTheme.color('border'), 0.25);
  const headIndex = rendererPositiveModulo(
    Math.floor(nowMs / ULTRAWORK_BORDER_CHASE_MS_PER_CELL),
    path.length,
  );
  const trailLen = Math.min(16, Math.max(7, Math.floor(path.length / 4)));

  // Base: whole border gently tinted so Ultrawork never looks "off".
  for (const { x, y } of path) {
    const cell = rows[y]![x]!;
    if (!EDITOR_BORDER_CHARS.has(cell.char)) continue;
    rows[y]![x] = {
      ...cell,
      style: { ...cell.style, fg: dim, bold: false },
    };
  }

  // Chase head + decaying trail (clockwise).
  for (let step = 0; step <= trailLen; step++) {
    const idx = rendererPositiveModulo(headIndex - step, path.length);
    const { x, y } = path[idx]!;
    const cell = rows[y]![x]!;
    if (!EDITOR_BORDER_CHARS.has(cell.char)) continue;
    const t = step / Math.max(1, trailLen);
    const fg = t < 0.12 ? head : t < 0.4 ? mid : t < 0.72 ? soft : dim;
    rows[y]![x] = {
      ...cell,
      style: {
        ...cell.style,
        fg,
        bold: t < 0.35,
      },
    };
  }

  return rows;
}
