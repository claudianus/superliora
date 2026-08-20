/**
 * Shared narrow-signal motion for stacked chrome bands (Todo Board, Worker Dock).
 * Pulse / shimmer only on glyphs, marks, bar index, and short chips — never on
 * body copy (PREMIUM.md §7 + Dock body-static contract).
 */

import chalk from 'chalk';

import { hashRendererEffectSeed, mixHexColor, renderRendererRatioProgressBar } from '#/tui/renderer';

import { PULSE_ACTIVE_FRAMES } from '#/tui/constant/symbols';
import { currentTheme } from '#/tui/theme';
import type { ColorToken } from '#/tui/theme';
import type { AppearancePreferences } from '#/tui/config';
import {
  appearanceAnimationNow,
  getActiveAppearancePreferences,
  renderPulseGlyph,
  renderPulseText,
  shouldRenderAmbientEffects,
} from '#/tui/features/appearance/appearance-effects';

/** Progress-bar shimmer sweep period (shared by Todo KPI + Dock + footer). */
export const CHROME_BAND_BAR_SHIMMER_MS = 1_100;

/** Cosine trail length — ≥4 cells so the wash is never a one-cell blink. */
const CHROME_BAND_BAR_TRAIL = 6;

const EIGHTHS = ['', '▏', '▎', '▍', '▌', '▋', '▊', '▉'] as const;

/** Live section header: optional pulse dot + muted bold label. */
export function renderLiveSectionHeader(
  label: string,
  live: boolean,
  seedPrefix = 'chrome:sec',
  appearance: AppearancePreferences = getActiveAppearancePreferences(),
): string {
  const title = currentTheme.boldFg('textMuted', label);
  if (live && shouldRenderAmbientEffects(appearance)) {
    return `${renderPulseGlyph(PULSE_ACTIVE_FRAMES, `${seedPrefix}:${label}`, '●', 'primary', appearance)} ${title}`;
  }
  return title;
}

/**
 * Clock-driven cosine gradient sweep over a ratio bar. Falls back to a static
 * bar when ambient motion is off. `seed` phase-offsets sibling bars so they
 * do not lock-step.
 */
export function renderLiveRatioBar(
  ratio: number,
  width: number,
  options: {
    readonly now?: number;
    readonly seed?: string;
    readonly animated?: boolean;
    readonly appearance?: AppearancePreferences;
    readonly filledToken?: ColorToken;
    readonly eighths?: boolean;
  } = {},
): string {
  const appearance = options.appearance ?? getActiveAppearancePreferences();
  const animated =
    options.animated ?? shouldRenderAmbientEffects(appearance);
  const filledToken = options.filledToken ?? 'primary';
  const cells = ratioBarCells(ratio, width, options.eighths === true);
  if (width <= 0) return '';
  if (!animated) {
    if (options.eighths === true) {
      return currentTheme.boldFg(filledToken, cells.glyphs.join(''));
    }
    return renderRendererRatioProgressBar({
      ratio,
      width,
      filledChar: '▓',
      emptyChar: '░',
      filledStyle: (text) => currentTheme.fg(filledToken, text),
      emptyStyle: (text) => currentTheme.fg('textMuted', text),
    });
  }
  const now = options.now ?? appearanceAnimationNow();
  const seedOffset =
    options.seed !== undefined && options.seed.length > 0
      ? hashRendererEffectSeed(options.seed) % CHROME_BAND_BAR_SHIMMER_MS
      : 0;
  const cycle =
    ((now + seedOffset) % CHROME_BAND_BAR_SHIMMER_MS) / CHROME_BAND_BAR_SHIMMER_MS;
  const head = cycle * width;
  const trail = Math.max(1, Math.min(width, CHROME_BAND_BAR_TRAIL));
  const filledHex = currentTheme.color(filledToken);
  const glowHex = currentTheme.color('glow');
  const accentHex = currentTheme.color('accent');
  const mutedHex = currentTheme.color('textMuted');
  let bar = '';
  for (let i = 0; i < width; i += 1) {
    const wash = chromeBandSweepWash(i, head, width, trail);
    const glyph = cells.glyphs[i] ?? '░';
    if (i < cells.filled) {
      bar += chalk.hex(mixHexColor(filledHex, glowHex, wash * 0.85))(glyph);
    } else {
      bar += chalk.hex(mixHexColor(mutedHex, accentHex, wash * 0.4))(glyph);
    }
  }
  return bar;
}

/** Raised-cosine falloff from the travelling head (wraps so full/empty bars still move). */
function chromeBandSweepWash(
  index: number,
  head: number,
  width: number,
  trail: number,
): number {
  if (width <= 0 || trail <= 0) return 0;
  let dist = Math.abs(index - head);
  dist = Math.min(dist, width - dist);
  const t = 1 - dist / trail;
  if (t <= 0) return 0;
  return 0.5 - 0.5 * Math.cos(Math.PI * Math.min(1, t));
}

function ratioBarCells(
  ratio: number,
  width: number,
  eighths: boolean,
): { readonly glyphs: readonly string[]; readonly filled: number } {
  if (width <= 0) return { glyphs: [], filled: 0 };
  const clamped = Math.min(1, Math.max(0, Number.isFinite(ratio) ? ratio : 0));
  if (!eighths) {
    const filled = Math.min(width, Math.max(0, Math.round(clamped * width)));
    return {
      glyphs: Array.from({ length: width }, (_, i) => (i < filled ? '▓' : '░')),
      filled,
    };
  }
  const totalEighths = Math.max(0, Math.min(width * 8, Math.round(clamped * width * 8)));
  const fullCells = Math.floor(totalEighths / 8);
  const rem = totalEighths % 8;
  const partial = EIGHTHS[rem] ?? '';
  const filled = fullCells + (partial.length > 0 ? 1 : 0);
  const glyphs: string[] = [];
  for (let i = 0; i < width; i += 1) {
    if (i < fullCells) glyphs.push('█');
    else if (i === fullCells && partial.length > 0) glyphs.push(partial);
    else glyphs.push('░');
  }
  return { glyphs, filled };
}

/** Short count / rate chip — pulses when ambient is on. */
export function renderPulseCountChip(
  text: string,
  seed: string,
  token: ColorToken = 'primary',
  appearance: AppearancePreferences = getActiveAppearancePreferences(),
): string {
  if (text.length === 0) return '';
  if (shouldRenderAmbientEffects(appearance)) {
    return renderPulseText(text, seed, token, appearance);
  }
  return currentTheme.fg(token, text);
}

/** Whether a chrome band should skip render memo (clock-driven paint). */
export function chromeBandAnimating(flags: {
  /** WIP bar / pulse chips need the clock while ambient is on. */
  readonly live?: boolean;
  readonly revealPending?: boolean;
  readonly marquee?: boolean;
  readonly changeFlash?: boolean;
}): boolean {
  return (
    flags.live === true ||
    flags.revealPending === true ||
    flags.marquee === true ||
    flags.changeFlash === true
  );
}
