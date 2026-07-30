import { rendererEffectFrameIntervalMs, resolveRendererSeededIndex } from '#/tui/renderer';
import type { AppearancePreferences } from '#/tui/config';
import {
  appearanceAnimationNow,
  getActiveAppearancePreferences,
  resolveQualityAdjustedAmbientEffectMode,
  shouldRenderAmbientEffects,
} from '#/tui/utils/appearance-state';

const SHIMMER_FRAMES = ['•', '∙', '·', '◦'] as const;

export function renderShimmerPrefix(
  appearance: AppearancePreferences = getActiveAppearancePreferences(),
): string {
  if (!shouldRenderAmbientEffects(appearance)) return '';
  const mode = resolveQualityAdjustedAmbientEffectMode(appearance);
  const interval = rendererEffectFrameIntervalMs(mode, {
    premiumMs: 180,
    subtleMs: 520,
  });
  const index = resolveRendererSeededIndex({
    nowMs: appearanceAnimationNow(),
    intervalMs: interval,
    length: SHIMMER_FRAMES.length,
  }) ?? 0;
  return `${SHIMMER_FRAMES[index]!} `;
}
