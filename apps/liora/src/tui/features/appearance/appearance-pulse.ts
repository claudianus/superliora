import { resolveRendererSeededIndex, stripAnsiControls } from '#/tui/renderer';
import type { AppearancePreferences } from '#/tui/config';
import type { ColorToken } from '#/tui/theme';
import { currentTheme } from '#/tui/theme';
import {
  appearanceAnimationNow,
  getActiveAppearancePreferences,
  motionEffectsAllowed,
  resolveQualityAdjustedAmbientEffectMode,
} from '#/tui/features/appearance/appearance-state';
import { renderSpectacularText } from '#/tui/features/appearance/appearance-gradient';

const PULSE_GLYPH_INTERVAL_MS = 280;
const PULSE_TOKENS: readonly ColorToken[] = ['primary', 'glow', 'gradientEnd', 'particle'];

export function renderPulseText(
  text: string,
  seed: string,
  fallbackToken: ColorToken = 'primary',
  appearance: AppearancePreferences = getActiveAppearancePreferences(),
  pace: 'fast' | 'slow' = 'fast',
): string {
  const plainText = stripAnsiControls(text);
  const mode = resolveQualityAdjustedAmbientEffectMode(appearance);
  if (!motionEffectsAllowed() || mode === 'off') {
    return currentTheme.boldFg(fallbackToken, plainText);
  }
  return renderSpectacularText(plainText, seed, appearance, {
    intense: mode === 'premium',
    pace,
  });
}

export function renderPulseGlyph(
  glyphs: readonly string[],
  seed: string,
  fallback: string,
  fallbackToken: ColorToken,
  appearance: AppearancePreferences = getActiveAppearancePreferences(),
): string {
  const mode = resolveQualityAdjustedAmbientEffectMode(appearance);
  if (!motionEffectsAllowed() || mode !== 'premium' || glyphs.length === 0) {
    return currentTheme.fg(fallbackToken, fallback);
  }
  const index = resolveRendererSeededIndex({
    seed,
    nowMs: appearanceAnimationNow(),
    intervalMs: PULSE_GLYPH_INTERVAL_MS,
    length: glyphs.length,
  }) ?? 0;
  return currentTheme.boldFg(PULSE_TOKENS[index % PULSE_TOKENS.length]!, glyphs[index]!);
}
