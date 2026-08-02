/**
 * Renderer theme adapters — MarkdownTheme and EditorTheme backed by the
 * global `currentTheme` singleton.
 *
 * All colour lookups route through `currentTheme.color(token)` so that
 * switching themes is instantaneous: old components hold old
 * MarkdownTheme/EditorTheme instances, but every method call on those
 * instances reads the *current* palette via the singleton.
 */

import type { MarkdownTheme } from '#/tui/renderer';
import chalk from 'chalk';

import { highlightLines } from '#/tui/components/media/code-highlight';
import { normalizeLangId } from '#/tui/components/media/lang-aliases';
import {
  detectTranscriptOutputKind,
  sniffCodeLanguage,
} from '#/tui/utils/transcript/transcript-output-format';
import { currentTheme } from './theme';

// The Markdown renderer emits literal "### " / "#### " / ... markers for h3-h6
// headings (h1/h2 are rendered without the `#` prefix). The prefix arrives
// here already wrapped in bold SGR codes, so we strip it — after any leading
// ANSI sequences — before re-styling. Without this, h3+ renders as raw
// "### Title" and reads like unparsed markdown.
// eslint-disable-next-line no-control-regex -- intentionally matches the ESC byte that opens ANSI SGR sequences.
const HEADING_HASH_PREFIX = /^((?:\u001B\[[0-9;]*m)*)#{1,6}[ \t]+/;

function resolveMarkdownCodeLang(code: string, lang?: string): string | undefined {
  const fromAlias = normalizeLangId(lang);
  if (fromAlias !== undefined) return fromAlias;
  // Fence without a language tag — sniff structure + source shape so bare
  // ``` dumps of TS/JSON/diff still light up in assistant replies.
  const kind = detectTranscriptOutputKind(code);
  switch (kind) {
    case 'json':
    case 'jsonl':
      return 'json';
    case 'diff':
      return 'diff';
    case 'xml':
      return 'xml';
    case 'yaml':
      return 'yaml';
    case 'csv':
      return 'csv';
    case 'properties':
      return 'properties';
    case 'code':
    case 'numbered-code':
      return sniffCodeLanguage(code);
    default:
      return sniffCodeLanguage(code);
  }
}

export function createMarkdownTheme(options?: { transient?: boolean }): MarkdownTheme {
  const transient = options?.transient === true;
  const stripHash = (text: string): string => text.replace(HEADING_HASH_PREFIX, '$1');

  return {
    heading: (text) => chalk.bold.hex(currentTheme.color('text'))(stripHash(text)),
    link: (text) => chalk.hex(currentTheme.color('primary'))(text),
    linkUrl: (text) => chalk.hex(currentTheme.color('textMuted'))(text),
    code: (text) => chalk.hex(currentTheme.color('primary'))(text),
    codeBlock: (text) => text,
    codeBlockBorder: (text) => chalk.hex(currentTheme.color('textMuted'))(text),
    quote: (text) => chalk.hex(currentTheme.color('textDim'))(text),
    quoteBorder: (text) => chalk.hex(currentTheme.color('textDim'))(text),
    hr: (text) => chalk.hex(currentTheme.color('border'))(text),
    // Match the assistant-message bullet so list markers read like a reply
    // prefix. Ordered lists arrive as "1. " / "2. " and are left
    // untouched by the leading-dash anchor.
    listBullet: (text) => chalk.hex(currentTheme.color('text'))(text.replace(/^-/, '•')),
    bold: (text) => chalk.hex(currentTheme.color('textStrong')).bold(text),
    italic: (text) => chalk.hex(currentTheme.color('text')).italic(text),
    strikethrough: (text) => chalk.hex(currentTheme.color('textMuted')).strikethrough(text),
    underline: (text) => chalk.hex(currentTheme.color('primary')).underline(text),
    highlightCode: (code: string, lang?: string) => {
      if (transient) return code.split('\n');
      // Shared Shiki → cli-highlight pipeline (same as Write/Edit previews).
      return highlightLines(code, resolveMarkdownCodeLang(code, lang));
    },
  };
}

