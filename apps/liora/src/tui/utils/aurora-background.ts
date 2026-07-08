/**
 * Ambient aurora background — a slow, low-intensity multi-point gradient wash
 * painted as per-cell background colours over the base `background` token.
 *
 * The aurora is a bottom-most full-frame layer: every cell carries only a
 * `bg` style (no foreground), so text rendered on top keeps its own colour and
 * readability is preserved. Each anchor colour (auroraA/B/C) is blended into
 * the base background at a capped intensity (≤ ~0.22 premium, ≤ ~0.12 subtle),
 * so the base canvas always stays dominant.
 *
 * Animation reuses the shared appearance clock and degrades gracefully:
 * `off` → flat base background, `subtle` → static faint gradient, `premium` →
 * animated drift. SSH / NO_COLOR / CI / TERM=dumb stop it entirely.
 */

import {
  mixHexColor,
  triangleWave,
  type RendererCell,
} from '#/tui/renderer';
import type { AppearancePreferences } from '#/tui/config';
import type { ColorPalette } from '#/tui/theme';
import { currentTheme } from '#/tui/theme';
import {
  motionEffectsAllowed,
  resolveQualityAdjustedAmbientEffectMode,
} from '#/tui/utils/appearance-effects';

const AURORA_CYCLE_MS = 11_000;
const AURORA_SPAN = 48;
const FLOW_X = 0.6;
const FLOW_Y = 0.4;

const INTENSITY_PREMIUM = 0.22;
const INTENSITY_SUBTLE = 0.12;

export type AuroraRow = readonly RendererCell[];

export interface AuroraBackgroundOptions {
  readonly width: number;
  readonly height: number;
  readonly nowMs: number;
  readonly appearance: AppearancePreferences;
}

export function buildAuroraBackground(options: AuroraBackgroundOptions): readonly AuroraRow[] {
  const width = Math.max(0, Math.trunc(options.width));
  const height = Math.max(0, Math.trunc(options.height));
  if (width === 0 || height === 0) return [];

  const palette = currentTheme.palette;
  const base = palette.background;
  const mode = resolveAuroraMode(options.appearance);

  if (mode === 'off') {
    return buildFlatBackground(width, height, base);
  }

  const intensity = mode === 'premium' ? INTENSITY_PREMIUM : INTENSITY_SUBTLE;
  const animated = mode === 'premium';
  const phase = animated ? triangleWave(options.nowMs / AURORA_CYCLE_MS) : 0;

  const rows: AuroraRow[] = [];
  for (let y = 0; y < height; y++) {
    const row: RendererCell[] = new Array(width);
    for (let x = 0; x < width; x++) {
      row[x] = auroraCell(x, y, phase, intensity, palette, base, animated);
    }
    rows.push(row);
  }
  return rows;
}

export function resolveAuroraMode(appearance: AppearancePreferences): 'off' | 'subtle' | 'premium' {
  if (!motionEffectsAllowed()) return 'off';
  return resolveQualityAdjustedAmbientEffectMode(appearance);
}

function buildFlatBackground(width: number, height: number, base: string): readonly AuroraRow[] {
  const row: RendererCell[] = new Array(width);
  for (let x = 0; x < width; x++) {
    row[x] = { char: ' ', style: { bg: base } };
  }
  return Array.from({ length: height }, () => row);
}

function auroraCell(
  x: number,
  y: number,
  phase: number,
  intensity: number,
  palette: ColorPalette,
  base: string,
  animated: boolean,
): RendererCell {
  const position = ((x * FLOW_X + y * FLOW_Y) / AURORA_SPAN) % 1;
  const t = animated ? positiveModulo(position + phase, 1) : position;
  const color = sampleAuroraGradient(t, palette, base, intensity);
  return { char: ' ', style: { bg: color } };
}

function sampleAuroraGradient(
  t: number,
  palette: ColorPalette,
  base: string,
  intensity: number,
): string {
  const a = palette.auroraA;
  const b = palette.auroraB;
  const c = palette.auroraC;
  const anchor = t < 0.5 ? mixHexColor(a, b, t * 2) : mixHexColor(b, c, (t - 0.5) * 2);
  return mixHexColor(base, anchor, intensity);
}

function positiveModulo(value: number, modulo: number): number {
  if (!Number.isFinite(value) || !Number.isFinite(modulo) || modulo <= 0) return 0;
  return ((value % modulo) + modulo) % modulo;
}
