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

import type { ColorPalette } from '#/tui/theme';

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
      themes: ['dark-plus', 'light-plus'],
      langs: [...SHIKI_LANGS],
      engine: createJavaScriptRegexEngine({ forgiving: true }),
    })
      .then((instance) => {
        highlighter = instance;
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

function paletteIsDark(palette?: ColorPalette): boolean {
  const raw = (palette?.background ?? '#0B0F14').replace('#', '');
  const r = Number.parseInt(raw.slice(0, 2), 16) / 255;
  const g = Number.parseInt(raw.slice(2, 4), 16) / 255;
  const b = Number.parseInt(raw.slice(4, 6), 16) / 255;
  const luminance = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  return luminance <= 0.55;
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
  try {
    const theme = paletteIsDark(palette) ? 'dark-plus' : 'light-plus';
    const { tokens } = instance.codeToTokens(code, {
      lang: langId as BundledLanguage,
      theme,
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
