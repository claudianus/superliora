/**
 * Theme settings glance — live palette + catalog counts (SSOT §9.2).
 */

import { getTuiConfigPath } from '#/tui/config';
import {
  listAvailableThemeEntriesSync,
  type ThemeListEntry,
  type ThemeSource,
} from '#/tui/theme/custom-theme-loader';
import type { ThemeName } from '#/tui/theme';
import {
  formatLiveThemeLine,
  loadAppearanceSettingsGlance,
  resolveLivePaletteKind,
  type AppearanceSettingsGlance,
} from '#/tui/utils/appearance/appearance-glance';

export interface ThemeCatalogCounts {
  readonly bundled: number;
  readonly custom: number;
  readonly plugin: number;
  readonly bundledExternal: number;
  readonly totalListed: number;
}

export interface ThemeSettingsGlance {
  readonly appearance: AppearanceSettingsGlance;
  readonly catalog: ThemeCatalogCounts;
  readonly configPath: string;
}

export interface ThemeSettingsGlanceSources {
  readonly savedTheme: ThemeName;
  readonly palette: import('#/tui/theme').ColorPalette;
  readonly canvasBackgroundEnabled: boolean;
  readonly configPath?: string;
}

function countThemesBySource(entries: readonly ThemeListEntry[]): ThemeCatalogCounts {
  const counts: Record<ThemeSource, number> = {
    bundled: 0,
    custom: 0,
    plugin: 0,
    'bundled-external': 0,
  };
  for (const entry of entries) {
    counts[entry.source] += 1;
  }
  return {
    bundled: counts.bundled,
    custom: counts.custom,
    plugin: counts.plugin,
    bundledExternal: counts['bundled-external'],
    totalListed: entries.length,
  };
}

export function loadThemeSettingsGlance(sources: ThemeSettingsGlanceSources): ThemeSettingsGlance {
  return {
    appearance: loadAppearanceSettingsGlance({
      savedTheme: sources.savedTheme,
      palette: sources.palette,
      canvasBackgroundEnabled: sources.canvasBackgroundEnabled,
    }),
    catalog: countThemesBySource(listAvailableThemeEntriesSync()),
    configPath: sources.configPath ?? getTuiConfigPath(),
  };
}

export function formatThemeCatalogLine(catalog: ThemeCatalogCounts): string {
  return [
    `${String(catalog.totalListed)} listed`,
    `${String(catalog.bundled)} bundled`,
    `${String(catalog.custom)} custom`,
    `${String(catalog.plugin)} plugin`,
    `${String(catalog.bundledExternal)} external`,
  ].join(' · ');
}

export function formatSavedThemeLine(glance: ThemeSettingsGlance): string {
  return formatLiveThemeLine(glance.appearance);
}

export function formatCanvasBackgroundLine(glance: ThemeSettingsGlance): string {
  const { canvasBackgroundEnabled } = glance.appearance;
  return `Canvas background: ${canvasBackgroundEnabled ? 'on' : 'off'} · tui.toml [appearance]`;
}

/** Re-export for tests that assert palette resolution without loading the full glance. */
export { resolveLivePaletteKind };

export function buildThemeSettingsLines(glance: ThemeSettingsGlance): readonly string[] {
  const { savedTheme, livePalette } = glance.appearance;
  const trackingLine =
    savedTheme === 'auto'
      ? 'Auto theme tracks terminal OSC 11 / background reports while active.'
      : savedTheme === livePalette
        ? 'Saved theme matches the live palette.'
        : 'Saved name may differ from live palette until /reload tui.';

  return [
    '── Theme (read-only) ────────────────────────',
    'Terminal palette — Sovereign Reform §9.2.',
    '',
    '── Session (live) ───────────────────────────',
    formatSavedThemeLine(glance),
    formatCanvasBackgroundLine(glance),
    `Catalog: ${formatThemeCatalogLine(glance.catalog)}`,
    `Config: ${glance.configPath}`,
    trackingLine,
    '',
    '── Change palette ───────────────────────────',
    '  Settings → Theme              searchable picker + preview',
    '  /theme <dark|light|auto|name> apply without Settings',
    '  /theme import <path|url|…>    add ~/.superliora/themes JSON',
    '  tui.toml theme = "…"          persisted preference',
    '',
    '── Tips ─────────────────────────────────────',
    '· Motion, density, particles — Settings → Appearance or /appearance',
    '· Custom themes: JSON under ~/.superliora/themes (schema in docs)',
    '· Plugin themes appear when a plugin registers a catalog entry',
    '· External terminal themes are searchable in the picker, not default-listed',
    '· savedTheme reads appState; live palette reads currentTheme at render time',
  ];
}
