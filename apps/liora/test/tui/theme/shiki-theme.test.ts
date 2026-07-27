import { describe, expect, it } from 'vitest';

import { darkColors, lightColors } from '#/tui/theme';
import {
  buildShikiPaletteTheme,
  paletteIsDark,
  SHIKI_PALETTE_THEME_NAME,
} from '#/tui/theme/shiki-theme';

function scopeForeground(
  theme: ReturnType<typeof buildShikiPaletteTheme>,
  scope: string,
): string | undefined {
  const rule = theme.settings.find((entry) =>
    Array.isArray(entry.scope) ? entry.scope.includes(scope) : entry.scope === scope,
  );
  const foreground = rule?.settings.foreground;
  return typeof foreground === 'string' ? foreground : undefined;
}

describe('buildShikiPaletteTheme', () => {
  it('names the theme and derives dark/light type from the palette background', () => {
    const dark = buildShikiPaletteTheme(darkColors);
    const light = buildShikiPaletteTheme(lightColors);
    expect(dark.name).toBe(SHIKI_PALETTE_THEME_NAME);
    expect(light.name).toBe(SHIKI_PALETTE_THEME_NAME);
    expect(dark.type).toBe('dark');
    expect(light.type).toBe('light');
    expect(paletteIsDark(darkColors)).toBe(true);
    expect(paletteIsDark(lightColors)).toBe(false);
  });

  it('maps every semantic syntax role to the matching palette token (dark)', () => {
    const theme = buildShikiPaletteTheme(darkColors);
    expect(scopeForeground(theme, 'keyword')).toBe(darkColors.syntaxKeyword);
    expect(scopeForeground(theme, 'string')).toBe(darkColors.syntaxString);
    expect(scopeForeground(theme, 'comment')).toBe(darkColors.syntaxComment);
    expect(scopeForeground(theme, 'constant.numeric')).toBe(darkColors.syntaxNumber);
    expect(scopeForeground(theme, 'entity.name.function')).toBe(darkColors.syntaxFunction);
    expect(scopeForeground(theme, 'entity.name.type')).toBe(darkColors.syntaxType);
    expect(scopeForeground(theme, 'keyword.operator')).toBe(darkColors.syntaxOperator);
    expect(scopeForeground(theme, 'entity.name.tag')).toBe(darkColors.syntaxTag);
    expect(scopeForeground(theme, 'meta')).toBe(darkColors.syntaxMeta);
    expect(scopeForeground(theme, 'variable')).toBe(darkColors.syntaxText);
  });

  it('tracks the light palette too, so engines agree across themes', () => {
    const theme = buildShikiPaletteTheme(lightColors);
    expect(scopeForeground(theme, 'keyword')).toBe(lightColors.syntaxKeyword);
    expect(scopeForeground(theme, 'entity.name.function')).toBe(lightColors.syntaxFunction);
    expect(scopeForeground(theme, 'comment')).toBe(lightColors.syntaxComment);
  });

  it('paints editor chrome from the palette', () => {
    const theme = buildShikiPaletteTheme(darkColors);
    expect(theme.colors?.['editor.foreground']).toBe(darkColors.syntaxText);
    expect(theme.colors?.['editor.background']).toBe(darkColors.background);
  });

  it('renders comments italic', () => {
    const theme = buildShikiPaletteTheme(darkColors);
    const comment = theme.settings.find((entry) =>
      Array.isArray(entry.scope) ? entry.scope.includes('comment') : entry.scope === 'comment',
    );
    expect(comment?.settings.fontStyle).toContain('italic');
  });
});
