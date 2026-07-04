import { describe, expect, it } from 'vitest';

import {
  resolveResponsiveLayout,
  responsiveDensity,
} from '#/tui/controllers/responsive-layout';

describe('responsive layout controller', () => {
  it.each([
    [{ width: 40, height: 12 }, 'tiny'],
    [{ width: 60, height: 18 }, 'compact'],
    [{ width: 80, height: 24 }, 'compact'],
    [{ width: 100, height: 30 }, 'standard'],
    [{ width: 120, height: 40 }, 'wide'],
    [{ width: 160, height: 48 }, 'ultrawide'],
  ] as const)('resolves %o to %s', (input, expected) => {
    expect(resolveResponsiveLayout(input)).toBe(expected);
  });

  it('treats short terminals as tiny even when they are wide', () => {
    expect(resolveResponsiveLayout({ width: 120, height: 12 })).toBe('tiny');
  });

  it.each([
    ['tiny', 'compact'],
    ['compact', 'compact'],
    ['standard', 'comfortable'],
    ['wide', 'spacious'],
    ['ultrawide', 'spacious'],
  ] as const)('maps %s to %s density', (profile, density) => {
    expect(responsiveDensity(profile)).toBe(density);
  });
});
