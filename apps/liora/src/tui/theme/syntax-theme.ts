/**
 * Active coding syntax theme resolution — independent of UI chrome palette.
 *
 * `auto` picks GitHub Dark Dimmed / GitHub Light from canvas luminance.
 * `palette` keeps the legacy ColorPalette → TextMate bridge.
 */

import type { ColorPalette } from './colors';
import { paletteIsDark } from './shiki-theme';
import {
  isSyntaxThemeId,
  syntaxThemeEntry,
  type SyntaxThemeId,
} from './syntax-theme-catalog';
import { SHIKI_PALETTE_THEME_NAME } from './shiki-theme';

export type { SyntaxThemeId } from './syntax-theme-catalog';
export {
  SYNTAX_THEME_CATALOG,
  SYNTAX_THEME_IDS,
  isSyntaxThemeId,
  syntaxThemeEntry,
} from './syntax-theme-catalog';

/** Preference currently applied to the highlighter (session + config). */
let activeSyntaxThemeId: SyntaxThemeId = 'auto';

export function getActiveSyntaxThemeId(): SyntaxThemeId {
  return activeSyntaxThemeId;
}

export function setActiveSyntaxThemeId(id: SyntaxThemeId | string): SyntaxThemeId {
  const next: SyntaxThemeId = isSyntaxThemeId(id) ? id : 'auto';
  activeSyntaxThemeId = next;
  return next;
}

export interface ResolvedSyntaxTheme {
  readonly preference: SyntaxThemeId;
  /**
   * Theme name passed to Shiki `codeToTokens`.
   * Either a bundled theme id or {@link SHIKI_PALETTE_THEME_NAME}.
   */
  readonly shikiThemeName: string;
  /** True when using the UI palette bridge instead of a bundled theme. */
  readonly usesPaletteBridge: boolean;
}

/**
 * Resolve the concrete Shiki theme for the current preference + UI palette.
 */
export function resolveSyntaxTheme(
  preference: SyntaxThemeId = activeSyntaxThemeId,
  palette?: ColorPalette,
): ResolvedSyntaxTheme {
  if (preference === 'palette') {
    return {
      preference,
      shikiThemeName: SHIKI_PALETTE_THEME_NAME,
      usesPaletteBridge: true,
    };
  }

  if (preference === 'auto') {
    const dark = palette === undefined ? true : paletteIsDark(palette);
    const shikiThemeName = dark ? 'github-dark-dimmed' : 'github-light';
    return {
      preference,
      shikiThemeName,
      usesPaletteBridge: false,
    };
  }

  const entry = syntaxThemeEntry(preference);
  const shikiThemeName = entry.shikiTheme ?? 'github-dark-dimmed';
  return {
    preference,
    shikiThemeName,
    usesPaletteBridge: false,
  };
}

/** Short label for toasts / status. */
export function formatSyntaxThemeLabel(id: SyntaxThemeId): string {
  return syntaxThemeEntry(id).label;
}
