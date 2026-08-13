import { describe, expect, it } from 'vitest';

import { landingDocsHref, landingHomeHref } from '../src/lib/locale';
import { clampScrollProgress, motionEnabled } from '../src/lib/motion';

describe('clampScrollProgress', () => {
  it('returns 0 when the page cannot scroll', () => {
    expect(clampScrollProgress(80, 800, 800)).toBe(0);
    expect(clampScrollProgress(80, 400, 800)).toBe(0);
  });

  it('clamps below zero and past the end', () => {
    expect(clampScrollProgress(-12, 2000, 800)).toBe(0);
    expect(clampScrollProgress(1400, 2000, 800)).toBe(1);
  });

  it('returns the mid-page ratio against the real formula', () => {
    expect(clampScrollProgress(300, 2000, 800)).toBe(300 / 1200);
  });
});

describe('motionEnabled', () => {
  it('allows motion unless reduced-motion is requested', () => {
    expect(motionEnabled(false)).toBe(true);
    expect(motionEnabled(true)).toBe(false);
  });
});

describe('locale landing routes', () => {
  it('builds home and docs paths for both locales from the shipped helper', () => {
    expect(landingHomeHref('ko', '/superliora/')).toBe('/superliora/');
    expect(landingHomeHref('en', '/superliora')).toBe('/superliora/en/');
    expect(landingDocsHref('ko', '/superliora/')).toBe('/superliora/docs/getting-started.html');
    expect(landingDocsHref('en', '/superliora/')).toBe('/superliora/en/docs/getting-started.html');
  });
});
