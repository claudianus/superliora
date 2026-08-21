import { SELECT_POINTER } from '#/tui/constant/symbols';
import {
  getActiveAppearancePreferences,
  renderPulseText,
  shouldRenderAmbientEffects,
} from '#/tui/features/appearance/appearance-effects';

/**
 * Shared selected-row pointer for list pickers.
 * Pulses under ambient effects so every selector stays demo-grade without
 * re-implementing the same clock-driven styling in each dialog.
 * Glyph stays SELECT_POINTER (PREMIUM.md §2) — motion is the color breath.
 */
export function renderSelectPointer(seed: string): string {
  const appearance = getActiveAppearancePreferences();
  // Hard-off: motionEffectsAllowed / profile / particles via shouldRenderAmbientEffects.
  if (!shouldRenderAmbientEffects(appearance)) return SELECT_POINTER;
  return renderPulseText(SELECT_POINTER, seed, 'primary');
}
