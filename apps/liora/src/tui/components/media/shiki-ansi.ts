/**
 * Shiki-backed syntax highlighting rendered to ANSI 24-bit strings.
 *
 * Uses curated coding themes (GitHub Dimmed, One Dark Pro, …) by default so
 * code colors stay mild and consistent regardless of the UI chrome skin.
 * The legacy `palette` mode still bridges ColorPalette → TextMate.
 *
 * Until the singleton is ready — and for grammars not yet loaded —
 * callers fall back to the synchronous cli-highlight path.
 */
import chalk from 'chalk';
import { createHighlighter, type BundledLanguage, type BundledTheme } from 'shiki';
import { createJavaScriptRegexEngine } from 'shiki/engine/javascript';

import { currentTheme, type ColorPalette } from '#/tui/theme';
import { buildShikiPaletteTheme, SHIKI_PALETTE_THEME_NAME } from '#/tui/theme/shiki-theme';
import {
  getActiveSyntaxThemeId,
  resolveSyntaxTheme,
  type SyntaxThemeId,
} from '#/tui/theme/syntax-theme';
import { normalizeLangId } from './lang-aliases';

/** Common languages seen in transcripts; loaded eagerly at warm-up. */
const SHIKI_WARM_LANGS = [
  'typescript',
  'tsx',
  'javascript',
  'jsx',
  'json',
  'jsonc',
  'python',
  'rust',
  'go',
  'bash',
  'shellscript',
  'yaml',
  'markdown',
  'css',
  'html',
  'toml',
  'sql',
  'diff',
  'xml',
  'java',
  'kotlin',
  'c',
  'cpp',
  'csharp',
  'ruby',
  'php',
  'swift',
  'dockerfile',
  'makefile',
  'graphql',
  'ini',
  'properties',
  'terraform',
  'hcl',
  'csv',
  'vue',
  'svelte',
  'scss',
  'protobuf',
  'powershell',
  'dart',
  'elixir',
  'haskell',
] as const;

/** Bundled coding themes preloaded so preference switches are free. */
const SHIKI_BUNDLED_THEMES = [
  'github-dark-dimmed',
  'github-light',
  'one-dark-pro',
  'catppuccin-mocha',
  'nord',
  'solarized-dark',
  'solarized-light',
  'dark-plus',
] as const;

type ShikiInstance = Awaited<ReturnType<typeof createHighlighter>>;

let highlighter: ShikiInstance | undefined;
let warmPromise: Promise<void> | undefined;
let forceFallback = false;
/** Signature of the palette bridge currently loaded into the highlighter. */
let activePaletteKey: string | undefined;
/** Last resolved Shiki theme name used for tokens. */
let activeShikiThemeName: string | undefined;
/** In-flight lazy language loads. */
const pendingLangLoads = new Map<string, Promise<void>>();

const PALETTE_KEY_TOKENS = [
  'syntaxText',
  'syntaxKeyword',
  'syntaxFunction',
  'syntaxType',
  'syntaxString',
  'syntaxNumber',
  'syntaxComment',
  'syntaxOperator',
  'syntaxTag',
  'syntaxMeta',
  'background',
] as const;

function paletteKey(palette: ColorPalette): string {
  return PALETTE_KEY_TOKENS.map((token) => palette[token]).join('\u0000');
}

/**
 * Re-bind Shiki's palette-bridge theme after a UI theme switch. Safe before
 * warm-up finishes. Bundled coding themes ignore this path.
 */
export function refreshShikiPalette(palette: ColorPalette): void {
  const key = paletteKey(palette);
  if (key === activePaletteKey) return;
  activePaletteKey = key;
  const instance = highlighter;
  if (instance === undefined) return;
  void instance.loadTheme(buildShikiPaletteTheme(palette)).catch(() => {
    // Keep previous palette colors.
  });
}

/**
 * Call after the operator changes `appearance.syntax_theme` so the next
 * highlight uses the new theme (and clears any theme-key cache upstream).
 */
export function refreshShikiSyntaxTheme(preference?: SyntaxThemeId): void {
  if (preference !== undefined) {
    // Preference is stored on the syntax-theme module by the caller.
  }
  activeShikiThemeName = undefined;
  const live = currentTheme.palette;
  if (resolveSyntaxTheme(getActiveSyntaxThemeId(), live).usesPaletteBridge) {
    refreshShikiPalette(live);
  }
}

/**
 * Test-only: force the cli-highlight fallback path so palette-driven
 * colors can be asserted deterministically regardless of warm-up timing.
 */
export function __forceShikiFallbackForTest(value: boolean): void {
  forceFallback = value;
}

/**
 * Start the one-time async warm-up. Safe to call repeatedly.
 */
export function warmShikiHighlighter(): Promise<void> {
  warmPromise ??= createHighlighter({
      themes: [...SHIKI_BUNDLED_THEMES],
      langs: [...SHIKI_WARM_LANGS],
      engine: createJavaScriptRegexEngine({ forgiving: true }),
    })
      .then((instance) => {
        highlighter = instance;
        const live = currentTheme.palette;
        activePaletteKey = paletteKey(live);
        void instance.loadTheme(buildShikiPaletteTheme(live)).catch(() => {
          // Palette bridge optional until preference is `palette`.
        });
      })
      .catch(() => {
        // Leave highlighter undefined; callers keep the cli-highlight path.
      });
  return warmPromise;
}

/** True once the async singleton is ready for synchronous use. */
export function shikiReady(): boolean {
  return highlighter !== undefined;
}

function resolveLangId(lang: string): string {
  return normalizeLangId(lang) ?? lang.trim().toLowerCase();
}

/**
 * Map our canonical ids onto Shiki grammar ids when they differ.
 * shellscript is the TextMate id; we accept bash.
 */
function shikiLangId(langId: string): string {
  switch (langId) {
    case 'bash':
    case 'shell':
    case 'zsh':
      return 'shellscript';
    case 'tsx':
      return 'tsx';
    case 'jsx':
      return 'jsx';
    default:
      return langId;
  }
}

/** Languages we already know are missing from the Shiki bundle. */
const knownMissingLangs = new Set<string>();

function ensureLanguageLoaded(instance: ShikiInstance, langId: string): boolean {
  const shikiId = shikiLangId(langId);
  if (knownMissingLangs.has(shikiId)) return false;
  if (instance.getLoadedLanguages().includes(shikiId)) return true;
  // Kick async load; this call returns miss so caller falls back until ready.
  if (!pendingLangLoads.has(shikiId)) {
    pendingLangLoads.set(
      shikiId,
      Promise.resolve()
        .then(() => instance.loadLanguage(shikiId as BundledLanguage))
        .then(() => {
          pendingLangLoads.delete(shikiId);
        })
        .catch(() => {
          knownMissingLangs.add(shikiId);
          pendingLangLoads.delete(shikiId);
        }),
    );
  }
  return false;
}

function activeThemeName(palette?: ColorPalette): string {
  const resolved = resolveSyntaxTheme(getActiveSyntaxThemeId(), palette ?? currentTheme.palette);
  if (resolved.usesPaletteBridge && palette !== undefined) {
    refreshShikiPalette(palette);
  }
  activeShikiThemeName = resolved.shikiThemeName;
  return resolved.shikiThemeName;
}

/**
 * Highlight `code` with Shiki, returning one ANSI string per line.
 * Returns undefined when the singleton is not ready, the language is not
 * loaded yet, or tokenization fails — callers should fall back.
 */
export function shikiHighlightLines(
  code: string,
  lang: string,
  palette?: ColorPalette,
): string[] | undefined {
  const instance = highlighter;
  if (instance === undefined || forceFallback) return undefined;
  const langId = resolveLangId(lang);
  if (!ensureLanguageLoaded(instance, langId)) return undefined;

  const themeName = activeThemeName(palette);
  // Palette bridge theme may not be registered yet if load is racing.
  if (
    themeName === SHIKI_PALETTE_THEME_NAME &&
    !instance.getLoadedThemes().includes(SHIKI_PALETTE_THEME_NAME)
  ) {
    return undefined;
  }

  try {
    const shikiLang = shikiLangId(langId);
    const { tokens } = instance.codeToTokens(code, {
      lang: shikiLang as BundledLanguage,
      theme: themeName as BundledTheme,
    });
    return tokens.map((line) =>
      line
        .map((token) =>
          token.color !== undefined ? chalk.hex(token.color)(token.content) : token.content,
        )
        .join(''),
    );
  } catch {
    return undefined;
  }
}
