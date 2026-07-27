/**
 * Shiki-backed syntax highlighting rendered to ANSI 24-bit strings.
 *
 * Shiki's JavaScript regex engine (pure JS, no WASM) gives TextMate-grade
 * tokenization at ~1ms per snippet after a lazy ~25ms warm-up. Until the
 * singleton is ready — and for grammars the JS engine does not load —
 * callers fall back to the synchronous cli-highlight path, so rendering
 * never blocks on the async initialization.
 */
import chalk from 'chalk';
import { createHighlighter } from 'shiki';
import type { BundledLanguage } from 'shiki';
import { createJavaScriptRegexEngine } from 'shiki/engine/javascript';

import { currentTheme, type ColorPalette } from '#/tui/theme';
import { buildShikiPaletteTheme, SHIKI_PALETTE_THEME_NAME } from '#/tui/theme/shiki-theme';

/** Common languages seen in transcripts; loaded eagerly at warm-up. */
const SHIKI_LANGS = [
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
] as const;

const LANG_ALIASES: Record<string, string> = {
  ts: 'typescript',
  mjs: 'javascript',
  cjs: 'javascript',
  js: 'javascript',
  py: 'python',
  sh: 'shellscript',
  shell: 'shellscript',
  zsh: 'shellscript',
  bash: 'shellscript',
  yml: 'yaml',
  md: 'markdown',
};

type ShikiInstance = Awaited<ReturnType<typeof createHighlighter>>;

let highlighter: ShikiInstance | undefined;
let warmPromise: Promise<void> | undefined;
let forceFallback = false;
/** Signature of the palette currently loaded into the highlighter. */
let activePaletteKey: string | undefined;

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
 * Re-bind Shiki's colors to a new palette after a theme switch. Safe to call
 * before warm-up finishes — completion compares keys and catches up, and
 * {@link shikiHighlightLines} also calls this lazily on every miss.
 */
export function refreshShikiPalette(palette: ColorPalette): void {
  const key = paletteKey(palette);
  if (key === activePaletteKey) return;
  activePaletteKey = key;
  const instance = highlighter;
  if (instance === undefined) return;
  void instance.loadTheme(buildShikiPaletteTheme(palette)).catch(() => {
    // Theme load failed; keep the previous palette colors.
  });
}

/**
 * Test-only: force the cli-highlight fallback path so palette-driven
 * colors can be asserted deterministically regardless of warm-up timing.
 */
export function __forceShikiFallbackForTest(value: boolean): void {
  forceFallback = value;
}

/**
 * Start the one-time async warm-up. Safe to call repeatedly; resolves once
 * the singleton is ready (or never sets it when initialization fails, in
 * which case the cli-highlight fallback stays in charge).
 */
export function warmShikiHighlighter(): Promise<void> {
  if (warmPromise === undefined) {
    warmPromise = createHighlighter({
      // A bundled placeholder keeps creation free of app-module state:
      // reading currentTheme at import time is unsafe in the production
      // bundle (module cycles can leave the palette uninitialized). The
      // palette theme is loaded on completion instead.
      themes: ['dark-plus'],
      langs: [...SHIKI_LANGS],
      engine: createJavaScriptRegexEngine({ forgiving: true }),
    })
      .then((instance) => {
        highlighter = instance;
        const live = currentTheme.palette;
        activePaletteKey = paletteKey(live);
        void instance.loadTheme(buildShikiPaletteTheme(live)).catch(() => {
          // Keep the placeholder theme; cli-highlight fallback still matches
          // the palette, so colors are never wrong for long.
        });
      })
      .catch(() => {
        // Leave highlighter undefined; callers keep the cli-highlight path.
      });
  }
  return warmPromise;
}

/** True once the async singleton is ready for synchronous use. */
export function shikiReady(): boolean {
  return highlighter !== undefined;
}

function resolveLangId(lang: string): string {
  const normalized = lang.trim().toLowerCase();
  return LANG_ALIASES[normalized] ?? normalized;
}

/**
 * Highlight `code` with Shiki, returning one ANSI string per line.
 * Returns undefined when the singleton is not ready, the language is not
 * loaded, or tokenization fails — callers should fall back.
 */
export function shikiHighlightLines(
  code: string,
  lang: string,
  palette?: ColorPalette,
): string[] | undefined {
  const instance = highlighter;
  if (instance === undefined || forceFallback) return undefined;
  const langId = resolveLangId(lang);
  if (!instance.getLoadedLanguages().includes(langId)) return undefined;
  // Lazy re-bind so a theme switch is reflected even without an explicit
  // refreshShikiPalette hook on the switching code path.
  if (palette !== undefined) refreshShikiPalette(palette);
  try {
    const { tokens } = instance.codeToTokens(code, {
      lang: langId as BundledLanguage,
      theme: SHIKI_PALETTE_THEME_NAME,
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
