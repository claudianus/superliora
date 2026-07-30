import type { PluginThemeDef } from '@superliora/sdk';

import type { ColorPalette, ResolvedTheme } from './colors';
import { getBuiltInPalette } from './colors';
import {
  setPluginThemeCatalog,
  type PluginThemeCatalogEntry,
} from './custom-theme-loader';

/** Claude token aliases → SuperLiora ColorPalette keys. */
const CLAUDE_TOKEN_ALIASES: Readonly<Record<string, keyof ColorPalette>> = {
  claude: 'primary',
  user: 'roleUser',
  assistant: 'text',
  permission: 'warning',
  bashBorder: 'shellMode',
  remember: 'accent',
};

/**
 * Register enabled plugin themes into the TUI theme catalog.
 * Call after harness/plugins are ready and after `/plugins reload`.
 */
export function applyPluginThemeCatalog(themes: readonly PluginThemeDef[]): void {
  const entries: PluginThemeCatalogEntry[] = themes.map((theme) => {
    const colors = mapThemeColors(theme.colors);
    const base: ResolvedTheme = theme.base === 'light' ? 'light' : 'dark';
    return {
      name: theme.id,
      displayName: `${theme.pluginId}: ${theme.displayName}`,
      pluginId: theme.pluginId,
      base,
      palette: { ...getBuiltInPalette(base), ...colors },
    };
  });
  setPluginThemeCatalog(entries);
}

export async function refreshPluginThemeCatalog(
  listPluginThemes: () => Promise<readonly PluginThemeDef[]>,
): Promise<void> {
  try {
    applyPluginThemeCatalog(await listPluginThemes());
  } catch {
    applyPluginThemeCatalog([]);
  }
}

function mapThemeColors(raw: Readonly<Record<string, string>>): Partial<ColorPalette> {
  const paletteKeys = new Set<string>(Object.keys(getBuiltInPalette('dark')));
  const out: Partial<ColorPalette> = {};
  for (const [key, value] of Object.entries(raw)) {
    if (!/^#[0-9a-fA-F]{6}$/.test(value)) continue;
    const mapped =
      CLAUDE_TOKEN_ALIASES[key] ??
      (paletteKeys.has(key) ? (key as keyof ColorPalette) : undefined);
    if (mapped !== undefined) out[mapped] = value;
  }
  return out;
}
