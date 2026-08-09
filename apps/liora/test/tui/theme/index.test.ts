import { describe, expect, it } from 'vitest';

import { DEFAULT_TUI_THEME } from '#/tui/config';
import {
  currentTheme,
  darkColors,
  getColorPalette,
  getColorPaletteSync,
  neonNoirColors,
  resolveDefaultThemePalette,
} from '#/tui/theme';

describe('theme resolution', () => {
  it('uses Neon Noir as the fixed default theme', async () => {
    const palette = await getColorPalette(DEFAULT_TUI_THEME);
    const syncPalette = getColorPaletteSync(DEFAULT_TUI_THEME);

    expect(palette.primary).toBe('#00D5FF');
    expect(palette.background).toBe('#0D1422');
    expect(palette.accent).toBe('#A78BFA');
    expect(syncPalette.primary).toBe('#00D5FF');
    expect(syncPalette.background).toBe('#0D1422');
    // Must not silently equal built-in dark (upgrade regression).
    expect(palette.primary).not.toBe(darkColors.primary);
    expect(palette.background).not.toBe(darkColors.background);
    expect(syncPalette.primary).not.toBe(darkColors.primary);
    // Loader merge matches the cycle-free boot palette on signature tokens.
    expect(palette.primary).toBe(neonNoirColors.primary);
    expect(palette.background).toBe(neonNoirColors.background);
    expect(palette.glow).toBe(neonNoirColors.glow);
  });

  it('falls back to Neon Noir when an update removed the saved theme', async () => {
    const palette = await getColorPalette('theme-removed-by-update');
    const syncPalette = getColorPaletteSync('theme-removed-by-update');

    expect(palette.primary).toBe('#00D5FF');
    expect(palette.background).toBe('#0D1422');
    expect(syncPalette.primary).toBe('#00D5FF');
    expect(syncPalette.background).toBe('#0D1422');
  });

  it('keeps explicit built-in dark available without forcing Neon Noir', async () => {
    const palette = await getColorPalette('dark');
    const syncPalette = getColorPaletteSync('dark');

    expect(palette).toBe(darkColors);
    expect(syncPalette).toBe(darkColors);
  });

  it('boots the global singleton on Neon Noir, not bare dark', () => {
    const defaults = resolveDefaultThemePalette();
    expect(defaults).toBe(neonNoirColors);
    expect(defaults.primary).toBe('#00D5FF');
    expect(defaults.background).toBe('#0D1422');
    expect(defaults.primary).not.toBe(darkColors.primary);
    // Module-load paint must already look like the product default.
    expect(currentTheme.palette.primary).toBe('#00D5FF');
    expect(currentTheme.palette.background).toBe('#0D1422');
  });
});
