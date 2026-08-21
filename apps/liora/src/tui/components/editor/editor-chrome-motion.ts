/**
 * Live perimeter chase for the prompt editor box.
 *
 * Recolors only ╭╮╰╯├┤─│ cells on the outer rectangle. Prompt, text, and the
 * inner scrollbar stay put. Motion rides the shared appearance clock
 * (PREMIUM.md §6 / §7.1) — no private timer.
 */

import {
  mixHexColor,
  type RendererCell,
  type RendererRegionLine,
} from '#/tui/renderer';

import type { AppearancePreferences } from '#/tui/config';
import {
  appearanceAnimationNow,
  getActiveAppearancePreferences,
  resolveQualityAdjustedAmbientEffectMode,
  shouldRenderAmbientEffects,
} from '#/tui/features/appearance/appearance-effects';
import { currentTheme } from '#/tui/theme';

const BORDER_GLYPHS = new Set(['╭', '╮', '╰', '╯', '├', '┤', '─', '│']);
const HUE_BREATH_MS = 4200;
/** Phase-offset vs Command Hub so neighboring live frames are not in lockstep. */
const EDITOR_BREATH_PHASE_MS = 700;
const EDITOR_CHASE_PHASE = 11.3;
const PREMIUM_CHASE_MS = 28;
const SUBTLE_CHASE_MS = 48;
const PREMIUM_TRAIL = 10;
const SUBTLE_TRAIL = 4;

export interface EditorChromeChaseOptions {
  readonly appearance?: AppearancePreferences;
  readonly nowMs?: number;
  /** Override the ambient gate — tests force a live or static pass. */
  readonly animated?: boolean;
}

function isBorderGlyph(char: string): boolean {
  return BORDER_GLYPHS.has(char);
}

/** Float-preserving wrap so the chase eases between cells (rendererPositiveModulo truncates). */
function liveModulo(value: number, modulo: number): number {
  if (!Number.isFinite(modulo) || modulo <= 0) return 0;
  return ((value % modulo) + modulo) % modulo;
}

function lineWidth(line: RendererRegionLine): number {
  return typeof line === 'string' ? line.length : line.length;
}

/** Clockwise path index from top-left, or undefined for interior cells. */
export function editorChromePerimeterIndex(
  x: number,
  y: number,
  width: number,
  height: number,
): number | undefined {
  if (width < 2 || height < 2) return undefined;
  if (y === 0) return x;
  if (y === height - 1) return width + Math.max(0, height - 2) + (width - 1 - x);
  if (x === width - 1) return width + (y - 1);
  if (x === 0) return 2 * width + Math.max(0, height - 2) + (height - 2 - y);
  return undefined;
}

/**
 * Recolor the editor box perimeter with a clockwise comet trail and a slow
 * hue breath. Returns the same `lines` reference when motion is off.
 */
export function applyEditorChromeChase(
  lines: readonly RendererRegionLine[],
  options: EditorChromeChaseOptions = {},
): readonly RendererRegionLine[] {
  const appearance = options.appearance ?? getActiveAppearancePreferences();
  const animated = options.animated ?? shouldRenderAmbientEffects(appearance);
  if (!animated || lines.length < 2) return lines;

  const width = Math.max(0, ...lines.map(lineWidth));
  const height = lines.length;
  if (width < 5) return lines;

  const mode = resolveQualityAdjustedAmbientEffectMode(appearance);
  if (mode === 'off') return lines;

  const now = options.nowMs ?? appearanceAnimationNow();
  const trail = mode === 'subtle' ? SUBTLE_TRAIL : PREMIUM_TRAIL;
  const chaseMs = mode === 'subtle' ? SUBTLE_CHASE_MS : PREMIUM_CHASE_MS;
  const perimeter = 2 * width + 2 * height - 4;
  if (perimeter <= 0) return lines;

  const head = liveModulo(now / chaseMs + EDITOR_CHASE_PHASE, perimeter);
  const breath =
    (Math.sin((2 * Math.PI * (now + EDITOR_BREATH_PHASE_MS)) / HUE_BREATH_MS) + 1) / 2;
  const glowHex = currentTheme.color('glow');
  const accentHex = currentTheme.color('accent');
  const fallbackBase = currentTheme.color('primary');
  const breathAmt = mode === 'premium' ? 0.35 : 0.15;

  const hexAt = (s: number, idleHex: string): string => {
    const base = mixHexColor(idleHex, accentHex, breath * breathAmt);
    const dist = liveModulo(head - s, perimeter);
    if (dist > trail) return base;
    if (dist <= 1) return glowHex;
    const t = dist / (trail + 1);
    const ease = t * t * (3 - 2 * t);
    return mixHexColor(glowHex, base, ease);
  };

  let changed = false;
  const next: RendererRegionLine[] = lines.map((line, y) => {
    if (typeof line === 'string') return line;
    let rowDirty = false;
    const cells: RendererCell[] = line.map((cell, x) => {
      if (!isBorderGlyph(cell.char)) return cell;
      const s = editorChromePerimeterIndex(x, y, width, height);
      if (s === undefined) return cell;
      const idleHex = cell.style?.fg ?? fallbackBase;
      const fg = hexAt(s, idleHex);
      const bold = mode === 'premium' && liveModulo(head - s, perimeter) <= 2;
      if (cell.style?.fg === fg && cell.style.bold === bold) return cell;
      rowDirty = true;
      return {
        ...cell,
        style: { ...cell.style, fg, bold },
      };
    });
    if (!rowDirty) return line;
    changed = true;
    return cells;
  });
  return changed ? next : lines;
}
