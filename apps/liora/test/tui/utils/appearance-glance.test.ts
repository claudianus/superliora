import { describe, expect, it } from 'vitest';

import { DEFAULT_APPEARANCE_PREFERENCES } from '#/tui/config';
import { darkColors, lightColors } from '#/tui/theme';
import {
  buildAppearanceSettingsLines,
  formatLiveThemeLine,
  loadAppearanceSettingsGlance,
  resolveLivePaletteKind,
} from '#/tui/utils/appearance/appearance-glance';

describe('appearance theme glance', () => {
  it('resolves live palette kind from theme engine singleton', () => {
    expect(resolveLivePaletteKind(lightColors)).toBe('light');
    expect(resolveLivePaletteKind(darkColors)).toBe('dark');
    expect(resolveLivePaletteKind({ ...darkColors, background: '#010203' })).toBe('custom');
  });

  it('formats auto theme with terminal-tracked live palette', () => {
    const line = formatLiveThemeLine(
      loadAppearanceSettingsGlance({
        savedTheme: 'auto',
        palette: lightColors,
        canvasBackgroundEnabled: true,
      }),
    );
    expect(line).toBe('Theme: auto · live palette light (tracking terminal)');
  });

  it('formats custom saved theme with live custom palette', () => {
    const line = formatLiveThemeLine(
      loadAppearanceSettingsGlance({
        savedTheme: 'superliora-ash',
        palette: { ...darkColors, background: '#010203' },
        canvasBackgroundEnabled: false,
      }),
    );
    expect(line).toBe('Theme: superliora-ash · live palette custom');
  });

  it('builds settings panel with live session block', () => {
    const text = buildAppearanceSettingsLines(
      loadAppearanceSettingsGlance({
        savedTheme: 'dark',
        palette: darkColors,
        canvasBackgroundEnabled: true,
        appearance: {
          ...DEFAULT_APPEARANCE_PREFERENCES,
          profile: 'premium',
          density: 'compact',
        },
      }),
    ).join('\n');
    expect(text).toContain('── Session (live) ─');
    expect(text).toContain('Theme: dark · live palette dark');
    expect(text).toContain('profile premium');
    expect(text).toContain('canvas on');
  });
});
