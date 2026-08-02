/**
 * Curated coding-only syntax themes for transcript / code previews.
 * Independent of the UI chrome palette so skins stay free to recolor chrome
 * without turning every code dump into a rainbow.
 */

export type SyntaxThemeId =
  | 'auto'
  | 'palette'
  | 'github-dark-dimmed'
  | 'github-light'
  | 'one-dark-pro'
  | 'catppuccin-mocha'
  | 'nord'
  | 'solarized-dark'
  | 'solarized-light';

export interface SyntaxThemeCatalogEntry {
  readonly id: SyntaxThemeId;
  readonly label: string;
  readonly description: string;
  /** When true, theme is only suitable for dark UI canvases (and vice versa). */
  readonly polarity: 'any' | 'dark' | 'light';
  /**
   * Concrete Shiki bundled theme name when `id` is not `auto` / `palette`.
   * `auto` resolves to dark/light github variants; `palette` uses the UI
   * ColorPalette bridge theme.
   */
  readonly shikiTheme?: string;
}

export const SYNTAX_THEME_CATALOG: readonly SyntaxThemeCatalogEntry[] = [
  {
    id: 'auto',
    label: 'Auto (recommended)',
    description: 'GitHub Dimmed on dark UI · GitHub Light on light UI.',
    polarity: 'any',
  },
  {
    id: 'github-dark-dimmed',
    label: 'GitHub Dark Dimmed',
    description: 'Mild, high-readability dark coding theme (default dark).',
    polarity: 'dark',
    shikiTheme: 'github-dark-dimmed',
  },
  {
    id: 'github-light',
    label: 'GitHub Light',
    description: 'Mild light coding theme (default light).',
    polarity: 'light',
    shikiTheme: 'github-light',
  },
  {
    id: 'one-dark-pro',
    label: 'One Dark Pro',
    description: 'Atom-style dark theme — popular and calm.',
    polarity: 'dark',
    shikiTheme: 'one-dark-pro',
  },
  {
    id: 'catppuccin-mocha',
    label: 'Catppuccin Mocha',
    description: 'Soft pastel dark theme, low contrast fatigue.',
    polarity: 'dark',
    shikiTheme: 'catppuccin-mocha',
  },
  {
    id: 'nord',
    label: 'Nord',
    description: 'Cool arctic palette — muted and consistent.',
    polarity: 'dark',
    shikiTheme: 'nord',
  },
  {
    id: 'solarized-dark',
    label: 'Solarized Dark',
    description: 'Classic balanced dark coding palette.',
    polarity: 'dark',
    shikiTheme: 'solarized-dark',
  },
  {
    id: 'solarized-light',
    label: 'Solarized Light',
    description: 'Classic balanced light coding palette.',
    polarity: 'light',
    shikiTheme: 'solarized-light',
  },
  {
    id: 'palette',
    label: 'Match UI palette',
    description: 'Bind code colors to the active UI skin (legacy).',
    polarity: 'any',
  },
] as const;

export const SYNTAX_THEME_IDS = SYNTAX_THEME_CATALOG.map((e) => e.id);

export function isSyntaxThemeId(value: string): value is SyntaxThemeId {
  return (SYNTAX_THEME_IDS as readonly string[]).includes(value);
}

export function syntaxThemeEntry(id: SyntaxThemeId): SyntaxThemeCatalogEntry {
  return SYNTAX_THEME_CATALOG.find((e) => e.id === id) ?? SYNTAX_THEME_CATALOG[0]!;
}
