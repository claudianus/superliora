/**
 * Shared syntax-highlighting helpers for code previews
 * (tool-call Write/Edit, approval-panel Write content, shell commands, etc.).
 *
 * Hot path uses cli-highlight with a small LRU so repeated transcript rebuilds
 * do not re-tokenize large blobs. Shell commands get a dedicated lightweight
 * highlighter so binary + flags + strings stay readable without full bash
 * grammar cost on one-liners.
 */

import { extname } from 'node:path';

import chalk from 'chalk';
import { highlight, supportsLanguage } from 'cli-highlight';

import { buildSyntaxHighlightTheme } from '#/tui/theme/syntax-highlight-theme';
import { currentTheme } from '#/tui/theme';
import type { ColorPalette } from '#/tui/theme';

import { shikiHighlightLines, shikiReady, warmShikiHighlighter } from './shiki-ansi';

const EXT_LANG_MAP: Record<string, string> = {
  ts: 'typescript',
  tsx: 'typescript',
  mts: 'typescript',
  cts: 'typescript',
  js: 'javascript',
  jsx: 'javascript',
  mjs: 'javascript',
  cjs: 'javascript',
  py: 'python',
  rb: 'ruby',
  rs: 'rust',
  go: 'go',
  java: 'java',
  kt: 'kotlin',
  kts: 'kotlin',
  sh: 'bash',
  bash: 'bash',
  zsh: 'bash',
  fish: 'bash',
  json: 'json',
  jsonc: 'json',
  yaml: 'yaml',
  yml: 'yaml',
  toml: 'toml',
  md: 'markdown',
  mdx: 'markdown',
  css: 'css',
  scss: 'css',
  less: 'css',
  html: 'html',
  htm: 'html',
  xml: 'xml',
  sql: 'sql',
  c: 'c',
  cc: 'cpp',
  cpp: 'cpp',
  cxx: 'cpp',
  h: 'c',
  hh: 'cpp',
  hpp: 'cpp',
  cs: 'csharp',
  php: 'php',
  swift: 'swift',
  scala: 'scala',
  r: 'r',
  lua: 'lua',
  pl: 'perl',
  pm: 'perl',
  vue: 'xml',
  svelte: 'xml',
  dockerfile: 'dockerfile',
  makefile: 'makefile',
  mk: 'makefile',
  zig: 'rust',
  nim: 'python',
  ex: 'elixir',
  exs: 'elixir',
  erl: 'erlang',
  hs: 'haskell',
  proto: 'protobuf',
  // graphql: not in cli-highlight — plain
  // hcl/tf: cli-highlight has no hcl grammar — plain
  nix: 'nix',
  vim: 'vim',
  diff: 'diff',
  patch: 'diff',
};

/** Soft cap for full-file highlight on collapsed previews (lines beyond use windowing). */
export const HIGHLIGHT_WINDOW_SOFT_CAP = 400;

const HIGHLIGHT_CACHE_LIMIT = 48;

interface HighlightCacheEntry {
  readonly lines: string[];
}

const highlightCache = new Map<string, HighlightCacheEntry>();

function paletteCacheKey(palette?: ColorPalette): string {
  if (palette === undefined) return 'theme';
  return [
    palette.syntaxKeyword,
    palette.syntaxString,
    palette.syntaxComment,
    palette.syntaxFunction,
    palette.syntaxNumber,
    palette.diffAdded,
    palette.diffRemoved,
  ].join('|');
}

function cacheGet(key: string): string[] | undefined {
  const hit = highlightCache.get(key);
  if (hit === undefined) return undefined;
  highlightCache.delete(key);
  highlightCache.set(key, hit);
  return hit.lines;
}

function cacheSet(key: string, lines: string[]): void {
  if (highlightCache.has(key)) highlightCache.delete(key);
  highlightCache.set(key, { lines });
  while (highlightCache.size > HIGHLIGHT_CACHE_LIMIT) {
    const oldest = highlightCache.keys().next().value;
    if (oldest === undefined) break;
    highlightCache.delete(oldest);
  }
}

/** Test / theme-swap helper — drops the highlight LRU. */
export function clearHighlightCache(): void {
  highlightCache.clear();
}

export function langFromPath(filePath: string): string | undefined {
  if (filePath.length === 0) return undefined;
  const base = filePath.split(/[/\\]/).pop() ?? filePath;
  const lowerBase = base.toLowerCase();
  if (lowerBase === 'dockerfile' || lowerBase.startsWith('dockerfile.')) {
    return supportsLanguage('dockerfile') ? 'dockerfile' : undefined;
  }
  if (lowerBase === 'makefile' || lowerBase === 'gnumakefile') {
    return supportsLanguage('makefile') ? 'makefile' : undefined;
  }
  const ext = extname(base).slice(1).toLowerCase();
  if (ext.length === 0) return undefined;
  const lang = EXT_LANG_MAP[ext] ?? ext;
  return supportsLanguage(lang) ? lang : undefined;
}

/**
 * Highlight full `code` as `lang`. Returns plain split lines when language is
 * unknown or highlighting fails.
 */
export function highlightLines(
  code: string,
  lang: string | undefined,
  palette?: ColorPalette,
): string[] {
  const normalizedLang = lang?.trim().toLowerCase();
  if (!normalizedLang) return code.split('\n');

  // Engine tag keeps cli-highlight and Shiki results from colliding in the
  // same cache generation when the async Shiki singleton comes online.
  const engine = shikiReady() ? 's' : 'c';
  const key = `${engine}\0${normalizedLang}\0${paletteCacheKey(palette)}\0${code.length}\0${hashText(code)}`;
  const cached = cacheGet(key);
  if (cached !== undefined) return cached;

  // Preferred path: Shiki's TextMate tokenization rendered to ANSI.
  const shikiLines = shikiHighlightLines(code, normalizedLang, palette);
  if (shikiLines !== undefined) {
    cacheSet(key, shikiLines);
    return shikiLines;
  }

  if (!supportsLanguage(normalizedLang)) return code.split('\n');

  try {
    const lines = highlight(code, {
      language: normalizedLang,
      ignoreIllegals: true,
      theme: buildSyntaxHighlightTheme(palette),
    }).split('\n');
    cacheSet(key, lines);
    return lines;
  } catch {
    return code.split('\n');
  }
}

/**
 * Highlight a large blob efficiently for collapsed previews.
 * When total lines exceed `maxHighlightLines`, only the visible window
 * (+ small pad) is tokenized; the rest stays plain for callers that still
 * need a full-length array for gutter math.
 */
export function highlightLinesWindow(
  code: string,
  lang: string | undefined,
  options: {
    readonly startLine?: number;
    readonly endLine?: number;
    readonly maxHighlightLines?: number;
    readonly palette?: ColorPalette;
  } = {},
): string[] {
  const allPlain = code.split('\n');
  const total = allPlain.length;
  if (total === 0) return allPlain;

  const maxHighlight = options.maxHighlightLines ?? HIGHLIGHT_WINDOW_SOFT_CAP;
  const start = Math.max(0, options.startLine ?? 0);
  const end = Math.min(total, options.endLine ?? total);

  if (total <= maxHighlight) {
    return highlightLines(code, lang, options.palette);
  }

  const pad = 2;
  const hlStart = Math.max(0, start - pad);
  const hlEnd = Math.min(total, end + pad);
  const slice = allPlain.slice(hlStart, hlEnd).join('\n');
  const highlightedSlice = highlightLines(slice, lang, options.palette);

  const out = allPlain.slice();
  for (let i = 0; i < highlightedSlice.length; i++) {
    const dest = hlStart + i;
    if (dest >= 0 && dest < total) {
      out[dest] = highlightedSlice[i]!;
    }
  }
  return out;
}

/** FNV-1a 32-bit — good enough for cache keys, not crypto. */
function hashText(text: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.codePointAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16);
}

// ─── Shell command highlighting ─────────────────────────────────────────────

const SHELL_META = new Set([
  '|',
  '||',
  '&&',
  ';',
  '&',
  '>',
  '>>',
  '<',
  '<<',
  '<<<',
  '2>',
  '2>>',
  '&>',
  '|&',
  '(',
  ')',
  '{',
  '}',
  '[',
  ']',
  '`',
]);

const SHELL_KEYWORDS = new Set([
  'if',
  'then',
  'else',
  'elif',
  'fi',
  'for',
  'while',
  'until',
  'do',
  'done',
  'case',
  'esac',
  'in',
  'function',
  'select',
  'time',
  'coproc',
  '!',
]);

interface ShellStyles {
  readonly command: (s: string) => string;
  readonly flag: (s: string) => string;
  readonly string: (s: string) => string;
  readonly comment: (s: string) => string;
  readonly meta: (s: string) => string;
  readonly variable: (s: string) => string;
  readonly number: (s: string) => string;
  readonly path: (s: string) => string;
}

function makeShellStyles(palette?: ColorPalette): ShellStyles {
  const p = palette ?? currentTheme.palette;
  return {
    command: (s) => chalk.bold.hex(p.syntaxFunction)(s),
    flag: (s) => chalk.hex(p.syntaxKeyword)(s),
    string: (s) => chalk.hex(p.syntaxString)(s),
    comment: (s) => chalk.hex(p.syntaxComment)(s),
    meta: (s) => chalk.hex(p.diffMeta)(s),
    variable: (s) => chalk.hex(p.syntaxType)(s),
    number: (s) => chalk.hex(p.syntaxNumber)(s),
    path: (s) => chalk.hex(p.syntaxString)(s),
  };
}

/**
 * Tokenize a single shell command line for display. Not a full shell parser —
 * good enough for TUI readability of agent Bash tool cards.
 */
export function highlightShellCommandLine(line: string, palette?: ColorPalette): string {
  if (line.length === 0) return line;
  const s = makeShellStyles(palette);

  if (/^\s*#/.test(line)) return s.comment(line);

  let out = '';
  let i = 0;
  let expectCommand = true;

  while (i < line.length) {
    const ch = line[i]!;

    if (ch === ' ' || ch === '\t') {
      out += ch;
      i++;
      continue;
    }

    if (ch === '#') {
      out += s.comment(line.slice(i));
      break;
    }

    if (ch === "'" || ch === '"') {
      const quote = ch;
      let j = i + 1;
      while (j < line.length) {
        if (line[j] === '\\' && quote === '"') {
          j += 2;
          continue;
        }
        if (line[j] === quote) {
          j++;
          break;
        }
        j++;
      }
      out += s.string(line.slice(i, j));
      i = j;
      expectCommand = false;
      continue;
    }

    const two = line.slice(i, i + 2);
    const three = line.slice(i, i + 3);
    if (SHELL_META.has(three)) {
      out += s.meta(three);
      i += 3;
      expectCommand = true;
      continue;
    }
    if (SHELL_META.has(two)) {
      out += s.meta(two);
      i += 2;
      expectCommand = true;
      continue;
    }
    if (SHELL_META.has(ch)) {
      out += s.meta(ch);
      i++;
      expectCommand =
        ch === ';' || ch === '|' || ch === '&' || ch === '(' || ch === '{' || ch === '`';
      continue;
    }

    if (ch === '$') {
      let j = i + 1;
      if (line[j] === '{') {
        j++;
        while (j < line.length && line[j] !== '}') j++;
        if (j < line.length) j++;
        out += s.variable(line.slice(i, j));
        i = j;
        expectCommand = false;
        continue;
      }
      if (line[j] === '(') {
        out += s.meta('$(');
        i += 2;
        expectCommand = true;
        continue;
      }
      while (j < line.length && /[A-Za-z0-9_@*#?$!-]/.test(line[j]!)) j++;
      out += s.variable(line.slice(i, j));
      i = j;
      expectCommand = false;
      continue;
    }

    let j = i;
    while (j < line.length) {
      const c = line[j]!;
      if (
        c === ' ' ||
        c === '\t' ||
        c === "'" ||
        c === '"' ||
        c === '#' ||
        c === '|' ||
        c === '&' ||
        c === ';' ||
        c === '<' ||
        c === '>' ||
        c === '(' ||
        c === ')' ||
        c === '{' ||
        c === '}' ||
        c === '`'
      ) {
        break;
      }
      j++;
    }
    const token = line.slice(i, j);
    i = j;
    if (token.length === 0) continue;

    if (SHELL_KEYWORDS.has(token)) {
      out += s.command(token);
      if (token === 'then' || token === 'do' || token === 'else' || token === 'elif' || token === '!') {
        expectCommand = true;
      } else if (
        token === 'if' ||
        token === 'for' ||
        token === 'while' ||
        token === 'until' ||
        token === 'case' ||
        token === 'in'
      ) {
        expectCommand = false;
      } else {
        expectCommand = false;
      }
      continue;
    }

    if (expectCommand) {
      out += s.command(token);
      expectCommand = false;
      continue;
    }

    if (token.startsWith('-')) {
      out += s.flag(token);
      continue;
    }

    if (/^\d+(\.\d+)?$/.test(token)) {
      out += s.number(token);
      continue;
    }

    const eq = token.indexOf('=');
    if (eq > 0) {
      out += s.variable(token.slice(0, eq)) + s.meta('=') + s.string(token.slice(eq + 1));
      continue;
    }

    if (
      token.startsWith('/') ||
      token.startsWith('./') ||
      token.startsWith('../') ||
      token.startsWith('~/') ||
      token.includes('/') ||
      token.includes('*') ||
      token.includes('?')
    ) {
      out += s.path(token);
      continue;
    }

    out += token;
  }

  return out;
}

/**
 * Highlight a multi-line shell command. Short one-liners use the lightweight
 * tokenizer (clearer flags/args). Longer scripts fall back to bash grammar.
 */
export function highlightShellCommand(command: string, palette?: ColorPalette): string[] {
  const lines = command.split('\n');
  if (lines.length > 8 || command.length > 400) {
    return highlightLines(command, 'bash', palette);
  }
  return lines.map((line) => highlightShellCommandLine(line, palette));
}

/**
 * Format a shell command for transcript display with `$ ` prompt on first line.
 */
export function formatShellCommandPreview(
  command: string,
  options: {
    readonly palette?: ColorPalette;
    readonly prompt?: string;
    readonly continuationPrompt?: string;
  } = {},
): string[] {
  const highlighted = highlightShellCommand(command, options.palette);
  const prompt = options.prompt ?? '$ ';
  const cont = options.continuationPrompt ?? '  ';
  return highlighted.map((line, i) => {
    const prefix = i === 0 ? prompt : cont;
    return currentTheme.dim(prefix) + line;
  });
}


// Kick the async Shiki warm-up on first import; until it resolves (and for
// grammars it rejects) highlightLines serves the synchronous cli-highlight
// fallback, so no render path ever waits on initialization.
void warmShikiHighlighter();
