/**
 * Appearance settings glance — live theme engine + saved prefs (SSOT §9.2).
 */

import { DEFAULT_APPEARANCE_PREFERENCES, type AppearancePreferences } from '#/tui/config';
import { darkColors, lightColors, type ColorPalette, type ThemeName } from '#/tui/theme';

export type LivePaletteKind = 'light' | 'dark' | 'custom';

export interface AppearanceSettingsGlance {
  readonly savedTheme: ThemeName;
  readonly livePalette: LivePaletteKind;
  readonly appearance: AppearancePreferences;
  readonly canvasBackgroundEnabled: boolean;
}

export interface AppearanceSettingsGlanceSources {
  readonly savedTheme: ThemeName;
  readonly palette: ColorPalette;
  readonly canvasBackgroundEnabled: boolean;
  readonly appearance?: AppearancePreferences;
}

/** Resolve the palette currently painted by the theme engine singleton. */
export function resolveLivePaletteKind(palette: ColorPalette): LivePaletteKind {
  if (palette === lightColors) return 'light';
  if (palette === darkColors) return 'dark';
  if (palette.background === lightColors.background) return 'light';
  if (palette.background === darkColors.background) return 'dark';
  return 'custom';
}

export function loadAppearanceSettingsGlance(
  sources: AppearanceSettingsGlanceSources,
): AppearanceSettingsGlance {
  return {
    savedTheme: sources.savedTheme,
    livePalette: resolveLivePaletteKind(sources.palette),
    appearance: sources.appearance ?? DEFAULT_APPEARANCE_PREFERENCES,
    canvasBackgroundEnabled: sources.canvasBackgroundEnabled,
  };
}

/** Saved theme preference + palette the renderer is actually using now. */
export function formatLiveThemeLine(glance: AppearanceSettingsGlance): string {
  const { savedTheme, livePalette } = glance;
  if (savedTheme === 'auto') {
    return `Theme: auto · live palette ${livePalette} (tracking terminal)`;
  }
  if (livePalette === 'custom' && savedTheme !== 'dark' && savedTheme !== 'light') {
    return `Theme: ${savedTheme} · live palette custom`;
  }
  if (savedTheme === livePalette) {
    return `Theme: ${savedTheme} · live palette ${livePalette}`;
  }
  return `Theme: ${savedTheme} · live palette ${livePalette}`;
}

export function formatAppearancePrefsLine(glance: AppearanceSettingsGlance): string {
  const { appearance } = glance;
  return [
    `profile ${appearance.profile}`,
    `density ${appearance.density}`,
    `timestamps ${appearance.showTimestamps ? 'on' : 'off'}`,
    `particles ${appearance.particles}`,
    `${String(appearance.animationFps)}fps`,
  ].join(' · ');
}

export function formatAppearanceBackgroundLine(glance: AppearanceSettingsGlance): string {
  const { appearance, canvasBackgroundEnabled } = glance;
  return [
    `canvas ${canvasBackgroundEnabled ? 'on' : 'off'}`,
    `terminal-bg ${appearance.terminalBackground}`,
    `palette ${appearance.terminalPalette ? 'on' : 'off'}`,
    `transcript ${appearance.transcriptDetail}`,
  ].join(' · ');
}

export function buildAppearanceSettingsLines(glance: AppearanceSettingsGlance): readonly string[] {
  return [
    '── Appearance (read-only) ───────────────────',
    'Motion, density, and background — tui.toml / /appearance.',
    '',
    '── Session (live) ───────────────────────────',
    formatLiveThemeLine(glance),
    formatAppearancePrefsLine(glance),
    formatAppearanceBackgroundLine(glance),
    '',
    '── Change ───────────────────────────────────',
    '  Settings → Theme              palette picker',
    '  /theme <name|import …>        switch without Settings',
    '  /appearance <key> <value>     profile · density · particles · …',
    '  /appearance                   status notice (same prefs)',
    '',
    'Theme name reads appState; live palette reads currentTheme at render time.',
  ];
}
