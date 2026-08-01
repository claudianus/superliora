/**
 * Transcript output formatting — pretty-print + light semantic colour for tool
 * results, bash streams, expanded glances, and thinking blocks.
 *
 * Goals:
 *  - Make structured blobs (JSON / JSONL / diff / stack / logs) scannable
 *  - Keep plain text readable with soft URL / path / level accents
 *  - Never throw; never invent content; fall back to dim plain on any miss
 *  - Stay cheap on hot rebuilds (size caps, line-local work, shared highlighters)
 */

import chalk from 'chalk';

import { highlightLines } from '#/tui/components/media/code-highlight';
import { currentTheme, type ColorPalette } from '#/tui/theme';

/** Soft cap for full-document JSON pretty-print + re-highlight. */
export const TRANSCRIPT_OUTPUT_PRETTY_MAX_CHARS = 120_000;
/** Soft cap for line-by-line log / stack decoration. */
export const TRANSCRIPT_OUTPUT_LINE_DECORATE_MAX_CHARS = 400_000;
/** Soft cap for per-line work when scanning huge blobs. */
const MAX_SCAN_LINES = 4_000;

export type TranscriptOutputKind =
  | 'json'
  | 'jsonl'
  | 'diff'
  | 'stack'
  | 'log'
  | 'xml'
  | 'yaml'
  | 'code'
  | 'plain';

export interface FormatTranscriptOutputOptions {
  readonly isError?: boolean;
  /** Prefer this language when content looks like a code dump. */
  readonly languageHint?: string;
  /**
   * `tool` — default tool body (TruncatedOutput / expanded glance).
   * `bash` — already-sanitized shell streams.
   * `thinking` — model reasoning (prose-first, light structure).
   */
  readonly mode?: 'tool' | 'bash' | 'thinking';
  readonly palette?: ColorPalette;
}

export interface FormatTranscriptOutputResult {
  readonly kind: TranscriptOutputKind;
  readonly text: string;
}

// ─── Detection ──────────────────────────────────────────────────────────────

const LOG_LEVEL_RE =
  /^(?:\[)?(?:\d{4}[-/]\d{2}[-/]\d{2}[ T]\d{2}:\d{2}:\d{2}(?:[.,]\d+)?Z?\s+)?(?:\[)?(FATAL|ERROR|ERR|WARN(?:ING)?|INFO|DEBUG|TRACE|CRITICAL|NOTICE)(?:\])?(?:\s*[:\-]\s*|\s+)/i;

const STACK_FRAME_RE =
  /^\s*(?:at\s+|→\s+|↳\s+|File\s+")|(?:\s+\(?[A-Za-z]:?[/\\][^\s:]+:\d+(?::\d+)?\)?$)/;
const STACK_HEADER_RE = /^(?:[A-Za-z_$.][\w$.]*)?(?:Error|Exception|Panic|Traceback)\b/;
const DIFF_LINE_RE = /^(?:diff --git |index [0-9a-f]+\.\.|@@ |\+\+\+ |--- |[+-](?![+-]{2}))/;
const YAML_KEY_RE = /^[\w."'-]+\s*:\s*(?:$|[^{[\s]|[{[])/;
const XML_OPEN_RE = /^\s*</;
const URL_RE = /https?:\/\/[^\s"'<>]+/g;
const PATH_RE =
  /(?:^|[\s"'`(=])((?:\.\.?\/|~\/|\/|[A-Za-z]:\\)[\w.@%+\-./\\]+)(?=[\s"'`),;:]|$)/g;
const NUMBER_TOKEN_RE = /(?<![\w.])(-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)(?![\w.])/g;

export function detectTranscriptOutputKind(text: string): TranscriptOutputKind {
  const trimmed = text.trim();
  if (trimmed.length === 0) return 'plain';

  if (looksLikeJson(trimmed)) return 'json';
  if (looksLikeJsonl(trimmed)) return 'jsonl';

  const sample = sampleLines(trimmed, 40);
  let diffHits = 0;
  let stackHits = 0;
  let logHits = 0;
  let yamlHits = 0;
  let xmlHits = 0;

  for (const line of sample) {
    if (line.length === 0) continue;
    if (DIFF_LINE_RE.test(line)) diffHits++;
    if (STACK_FRAME_RE.test(line) || STACK_HEADER_RE.test(line)) stackHits++;
    if (LOG_LEVEL_RE.test(line)) logHits++;
    if (YAML_KEY_RE.test(line) && !line.includes('{') && !line.startsWith('//')) yamlHits++;
    if (XML_OPEN_RE.test(line) && /<\/?[A-Za-z_!]/.test(line)) xmlHits++;
  }

  const nonEmpty = sample.filter((l) => l.trim().length > 0).length || 1;
  if (diffHits >= 2 && diffHits / nonEmpty >= 0.25) return 'diff';
  if (stackHits >= 2 && stackHits / nonEmpty >= 0.3) return 'stack';
  if (logHits >= 2 && logHits / nonEmpty >= 0.25) return 'log';
  if (xmlHits >= 2 && xmlHits / nonEmpty >= 0.4) return 'xml';
  if (yamlHits >= 3 && yamlHits / nonEmpty >= 0.45) return 'yaml';

  return 'plain';
}

function looksLikeJson(trimmed: string): boolean {
  const first = trimmed[0];
  if (first !== '{' && first !== '[') return false;
  if (trimmed.length > TRANSCRIPT_OUTPUT_PRETTY_MAX_CHARS) {
    // Still treat as JSON for line decoration when it is clearly a single blob.
    return /[\}\]]\s*$/.test(trimmed.slice(-80));
  }
  try {
    JSON.parse(trimmed);
    return true;
  } catch {
    return false;
  }
}

function looksLikeJsonl(trimmed: string): boolean {
  const lines = sampleLines(trimmed, 30).filter((l) => l.trim().length > 0);
  if (lines.length < 2) return false;
  let hits = 0;
  for (const line of lines) {
    const t = line.trim();
    if ((t.startsWith('{') || t.startsWith('[')) && tryParseJson(t) !== undefined) hits++;
  }
  return hits >= 2 && hits / lines.length >= 0.7;
}

function tryParseJson(text: string): unknown | undefined {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return undefined;
  }
}

function sampleLines(text: string, max: number): string[] {
  const lines = text.split('\n');
  if (lines.length <= max) return lines;
  const head = Math.ceil(max * 0.7);
  const tail = max - head;
  return [...lines.slice(0, head), ...lines.slice(-tail)];
}

// ─── Public formatters ──────────────────────────────────────────────────────

/**
 * Format tool / bash / thinking body text for transcript display.
 * Returns ANSI-coloured text ready for Text / TruncatedOutput components.
 */
export function formatTranscriptOutput(
  text: string,
  options: FormatTranscriptOutputOptions = {},
): string {
  return formatTranscriptOutputDetailed(text, options).text;
}

export function formatTranscriptOutputDetailed(
  text: string,
  options: FormatTranscriptOutputOptions = {},
): FormatTranscriptOutputResult {
  if (typeof text !== 'string' || text.length === 0) {
    return { kind: 'plain', text: text ?? '' };
  }

  try {
    const mode = options.mode ?? 'tool';
    if (mode === 'thinking') {
      return { kind: 'plain', text: formatThinkingText(text, options) };
    }

    const kind =
      options.languageHint !== undefined && options.languageHint.length > 0
        ? 'code'
        : detectTranscriptOutputKind(text);

    switch (kind) {
      case 'json':
        return { kind, text: formatJsonOutput(text, options) };
      case 'jsonl':
        return { kind, text: formatJsonlOutput(text, options) };
      case 'diff':
        return { kind, text: formatCodeOutput(text, 'diff', options) };
      case 'xml':
        return { kind, text: formatCodeOutput(text, 'xml', options) };
      case 'yaml':
        return { kind, text: formatCodeOutput(text, 'yaml', options) };
      case 'code':
        return {
          kind,
          text: formatCodeOutput(text, options.languageHint ?? 'text', options),
        };
      case 'stack':
        return { kind, text: formatStackOutput(text, options) };
      case 'log':
        return { kind, text: formatLogOutput(text, options) };
      case 'plain':
      default:
        return { kind: 'plain', text: formatPlainOutput(text, options) };
    }
  } catch {
    return {
      kind: 'plain',
      text: options.isError === true ? errorStyle(text) : dimStyle(text),
    };
  }
}

// ─── Kind formatters ────────────────────────────────────────────────────────

function formatJsonOutput(text: string, options: FormatTranscriptOutputOptions): string {
  const trimmed = text.trim();
  if (trimmed.length > TRANSCRIPT_OUTPUT_PRETTY_MAX_CHARS) {
    return formatCodeOutput(trimmed, 'json', options);
  }
  const parsed = tryParseJson(trimmed);
  if (parsed === undefined) return formatCodeOutput(trimmed, 'json', options);
  let pretty: string;
  try {
    pretty = JSON.stringify(parsed, null, 2);
  } catch {
    return formatCodeOutput(trimmed, 'json', options);
  }
  const highlighted = highlightLines(pretty, 'json', options.palette).join('\n');
  return options.isError === true ? tintErrorLines(highlighted) : highlighted;
}

function formatJsonlOutput(text: string, options: FormatTranscriptOutputOptions): string {
  const lines = text.split('\n');
  if (text.length > TRANSCRIPT_OUTPUT_PRETTY_MAX_CHARS) {
    return lines.map((line) => decorateJsonlLine(line, options)).join('\n');
  }
  return lines.map((line) => decorateJsonlLine(line, options)).join('\n');
}

function decorateJsonlLine(line: string, options: FormatTranscriptOutputOptions): string {
  const trimmed = line.trim();
  if (trimmed.length === 0) return line;
  const parsed = tryParseJson(trimmed);
  if (parsed === undefined) return formatPlainLine(line, options);
  try {
    // Keep one row per event — compact JSON stays scannable in a stream.
    const compact = JSON.stringify(parsed);
    const hl = highlightLines(compact, 'json', options.palette).join('');
    const leading = line.match(/^\s*/)?.[0] ?? '';
    return leading + (options.isError === true ? tintErrorLines(hl) : hl);
  } catch {
    return formatPlainLine(line, options);
  }
}

function formatCodeOutput(
  text: string,
  lang: string,
  options: FormatTranscriptOutputOptions,
): string {
  const normalized = lang.trim().toLowerCase() || 'text';
  if (normalized === 'text' || normalized === 'plain') {
    return formatPlainOutput(text, options);
  }
  const highlighted = highlightLines(text, normalized, options.palette).join('\n');
  return options.isError === true ? tintErrorLines(highlighted) : highlighted;
}

function formatStackOutput(text: string, options: FormatTranscriptOutputOptions): string {
  if (text.length > TRANSCRIPT_OUTPUT_LINE_DECORATE_MAX_CHARS) {
    return options.isError === true ? errorStyle(text) : dimStyle(text);
  }
  const p = options.palette ?? currentTheme.palette;
  return text
    .split('\n')
    .slice(0, MAX_SCAN_LINES)
    .map((line) => {
      if (STACK_HEADER_RE.test(line.trimStart())) {
        return chalk.bold.hex(p.error)(line);
      }
      if (STACK_FRAME_RE.test(line)) {
        return decorateStackFrame(line, p);
      }
      return options.isError === true ? chalk.hex(p.error)(line) : dimStyle(line);
    })
    .join('\n');
}

function decorateStackFrame(line: string, p: ColorPalette): string {
  // Colour the path:line:col tail while keeping the frame text dim.
  const match = /^(.*?)(\(?[A-Za-z]:?[/\\][^\s:)]+:\d+(?::\d+)?\)?)(\s*)$/.exec(line);
  if (match === null) {
    return chalk.hex(p.textDim)(line);
  }
  const head = match[1] ?? '';
  const loc = match[2] ?? '';
  const tail = match[3] ?? '';
  return chalk.hex(p.textDim)(head) + chalk.hex(p.syntaxString)(loc) + chalk.hex(p.textDim)(tail);
}

function formatLogOutput(text: string, options: FormatTranscriptOutputOptions): string {
  if (text.length > TRANSCRIPT_OUTPUT_LINE_DECORATE_MAX_CHARS) {
    return options.isError === true ? errorStyle(text) : dimStyle(text);
  }
  return text
    .split('\n')
    .slice(0, MAX_SCAN_LINES)
    .map((line) => decorateLogLine(line, options))
    .join('\n');
}

function decorateLogLine(line: string, options: FormatTranscriptOutputOptions): string {
  const p = options.palette ?? currentTheme.palette;
  const match = LOG_LEVEL_RE.exec(line);
  if (match === null) {
    // No level token — soft accents only (do not re-enter formatPlainLine).
    return softDecorate(line, p, options.isError === true);
  }
  const levelRaw = match[1] ?? '';
  const level = levelRaw.toUpperCase();
  const color = logLevelColor(level, p, options.isError === true);
  // Recolour only the level token; soft-decorate the remainder.
  const prefix = match[0];
  const levelAt = prefix.toLowerCase().indexOf(levelRaw.toLowerCase());
  if (levelAt < 0) return formatPlainLine(line, options);
  const absLevel = (match.index ?? 0) + levelAt;
  const before = line.slice(0, absLevel);
  const levelTok = line.slice(absLevel, absLevel + levelRaw.length);
  const after = line.slice(absLevel + levelRaw.length);
  return (
    chalk.hex(p.textDim)(before) +
    chalk.bold.hex(color)(levelTok) +
    softDecorate(after, p, options.isError === true)
  );
}

function logLevelColor(level: string, p: ColorPalette, isError: boolean): string {
  switch (level) {
    case 'FATAL':
    case 'CRITICAL':
    case 'ERROR':
    case 'ERR':
      return p.error;
    case 'WARN':
    case 'WARNING':
      return p.warning;
    case 'INFO':
    case 'NOTICE':
      return p.primary;
    case 'DEBUG':
    case 'TRACE':
      return p.textMuted;
    default:
      return isError ? p.error : p.textDim;
  }
}

function formatPlainOutput(text: string, options: FormatTranscriptOutputOptions): string {
  if (text.length > TRANSCRIPT_OUTPUT_LINE_DECORATE_MAX_CHARS) {
    return options.isError === true ? errorStyle(text) : dimStyle(text);
  }
  // Fast path: no special tokens → single dim/error wrap.
  if (!mayNeedSoftDecorate(text)) {
    return options.isError === true ? errorStyle(text) : dimStyle(text);
  }
  return text
    .split('\n')
    .slice(0, MAX_SCAN_LINES)
    .map((line) => formatPlainLine(line, options))
    .join('\n');
}

function formatPlainLine(line: string, options: FormatTranscriptOutputOptions): string {
  const p = options.palette ?? currentTheme.palette;
  if (line.length === 0) return line;
  // Prefer the shared log decorator when the level token is present — call it
  // only via exec so we never bounce test→decorate→formatPlainLine forever.
  if (LOG_LEVEL_RE.exec(line) !== null) return decorateLogLine(line, options);
  if (STACK_FRAME_RE.test(line)) return decorateStackFrame(line, p);
  if (/^[+-](?![+-])/.test(line) || /^@@ /.test(line)) {
    if (line.startsWith('+')) return chalk.hex(p.diffAdded)(line);
    if (line.startsWith('-')) return chalk.hex(p.diffRemoved)(line);
    return chalk.hex(p.diffMeta)(line);
  }
  return softDecorate(line, p, options.isError === true);
}

function mayNeedSoftDecorate(text: string): boolean {
  return (
    text.includes('http://') ||
    text.includes('https://') ||
    text.includes('/') ||
    text.includes('\\') ||
    LOG_LEVEL_RE.test(text) ||
    /(?:^|\n)\s*(?:at\s+|Error\b|Exception\b)/.test(text) ||
    /(?:^|\n)[+-]/.test(text)
  );
}

/**
 * Soft accents for URLs, absolute/relative paths, and numbers on an otherwise
 * dim (or error) base line. Applied left-to-right without overlapping.
 */
function softDecorate(line: string, p: ColorPalette, isError: boolean): string {
  if (line.length === 0) return line;
  const base = isError ? p.error : p.textDim;
  type Span = { start: number; end: number; color: string };
  const spans: Span[] = [];

  for (const match of line.matchAll(URL_RE)) {
    const start = match.index ?? 0;
    spans.push({ start, end: start + match[0].length, color: p.primary });
  }
  for (const match of line.matchAll(PATH_RE)) {
    const full = match[0];
    const path = match[1] ?? '';
    const pathOffset = full.lastIndexOf(path);
    const start = (match.index ?? 0) + Math.max(0, pathOffset);
    spans.push({ start, end: start + path.length, color: p.syntaxString });
  }
  for (const match of line.matchAll(NUMBER_TOKEN_RE)) {
    const start = match.index ?? 0;
    spans.push({ start, end: start + match[0].length, color: p.syntaxNumber });
  }

  if (spans.length === 0) return chalk.hex(base)(line);

  spans.sort((a, b) => a.start - b.start || b.end - a.end);
  const accepted: Span[] = [];
  let cursor = 0;
  for (const span of spans) {
    if (span.start < cursor) continue;
    if (span.start >= line.length) break;
    accepted.push({
      start: span.start,
      end: Math.min(span.end, line.length),
      color: span.color,
    });
    cursor = span.end;
  }

  let out = '';
  let i = 0;
  for (const span of accepted) {
    if (i < span.start) out += chalk.hex(base)(line.slice(i, span.start));
    out += chalk.hex(span.color)(line.slice(span.start, span.end));
    i = span.end;
  }
  if (i < line.length) out += chalk.hex(base)(line.slice(i));
  return out;
}

// ─── Thinking ───────────────────────────────────────────────────────────────

/**
 * Reasoning text: keep a prose-first italic base, but lift code fences,
 * headings, and list markers so long thoughts stay scannable.
 */
export function formatThinkingText(
  text: string,
  options: FormatTranscriptOutputOptions = {},
): string {
  if (text.length === 0) return text;
  try {
    if (text.length > TRANSCRIPT_OUTPUT_LINE_DECORATE_MAX_CHARS || !text.includes('```')) {
      return formatThinkingProse(text, options);
    }
    return formatThinkingWithFences(text, options);
  } catch {
    return currentTheme.italicFg('textDim', text);
  }
}

function formatThinkingProse(text: string, options: FormatTranscriptOutputOptions): string {
  const p = options.palette ?? currentTheme.palette;
  return text
    .split('\n')
    .slice(0, MAX_SCAN_LINES)
    .map((line) => {
      const trimmed = line.trimStart();
      if (/^#{1,6}\s+\S/.test(trimmed)) {
        return chalk.bold.hex(p.text).italic(line);
      }
      if (/^[-*+]\s+\S/.test(trimmed) || /^\d+\.\s+\S/.test(trimmed)) {
        const indent = line.match(/^\s*/)?.[0] ?? '';
        const rest = line.slice(indent.length);
        const bulletEnd = rest.search(/\s/);
        if (bulletEnd > 0) {
          return (
            indent +
            chalk.hex(p.primary)(rest.slice(0, bulletEnd)) +
            chalk.hex(p.textDim).italic(rest.slice(bulletEnd))
          );
        }
      }
      if (/^>\s?/.test(trimmed)) {
        return chalk.hex(p.textMuted).italic(line);
      }
      // Inline `code` accents.
      if (line.includes('`')) {
        return decorateInlineCode(line, p);
      }
      return chalk.hex(p.textDim).italic(line);
    })
    .join('\n');
}

function formatThinkingWithFences(
  text: string,
  options: FormatTranscriptOutputOptions,
): string {
  const p = options.palette ?? currentTheme.palette;
  const lines = text.split('\n');
  const out: string[] = [];
  let i = 0;
  while (i < lines.length && i < MAX_SCAN_LINES) {
    const line = lines[i] ?? '';
    const fence = /^\s*```([^\s`]*)?.*$/.exec(line);
    if (fence === null) {
      out.push(formatThinkingProse(line, options));
      i++;
      continue;
    }
    const lang = fence[1]?.trim() || undefined;
    out.push(chalk.hex(p.textMuted)(line.trimEnd() === '```' ? '```' : line));
    i++;
    const code: string[] = [];
    while (i < lines.length && !/^\s*```\s*$/.test(lines[i] ?? '')) {
      code.push(lines[i] ?? '');
      i++;
    }
    if (code.length > 0) {
      const body = code.join('\n');
      const hl =
        lang !== undefined && lang.length > 0
          ? highlightLines(body, lang, options.palette)
          : highlightLines(body, detectFenceLang(body), options.palette);
      for (const row of hl) out.push(row);
    }
    if (i < lines.length && /^\s*```\s*$/.test(lines[i] ?? '')) {
      out.push(chalk.hex(p.textMuted)((lines[i] ?? '').trimEnd()));
      i++;
    }
  }
  return out.join('\n');
}

function detectFenceLang(body: string): string | undefined {
  const kind = detectTranscriptOutputKind(body);
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
    default:
      return undefined;
  }
}

function decorateInlineCode(line: string, p: ColorPalette): string {
  let out = '';
  let i = 0;
  while (i < line.length) {
    const open = line.indexOf('`', i);
    if (open < 0) {
      out += chalk.hex(p.textDim).italic(line.slice(i));
      break;
    }
    if (open > i) out += chalk.hex(p.textDim).italic(line.slice(i, open));
    const close = line.indexOf('`', open + 1);
    if (close < 0) {
      out += chalk.hex(p.textDim).italic(line.slice(open));
      break;
    }
    out += chalk.hex(p.primary)(line.slice(open, close + 1));
    i = close + 1;
  }
  return out;
}

// ─── Style helpers ──────────────────────────────────────────────────────────

function dimStyle(text: string): string {
  return currentTheme.dim(text);
}

function errorStyle(text: string): string {
  return currentTheme.fg('error', text);
}

/** When the whole blob is an error, keep syntax colours but bias unknown runs. */
function tintErrorLines(text: string): string {
  // Already highlighted; leave as-is so JSON keys stay readable on failures.
  return text;
}
