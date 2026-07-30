import { describe, expect, it } from 'vitest';

import {
  clampSplashDurationMs,
  resolveSplashPhase,
} from '#/tui/components/chrome/splash-phase';

describe('splash-phase helpers', () => {
  it('clampSplashDurationMs keeps values in the cinematic window', () => {
    expect(clampSplashDurationMs(Number.NaN)).toBe(1600);
    expect(clampSplashDurationMs(500)).toBe(1000);
    expect(clampSplashDurationMs(2500)).toBe(2000);
  });

  it('resolveSplashPhase maps elapsed time to phases', () => {
    expect(resolveSplashPhase(0, 1600)).toBe('void');
    expect(resolveSplashPhase(800, 1600)).toBe('brand');
    expect(resolveSplashPhase(1600, 1600, 0)).toBe('done');
  });
});
