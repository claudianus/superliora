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

/** ChoicePicker tip — saved theme vs live palette the renderer paints now. */
export const APPEARANCE_THEME_TIP =
  'Theme: saved name in appState/tui.toml · live palette from currentTheme at render (auto tracks terminal) · Settings → Theme palette picker · /theme <name|import …>.';

/** ChoicePicker tip — motion profile, density, particles, and animation clock. */
export const APPEARANCE_MOTION_TIP =
  'Motion: profile auto|off|subtle|premium · particles auto|off|ambient|events|premium · animation-fps 1–60 · density auto|compact|comfortable|spacious · timestamps on|off · /appearance <key> <value> · tui.toml [appearance].';

/** ChoicePicker tip — canvas, terminal background, palette injection, transcript detail. */
export const APPEARANCE_BACKGROUND_TIP =
  'Background: canvas-background on|off · terminal-background off|session · terminal-palette on|off · transcript-detail minimal|compact|standard|full · /appearance or /transcript for live projection.';

/** ChoicePicker tip — menu actions + slash paths persist the same prefs. */
export const APPEARANCE_CHANGE_TIP =
  'Change: Settings → Appearance pickers persist tui.toml · /appearance <key> <value> · /transcript for density · Settings → Theme for palette · Settings → Visual Quality for harness PQ toggle.';

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
    '── Appearance ───────────────────────────────',
    'Motion, density, and background — menu pickers or /appearance.',
    '',
    '── Session (live) ───────────────────────────',
    formatLiveThemeLine(glance),
    formatAppearancePrefsLine(glance),
    formatAppearanceBackgroundLine(glance),
    '',
    '── Change ───────────────────────────────────',
    '  Settings → Appearance         live pickers (persist tui.toml)',
    '  Settings → Theme              palette picker',
    '  /transcript                   density picker',
    '  /appearance <key> <value>     profile · density · particles · …',
    '',
    'Theme name reads appState; live palette reads currentTheme at render time.',
  ];
}
