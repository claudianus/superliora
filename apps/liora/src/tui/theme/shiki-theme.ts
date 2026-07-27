/**
 * A TextMate theme for Shiki derived from the app {@link ColorPalette}.
 *
 * The role → palette-token mapping mirrors `buildSyntaxHighlightTheme`
 * (the cli-highlight fallback) one-to-one, so both highlighting engines
 * render identical colors for the same active theme. Shiki previously used
 * hardcoded VS Code `dark-plus`/`light-plus` themes, which ignored custom
 * and imported ANSI themes entirely — this builder is the single source of
 * truth that keeps Shiki bound to the theme system.
 */
import type { ThemeRegistrationRaw } from 'shiki';

import type { ColorPalette } from './colors';

/** Registered Shiki theme name; stable across palette refreshes. */
export const SHIKI_PALETTE_THEME_NAME = 'superliora-palette';

/** True when the palette's background reads as dark (WCAG-ish luminance). */
export function paletteIsDark(palette: ColorPalette): boolean {
  const raw = (palette.background ?? '#0B0F14').replace('#', '');
  const r = Number.parseInt(raw.slice(0, 2), 16) / 255;
  const g = Number.parseInt(raw.slice(2, 4), 16) / 255;
  const b = Number.parseInt(raw.slice(4, 6), 16) / 255;
  const luminance = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  return luminance <= 0.55;
}

export function buildShikiPaletteTheme(palette: ColorPalette): ThemeRegistrationRaw {
  return {
    name: SHIKI_PALETTE_THEME_NAME,
    type: paletteIsDark(palette) ? 'dark' : 'light',
    colors: {
      'editor.foreground': palette.syntaxText,
      'editor.background': palette.background,
    },
    // Shiki resolves conflicts by scope specificity (longest match wins),
    // so broad scopes like `meta` never shadow the specific rules below.
    settings: [
      {
        scope: ['comment', 'punctuation.definition.comment', 'string.comment'],
        settings: { foreground: palette.syntaxComment, fontStyle: 'italic' },
      },
      {
        scope: [
          'keyword',
          'storage',
          'storage.type',
          'storage.modifier',
          'support.type.builtin',
          'keyword.operator.new',
          'keyword.operator.expression',
        ],
        settings: { foreground: palette.syntaxKeyword },
      },
      {
        scope: ['constant.numeric', 'constant.language', 'constant.character', 'constant.other'],
        settings: { foreground: palette.syntaxNumber },
      },
      {
        scope: [
          'string',
          'string.quoted',
          'string.template',
          'string.regexp',
          'punctuation.definition.string',
        ],
        settings: { foreground: palette.syntaxString },
      },
      {
        scope: ['entity.name.function', 'support.function', 'meta.function-call'],
        settings: { foreground: palette.syntaxFunction },
      },
      {
        scope: [
          'entity.name.type',
          'entity.name.class',
          'entity.other.inherited-class',
          'entity.name.interface',
          'support.class',
          'support.type',
        ],
        settings: { foreground: palette.syntaxType },
      },
      {
        scope: [
          'keyword.operator',
          'punctuation',
          'punctuation.separator',
          'punctuation.terminator',
        ],
        settings: { foreground: palette.syntaxOperator },
      },
      {
        scope: ['entity.name.tag', 'punctuation.definition.tag', 'entity.other.attribute-name'],
        settings: { foreground: palette.syntaxTag },
      },
      {
        scope: [
          'meta.preprocessor',
          'meta.import',
          'meta.export',
          'keyword.control.import',
          'keyword.control.export',
          'meta',
        ],
        settings: { foreground: palette.syntaxMeta },
      },
      {
        scope: ['variable', 'variable.other', 'variable.parameter', 'identifier'],
        settings: { foreground: palette.syntaxText },
      },
    ],
  };
}
