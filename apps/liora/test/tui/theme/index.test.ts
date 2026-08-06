import { describe, expect, it } from 'vitest';

import { DEFAULT_TUI_THEME } from '#/tui/config';
import { getColorPalette, getColorPaletteSync } from '#/tui/theme';

describe('theme resolution', () => {
  it('uses Neon Noir as the fixed default theme', async () => {
    const palette = await getColorPalette(DEFAULT_TUI_THEME);

    expect(palette.primary).toBe('#00D5FF');
    expect(palette.background).toBe('#0D1422');
  });

  it('falls back to Neon Noir when an update removed the saved theme', async () => {
    const palette = await getColorPalette('theme-removed-by-update');
    const syncPalette = getColorPaletteSync('theme-removed-by-update');

    expect(palette.primary).toBe('#00D5FF');
    expect(palette.background).toBe('#0D1422');
    expect(syncPalette.primary).toBe('#00D5FF');
    expect(syncPalette.background).toBe('#0D1422');
  });
});
