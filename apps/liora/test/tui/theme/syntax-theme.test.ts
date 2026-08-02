import { describe, expect, it } from 'vitest';

import { darkColors, lightColors } from '#/tui/theme/colors';
import {
  isSyntaxThemeId,
  resolveSyntaxTheme,
  setActiveSyntaxThemeId,
} from '#/tui/theme/syntax-theme';

describe('syntax-theme', () => {
  it('resolves auto to github dimmed/light from canvas luminance', () => {
    expect(resolveSyntaxTheme('auto', darkColors).shikiThemeName).toBe('github-dark-dimmed');
    expect(resolveSyntaxTheme('auto', lightColors).shikiThemeName).toBe('github-light');
    expect(resolveSyntaxTheme('auto', darkColors).usesPaletteBridge).toBe(false);
  });

  it('keeps palette bridge mode for legacy skin-bound code colors', () => {
    const resolved = resolveSyntaxTheme('palette', darkColors);
    expect(resolved.usesPaletteBridge).toBe(true);
    expect(resolved.shikiThemeName).toBe('superliora-palette');
  });

  it('accepts curated ids and rejects unknown', () => {
    expect(isSyntaxThemeId('one-dark-pro')).toBe(true);
    expect(isSyntaxThemeId('not-a-theme')).toBe(false);
    expect(setActiveSyntaxThemeId('nord')).toBe('nord');
    expect(setActiveSyntaxThemeId('nope')).toBe('auto');
  });
});
