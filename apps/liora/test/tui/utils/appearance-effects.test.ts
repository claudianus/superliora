import { describe, expect, it } from 'vitest';

import { DEFAULT_APPEARANCE_PREFERENCES } from '#/tui/config';
import {
  appearanceAnimationFrameIntervalMs,
  setActiveAppearancePreferences,
} from '#/tui/utils/appearance-effects';

describe('premium ambient cadence', () => {
  it('pins premium ambient repaint to ~30fps (33ms), not densify 1ms', () => {
    const premium = {
      ...DEFAULT_APPEARANCE_PREFERENCES,
      profile: 'premium' as const,
      particles: 'premium' as const,
      animationFps: 120,
    };
    setActiveAppearancePreferences(premium);
    expect(appearanceAnimationFrameIntervalMs(premium)).toBe(33);
  });

  it('keeps subtle ambient slower than premium cinematic floor', () => {
    const subtle = {
      ...DEFAULT_APPEARANCE_PREFERENCES,
      profile: 'subtle' as const,
      particles: 'ambient' as const,
      animationFps: 20,
    };
    setActiveAppearancePreferences(subtle);
    expect(appearanceAnimationFrameIntervalMs(subtle)).toBeGreaterThanOrEqual(33);
  });
});
