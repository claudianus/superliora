import { describe, expect, it } from 'vitest';

import {
  buildThemeSettingsLines,
  formatThemeCatalogLine,
  loadThemeSettingsGlance,
  resolveLivePaletteKind,
} from '#/tui/utils/theme/theme-glance';
import { darkColors, lightColors } from '#/tui/theme';

describe('theme glance', () => {
  it('resolves live palette kind', () => {
    expect(resolveLivePaletteKind(lightColors)).toBe('light');
    expect(resolveLivePaletteKind(darkColors)).toBe('dark');
  });

  it('formats catalog counts', () => {
    const line = formatThemeCatalogLine({
      totalListed: 12,
      bundled: 4,
      custom: 2,
      plugin: 1,
      bundledExternal: 5,
    });
    expect(line).toContain('12 listed');
    expect(line).toContain('4 bundled');
  });

  it('builds tip-heavy panel with live session block', () => {
    const text = buildThemeSettingsLines(
      loadThemeSettingsGlance({
        savedTheme: 'auto',
        palette: lightColors,
        canvasBackgroundEnabled: true,
        configPath: '/home/.superliora/tui.toml',
      }),
    ).join('\n');
    expect(text).toContain('── Session (live) ─');
    expect(text).toContain('Theme: auto · live palette light (tracking terminal)');
    expect(text).toContain('Catalog:');
    expect(text).toContain('/theme import');
    expect(text).toContain('Settings → Appearance');
  });
});
