/**
 * Shared narrow-signal motion for stacked chrome bands (Todo Board, Worker Dock).
 * Pulse / shimmer only on glyphs, marks, bar index, and short chips — never on
 * body copy (PREMIUM.md §7 + Dock body-static contract).
 */

import { renderRendererRatioProgressBar } from '#/tui/renderer';

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

/** Progress-bar shimmer sweep period (shared by Todo KPI + Dock bars). */
export const CHROME_BAND_BAR_SHIMMER_MS = 1_100;

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
 * Clock-driven shimmer sweep over a ratio bar. Falls back to a static bar
 * when ambient motion is off.
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
  } = {},
): string {
  const appearance = options.appearance ?? getActiveAppearancePreferences();
  const animated =
    options.animated ?? shouldRenderAmbientEffects(appearance);
  const filledToken = options.filledToken ?? 'primary';
  if (!animated) {
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
  const filled = Math.min(width, Math.max(0, Math.round(ratio * width)));
  const shimmerIndex =
    Math.floor(
      ((now % CHROME_BAND_BAR_SHIMMER_MS) / CHROME_BAND_BAR_SHIMMER_MS) * (width + 2),
    ) - 1;
  let bar = '';
  for (let i = 0; i < width; i += 1) {
    if (i < filled) {
      bar += currentTheme.fg(i === shimmerIndex ? 'glow' : filledToken, '▓');
    } else if (i === shimmerIndex) {
      bar += currentTheme.fg('accent', '░');
    } else {
      bar += currentTheme.fg('textMuted', '░');
    }
  }
  // `seed` reserved for future per-bar phase offset.
  void options.seed;
  return bar;
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
