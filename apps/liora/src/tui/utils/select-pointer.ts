import { SELECT_POINTER } from '#/tui/constant/symbols';
import {
  getActiveAppearancePreferences,
  renderPulseText,
  shouldRenderAmbientEffects,
} from '#/tui/utils/appearance-effects';

/**
 * Shared selected-row pointer for list pickers.
 * Pulses under ambient effects so every selector stays demo-grade without
 * re-implementing the same clock-driven styling in each dialog.
 */
export function renderSelectPointer(seed: string): string {
  const appearance = getActiveAppearancePreferences();
  return shouldRenderAmbientEffects(appearance)
    ? renderPulseText(SELECT_POINTER, seed, 'primary')
    : SELECT_POINTER;
}
