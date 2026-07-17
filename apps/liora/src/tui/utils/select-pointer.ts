import { SELECT_POINTER } from '#/tui/constant/symbols';
import {
  appearanceAnimationNow,
  getActiveAppearancePreferences,
  renderPulseText,
  shouldRenderAmbientEffects,
} from '#/tui/utils/appearance-effects';

const PREMIUM_POINTERS = ['❯', '❱', '❯', '➢'] as const;

/**
 * Shared selected-row pointer for list pickers.
 * Pulses under ambient effects so every selector stays lively without
 * re-implementing the same clock-driven styling in each dialog.
 */
export function renderSelectPointer(seed: string): string {
  const appearance = getActiveAppearancePreferences();
  if (!shouldRenderAmbientEffects(appearance)) return SELECT_POINTER;
  const premium =
    appearance.profile === 'premium' || appearance.particles === 'premium';
  const glyph = premium
    ? PREMIUM_POINTERS[Math.floor(appearanceAnimationNow() / 240) % PREMIUM_POINTERS.length]!
    : SELECT_POINTER;
  return renderPulseText(glyph, seed, 'primary');
}
