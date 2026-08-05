/**
 * Transcript output formatting — pretty-print + semantic colour for tool
 * results, bash streams, expanded glances, and thinking blocks.
 *
 * Design:
 *  - Whole-blob kinds when confident (JSON, pure JSONL, pure diff, …)
 *  - Mixed streams (bash / tool dumps) split into contiguous segments so
 *    stack + log + JSON + code each get their own highlighter
 *  - Read-style `N\t…` line gutters strip before tokenization and reattach dim
 *  - Path / language hints promote code dumps (ts / py / …) over plain dim
 *  - Never throw; never invent content; size-capped; shared highlight LRU
 */
import chalk from 'chalk';

import { highlightLines, langFromPath } from '#/tui/components/media/code-highlight';
import { normalizeLangId } from '#/tui/components/media/lang-aliases';
import { shouldSkipExpensiveTranscriptFormat } from '#/tui/renderer';
import { currentTheme, type ColorPalette } from '#/tui/theme';

/** Soft cap for full-document JSON pretty-print + re-highlight. */
export const TRANSCRIPT_OUTPUT_PRETTY_MAX_CHARS = 120_000;
/** Soft cap for line-by-line log / stack decoration. */
export const TRANSCRIPT_OUTPUT_LINE_DECORATE_MAX_CHARS = 400_000;
/** Soft cap for per-line work when scanning huge blobs. */
const MAX_SCAN_LINES = 4_000;
/** Soft cap for mixed-segment formatting (beyond this, fall back to plain). */
const MIXED_SEGMENT_MAX_CHARS = 200_000;
/** Max contiguous segments before we collapse the remainder to plain. */
const MAX_SEGMENTS = 48;

export type TranscriptOutputKind =
  | 'json'
  | 'jsonl'
  | 'diff'
  | 'stack'
  | 'log'
  | 'xml'
  | 'yaml'
  | 'csv'
  | 'properties'
  | 'code'
  | 'numbered-code'
  | 'plain'
  | 'mixed';

export interface FormatTranscriptOutputOptions {
  readonly isError?: boolean;
  /** Prefer this language when content looks like a code dump. */
  readonly languageHint?: string;
  /** File path used to derive a language when languageHint is absent. */
  readonly pathHint?: string;
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

export interface TranscriptSegment {
  readonly kind: Exclude<TranscriptOutputKind, 'mixed'>;
  readonly startLine: number;
  readonly endLine: number;
  readonly language?: string;
}

// ─── Detection patterns ─────────────────────────────────────────────────────

const LOG_LEVEL_RE =
  /^(?:\[)?(?:\d{4}[-/]\d{2}[-/]\d{2}[ T]\d{2}:\d{2}:\d{2}(?:[.,]\d+)?Z?\s+)?(?:\[)?(FATAL|ERROR|ERR|WARN(?:ING)?|INFO|DEBUG|TRACE|CRITICAL|NOTICE)(?:\])?(?:\s*[:-]\s*|\s+)/i;

const STACK_FRAME_RE =
  /^\s*(?:at\s+|→\s+|↳\s+|File\s+")|(?:\s+\(?[A-Za-z]:?[/\\][^\s:]+:\d+(?::\d+)?\)?$)/;
const STACK_HEADER_RE = /^(?:[A-Za-z_$.][\w$.]*)?(?:Error|Exception|Panic|Traceback)\b/;
const DIFF_LINE_RE = /^(?:diff --git |index [0-9a-f]+\.\.|@@ |\+\+\+ |--- |[+-](?![+-]{2}))/;
const YAML_KEY_RE = /^[\w."'-]+\s*:\s*(?:$|[^{[\s]|[{[])/;
const XML_OPEN_RE = /^\s*</;
const URL_RE = /https?:\/\/[^\s"'<>]+/g;
/** Paths only: absolute, home, or explicit relative (./ ../) — not bare "src/foo". */
const PATH_RE =
  /(?:^|[\s"'`(=])((?:\.\.?\/|~\/|\/|[A-Za-z]:\\)[\w.@%+\-./\\]{2,})(?=[\s"'`),;:]|$)/g;
/** Numbers are NOT soft-decorated on plain lines (too aggressive for prose). */

/** Read tool / cat -n style: `12\t…` or padded `  12\t…` / `  12|…` / `  12:…`. */
const NUMBERED_LINE_RE = /^(\s*)(\d{1,7})([ \t|:]+)(.*)$/;

/**
 * High-confidence code sniffers. Each pattern is intentionally multi-token so
 * a single prose word like "const" or "export" never triggers full highlighting.
 * Prefer path/language hints over sniffing whenever available.
 */
const CODE_SNIFFERS: ReadonlyArray<{ readonly lang: string; readonly re: RegExp }> = [
  {
    lang: 'typescript',
    re: /(?:^|\n)\s*(?:export\s+(?:default\s+)?(?:async\s+)?function\s+\w+|export\s+(?:type|interface)\s+\w+|import\s+(?:type\s+)?[\w*{].*\sfrom\s+['"][^'"]+['"])/m,
  },
  {
    lang: 'javascript',
    re: /(?:^|\n)\s*(?:export\s+(?:default\s+)?(?:async\s+)?function\s+\w+|module\.exports\s*=|const\s+\w+\s*=\s*require\s*\()/m,
  },
  {
    lang: 'python',
    re: /(?:^|\n)(?:def\s+\w+\s*\([^)]*\)\s*:|class\s+\w+\s*(?:\(.*\))?:|from\s+\w[\w.]*\s+import\s+\w|if\s+__name__\s*==\s*['"]__main__['"])/m,
  },
  {
    lang: 'rust',
    re: /(?:^|\n)\s*(?:fn\s+\w+\s*(?:<[^>]*>)?\s*\(|pub\s+(?:fn|struct|enum|mod)\s+\w+|use\s+[\w:]+::[\w:]+)/m,
  },
  {
    lang: 'go',
    re: /(?:^|\n)\s*(?:func\s+(?:\([^)]*\)\s*)?\w+\s*\(|package\s+\w+\s*$|type\s+\w+\s+struct\s*\{)/m,
  },
  {
    lang: 'java',
    re: /(?:^|\n)\s*(?:public\s+class\s+\w+|package\s+[\w.]+;)/m,
  },
  {
    lang: 'sql',
    re: /^\s*(?:SELECT\s+.+?\s+FROM\s+|INSERT\s+INTO\s+|CREATE\s+TABLE\s+)/im,
  },
  {
    lang: 'toml',
    re: /(?:^|\n)\[[\w.-]+\]\s*\n\s*[\w.-]+\s*=/m,
  },
  {
    lang: 'dockerfile',
    re: /(?:^|\n)\s*(?:FROM\s+\S+|RUN\s+\S+)/m,
  },
  {
    lang: 'bash',
    re: /(?:^|\n)(?:#!\s*\/.*(?:ba)?sh\b|set\s+-[euxo]+\b)/m,
  },
  {
    lang: 'graphql',
    re: /(?:^|\n)\s*(?:type\s+\w+\s*\{|query\s+\w*\s*[({]|mutation\s+\w*\s*[({])/m,
  },
  {
    lang: 'terraform',
    re: /(?:^|\n)\s*(?:resource\s+"[\w_]+"\s+"[\w_-]+"|provider\s+"[\w_]+"|variable\s+"[\w_]+")/m,
  },
];

// Format result LRU so transcript rebuilds of the same blob are free.
const FORMAT_CACHE_LIMIT = 64;
const formatCache = new Map<string, FormatTranscriptOutputResult>();

function formatCacheKey(text: string, options: FormatTranscriptOutputOptions): string {
  return [
    options.mode ?? 'tool',
    options.isError === true ? '1' : '0',
    options.languageHint ?? '',
    options.pathHint ?? '',
    options.palette === undefined ? 't' : 'p',
    String(text.length),
    hashText(text),
  ].join('\0');
}

function hashText(text: string): string {
  let h = 0x811c9dc5;
  const step = text.length > 8_000 ? Math.ceil(text.length / 4_000) : 1;
  for (let i = 0; i < text.length; i += step) {
    h ^= text.codePointAt(i) ?? 0;
    h = Math.imul(h, 0x01000193);
  }
  // Mix ends so small edits near EOF still bust the key.
  if (text.length > 0) {
    h ^= text.codePointAt(text.length - 1) ?? 0;
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16);
}

/** Test helper — drop the format LRU. */
export function clearTranscriptFormatCache(): void {
  formatCache.clear();
}

// ─── Public detection ───────────────────────────────────────────────────────

/**
 * Best single-kind guess for a whole blob. Prefer
 * {@link segmentTranscriptOutput} when mixed content is possible.
 */
export function detectTranscriptOutputKind(text: string): TranscriptOutputKind {
  const trimmed = text.trim();
  if (trimmed.length === 0) return 'plain';

  if (looksLikeJson(trimmed)) return 'json';
  if (looksLikeJsonl(trimmed)) return 'jsonl';
  if (looksLikeCsv(trimmed)) return 'csv';
  if (looksLikeProperties(trimmed)) return 'properties';

  const sample = sampleLines(trimmed, 48);
  let diffHits = 0;
  let stackHits = 0;
  let logHits = 0;
  let yamlHits = 0;
  let xmlHits = 0;
  let numberedHits = 0;

  for (const line of sample) {
    if (line.length === 0) continue;
    if (DIFF_LINE_RE.test(line)) diffHits++;
    if (STACK_FRAME_RE.test(line) || STACK_HEADER_RE.test(line)) stackHits++;
    if (LOG_LEVEL_RE.test(line)) logHits++;
    if (YAML_KEY_RE.test(line) && !line.includes('{') && !line.startsWith('//')) yamlHits++;
    if (XML_OPEN_RE.test(line) && /<\/?[A-Za-z_!]/.test(line)) xmlHits++;
    if (NUMBERED_LINE_RE.test(line)) numberedHits++;
  }

  const nonEmpty = sample.filter((l) => l.trim().length > 0).length || 1;
  if (diffHits >= 2 && diffHits / nonEmpty >= 0.25) return 'diff';
  if (stackHits >= 2 && stackHits / nonEmpty >= 0.3) return 'stack';
  if (logHits >= 2 && logHits / nonEmpty >= 0.25) return 'log';
  if (xmlHits >= 2 && xmlHits / nonEmpty >= 0.4) return 'xml';
  if (yamlHits >= 3 && yamlHits / nonEmpty >= 0.45) return 'yaml';
  if (numberedHits >= 3 && numberedHits / nonEmpty >= 0.55) return 'numbered-code';

  if (sniffCodeLanguage(trimmed) !== undefined) return 'code';
  return 'plain';
}

/**
 * Split text into contiguous kind segments. Empty / pure single-kind blobs
 * yield one segment. Used for bash streams and other mixed tool dumps.
 */
export function segmentTranscriptOutput(
  text: string,
  options: FormatTranscriptOutputOptions = {},
): TranscriptSegment[] {
  if (text.length === 0) return [{ kind: 'plain', startLine: 0, endLine: 0 }];

  const lines = text.split('\n');
  if (lines.length > MAX_SCAN_LINES) {
    const kind = detectTranscriptOutputKind(text);
    return [
      {
        kind: kind === 'mixed' ? 'plain' : kind,
        startLine: 0,
        endLine: lines.length,
      },
    ];
  }

  // Whole-blob confidence first — avoid over-segmenting pure structured data.
  const whole = detectTranscriptOutputKind(text);
  if (
    whole === 'json' ||
    whole === 'jsonl' ||
    whole === 'diff' ||
    whole === 'xml' ||
    whole === 'yaml' ||
    whole === 'csv' ||
    whole === 'properties' ||
    whole === 'numbered-code' ||
    whole === 'code'
  ) {
    const lang =
      whole === 'numbered-code' || whole === 'code'
        ? resolveLanguage(text, options)
        : whole === 'json' || whole === 'jsonl'
          ? 'json'
          : whole === 'diff'
            ? 'diff'
            : whole === 'xml'
              ? 'xml'
              : whole === 'yaml'
                ? 'yaml'
                : whole === 'csv'
                  ? 'csv'
                  : whole === 'properties'
                    ? 'properties'
                    : undefined;
    return [
      {
        kind: whole,
        startLine: 0,
        endLine: lines.length,
        language: lang,
      },
    ];
  }

  const resolvedLang = resolveLanguage(text, options);
  const lineKinds: Array<Exclude<TranscriptOutputKind, 'mixed'>> = lines.map((line) =>
    classifyLine(line, resolvedLang),
  );

  // Smooth single-line noise: a plain line between two same-kind neighbours
  // inherits the neighbours so we do not shatter coherent blocks.
  for (let i = 1; i < lineKinds.length - 1; i++) {
    const prev = lineKinds[i - 1]!;
    const next = lineKinds[i + 1]!;
    const cur = lineKinds[i]!;
    if (cur === 'plain' && prev === next && prev !== 'plain') {
      lineKinds[i] = prev;
    }
  }

  const segments: TranscriptSegment[] = [];
  let start = 0;
  let current = lineKinds[0] ?? 'plain';
  for (let i = 1; i <= lineKinds.length; i++) {
    const kind = lineKinds[i];
    if (i === lineKinds.length || kind !== current) {
      const slice = lines.slice(start, i).join('\n');
      const language =
        current === 'code' || current === 'numbered-code'
          ? resolveLanguage(slice, options) ?? resolvedLang
          : current === 'json' || current === 'jsonl'
            ? 'json'
            : current === 'diff'
              ? 'diff'
              : current === 'xml'
                ? 'xml'
                : current === 'yaml'
                  ? 'yaml'
                  : undefined;
      segments.push({ kind: current, startLine: start, endLine: i, language });
      if (segments.length >= MAX_SEGMENTS) {
        if (i < lineKinds.length) {
          segments.push({ kind: 'plain', startLine: i, endLine: lineKinds.length });
        }
        break;
      }
      start = i;
      current = kind ?? 'plain';
    }
  }
  return segments.length > 0
    ? segments
    : [{ kind: 'plain', startLine: 0, endLine: lines.length }];
}

function classifyLine(
  line: string,
  languageHint: string | undefined,
): Exclude<TranscriptOutputKind, 'mixed'> {
  if (line.length === 0) return 'plain';
  const trimmed = line.trim();
  if (trimmed.length === 0) return 'plain';

  if (NUMBERED_LINE_RE.test(line)) {
    // Numbered lines usually belong to a code dump; keep them together.
    return 'numbered-code';
  }
  if (STACK_HEADER_RE.test(trimmed) || STACK_FRAME_RE.test(line)) return 'stack';
  if (LOG_LEVEL_RE.test(line)) return 'log';
  if (DIFF_LINE_RE.test(line) && (/^[+-]/.test(line) || line.startsWith('@@') || line.startsWith('diff '))) {
    return 'diff';
  }
  if (
    (trimmed.startsWith('{') || trimmed.startsWith('[')) &&
    tryParseJson(trimmed) !== undefined
  ) {
    return 'jsonl';
  }
  if (XML_OPEN_RE.test(line) && /<\/?[A-Za-z_!]/.test(line) && /(?:\/>|>)/.test(line)) {
    return 'xml';
  }
  // YAML only when the line looks like a real key:value (not prose "Note: foo").
  if (
    YAML_KEY_RE.test(line) &&
    !line.includes('{') &&
    !line.startsWith('//') &&
    /^[\w."'-]+\s*:\s+\S/.test(trimmed)
  ) {
    return 'yaml';
  }

  if (languageHint !== undefined) {
    // Inside a hinted code dump, keep structural code lines as code.
    // Do not reclassify plain prose just because a keyword appears.
    if (
      /[{};]\s*$|=>\s*\{|^\s*(?:function|const|let|var|class|import|export|def|fn|package|type|interface)\b/.test(
        trimmed,
      )
    ) {
      return 'code';
    }
    return 'plain';
  }
  // Never promote a single line to code via sniff — sniff needs multi-line blobs.
  return 'plain';
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
      // Thinking stays light; still serve cache hits under cheap paint.
      if (shouldSkipExpensiveTranscriptFormat()) {
        return { kind: 'plain', text: text };
      }
      return { kind: 'plain', text: formatThinkingText(text, options) };
    }

    const cacheKey = formatCacheKey(text, options);
    const cached = formatCache.get(cacheKey);
    if (cached !== undefined) {
      // LRU touch
      formatCache.delete(cacheKey);
      formatCache.set(cacheKey, cached);
      return cached;
    }

    // Geometry / pure-scroll: never pretty-print or highlight on cache miss.
    // Do not write plain stubs into the format LRU (permanent paint poison).
    if (shouldSkipExpensiveTranscriptFormat()) {
      return {
        kind: 'plain',
        text: options.isError === true ? errorStyle(text) : text,
      };
    }

    const result = formatBody(text, options);
    formatCache.set(cacheKey, result);
    while (formatCache.size > FORMAT_CACHE_LIMIT) {
      const oldest = formatCache.keys().next().value;
      if (oldest === undefined) break;
      formatCache.delete(oldest);
    }
    return result;
  } catch {
    return {
      kind: 'plain',
      text: options.isError === true ? errorStyle(text) : dimStyle(text),
    };
  }
}

function formatBody(
  text: string,
  options: FormatTranscriptOutputOptions,
): FormatTranscriptOutputResult {
  // Explicit language / path hint → treat as code (handles Read/Edit/Write).
  const hintedLang = resolveLanguage(text, options);
  if (
    (options.languageHint !== undefined && options.languageHint.length > 0) ||
    (options.pathHint !== undefined && options.pathHint.length > 0 && hintedLang !== undefined)
  ) {
    if (looksNumbered(text)) {
      return {
        kind: 'numbered-code',
        text: formatNumberedCodeOutput(text, hintedLang ?? 'text', options),
      };
    }
    return {
      kind: 'code',
      text: formatCodeOutput(text, hintedLang ?? options.languageHint ?? 'text', options),
    };
  }

  const whole = detectTranscriptOutputKind(text);
  if (whole === 'json') return { kind: whole, text: formatJsonOutput(text, options) };
  if (whole === 'jsonl') return { kind: whole, text: formatJsonlOutput(text, options) };
  if (whole === 'diff') return { kind: whole, text: formatCodeOutput(text, 'diff', options) };
  if (whole === 'xml') return { kind: whole, text: formatCodeOutput(text, 'xml', options) };
  if (whole === 'yaml') return { kind: whole, text: formatCodeOutput(text, 'yaml', options) };
  if (whole === 'csv') return { kind: whole, text: formatCsvOutput(text, options) };
  if (whole === 'properties') return { kind: whole, text: formatPropertiesOutput(text, options) };
  if (whole === 'stack') return { kind: whole, text: formatStackOutput(text, options) };
  if (whole === 'log') return { kind: whole, text: formatLogOutput(text, options) };
  if (whole === 'numbered-code') {
    const lang = resolveLanguage(text, options) ?? sniffCodeLanguage(stripNumberedPrefixes(text));
    return {
      kind: 'numbered-code',
      text: formatNumberedCodeOutput(text, lang ?? 'text', options),
    };
  }
  if (whole === 'code') {
    const lang = resolveLanguage(text, options) ?? sniffCodeLanguage(text) ?? 'text';
    return { kind: 'code', text: formatCodeOutput(text, lang, options) };
  }

  // Mixed / plain — segment when the blob is large enough to benefit.
  if (text.length <= MIXED_SEGMENT_MAX_CHARS && text.includes('\n')) {
    const segments = segmentTranscriptOutput(text, options);
    const distinct = new Set(segments.map((s) => s.kind));
    if (segments.length > 1 && distinct.size > 1) {
      return {
        kind: 'mixed',
        text: formatMixedSegments(text, segments, options),
      };
    }
    if (segments.length === 1) {
      const only = segments[0]!;
      if (only.kind !== 'plain') {
        return {
          kind: only.kind,
          text: formatSegmentBody(text, only, options),
        };
      }
    }
  }

  return { kind: 'plain', text: formatPlainOutput(text, options) };
}

function formatMixedSegments(
  text: string,
  segments: readonly TranscriptSegment[],
  options: FormatTranscriptOutputOptions,
): string {
  const lines = text.split('\n');
  const out: string[] = [];
  for (const segment of segments) {
    const body = lines.slice(segment.startLine, segment.endLine).join('\n');
    if (body.length === 0 && segment.endLine > segment.startLine) {
      // Preserve blank lines between segments.
      const blanks = segment.endLine - segment.startLine;
      for (let i = 0; i < blanks; i++) out.push('');
      continue;
    }
    const formatted = formatSegmentBody(body, segment, options);
    out.push(formatted);
  }
  return out.join('\n');
}

function formatSegmentBody(
  body: string,
  segment: TranscriptSegment,
  options: FormatTranscriptOutputOptions,
): string {
  switch (segment.kind) {
    case 'json':
      return formatJsonOutput(body, options);
    case 'jsonl':
      return formatJsonlOutput(body, options);
    case 'diff':
      return formatCodeOutput(body, 'diff', options);
    case 'xml':
      return formatCodeOutput(body, 'xml', options);
    case 'yaml':
      return formatCodeOutput(body, 'yaml', options);
    case 'csv':
      return formatCsvOutput(body, options);
    case 'properties':
      return formatPropertiesOutput(body, options);
    case 'stack':
      return formatStackOutput(body, options);
    case 'log':
      return formatLogOutput(body, options);
    case 'numbered-code':
      return formatNumberedCodeOutput(body, segment.language ?? 'text', options);
    case 'code':
      return formatCodeOutput(body, segment.language ?? 'text', options);
    case 'plain':
    default:
      return formatPlainOutput(body, options);
  }
}

// ─── Language resolution ────────────────────────────────────────────────────

function resolveLanguage(
  text: string,
  options: FormatTranscriptOutputOptions,
): string | undefined {
  const hint = options.languageHint?.trim().toLowerCase();
  if (hint !== undefined && hint.length > 0 && hint !== 'text' && hint !== 'plain') {
    return normalizeLangId(hint);
  }
  if (options.pathHint !== undefined && options.pathHint.length > 0) {
    const fromPath = langFromPath(options.pathHint);
    if (fromPath !== undefined) return fromPath;
  }
  return sniffCodeLanguage(looksNumbered(text) ? stripNumberedPrefixes(text) : text);
}

/**
 * Heuristic language sniff from source shape. Cheap regex only — never runs a
 * full parser. Requires enough content that a false positive is unlikely
 * (multi-line or ≥40 chars with a high-confidence structural match).
 */
export function sniffCodeLanguage(text: string): string | undefined {
  const trimmed = text.trim();
  if (trimmed.length < 24) return undefined;
  const lineCount = trimmed.split('\n').length;
  // Single short line: refuse — prose often contains "import" / "const".
  if (lineCount < 2 && trimmed.length < 80) return undefined;
  const sample = text.length > 8_000 ? text.slice(0, 4_000) + text.slice(-2_000) : text;
  for (const { lang, re } of CODE_SNIFFERS) {
    if (re.test(sample)) return lang;
  }
  return undefined;
}

// ─── Numbered-line helpers ──────────────────────────────────────────────────

function looksNumbered(text: string): boolean {
  const sample = sampleLines(text, 24).filter((l) => l.trim().length > 0);
  if (sample.length < 2) return false;
  let hits = 0;
  for (const line of sample) {
    if (NUMBERED_LINE_RE.test(line)) hits++;
  }
  return hits / sample.length >= 0.55;
}

function stripNumberedPrefixes(text: string): string {
  return text
    .split('\n')
    .map((line) => {
      const m = NUMBERED_LINE_RE.exec(line);
      return m !== null ? (m[4] ?? '') : line;
    })
    .join('\n');
}

interface NumberedParts {
  readonly gutters: Array<string | undefined>;
  readonly bodies: string[];
}

function splitNumberedLines(text: string): NumberedParts {
  const lines = text.split('\n');
  const gutters: Array<string | undefined> = [];
  const bodies: string[] = [];
  for (const line of lines) {
    const m = NUMBERED_LINE_RE.exec(line);
    if (m === null) {
      gutters.push(undefined);
      bodies.push(line);
      continue;
    }
    const indent = m[1] ?? '';
    const num = m[2] ?? '';
    const sep = m[3] ?? '\t';
    gutters.push(indent + num + sep);
    bodies.push(m[4] ?? '');
  }
  return { gutters, bodies };
}

function formatNumberedCodeOutput(
  text: string,
  lang: string,
  options: FormatTranscriptOutputOptions,
): string {
  const { gutters, bodies } = splitNumberedLines(text);
  const bodyText = bodies.join('\n');
  const normalized = lang.trim().toLowerCase() || 'text';
  const highlighted =
    normalized === 'text' || normalized === 'plain'
      ? bodies
      : highlightLines(bodyText, normalized, {
          palette: options.palette,
          pathHint: options.pathHint,
        });

  const p = options.palette ?? currentTheme.palette;
  const out: string[] = [];
  for (let i = 0; i < bodies.length; i++) {
    const gutter = gutters[i];
    const code = highlighted[i] ?? bodies[i] ?? '';
    if (gutter === undefined) {
      out.push(
        options.isError === true
          ? softDecorate(code, p, true)
          : code.includes('\u001B')
            ? code
            : softDecorate(code, p, false),
      );
      continue;
    }
    out.push(chalk.hex(p.textMuted)(gutter) + code);
  }
  return out.join('\n');
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
  return text
    .split('\n')
    .map((line) => decorateJsonlLine(line, options))
    .join('\n');
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
  // Numbered dumps may still arrive through the code path when language is
  // known — keep gutters intact.
  if (looksNumbered(text)) {
    return formatNumberedCodeOutput(text, lang, options);
  }
  const normalized = lang.trim().toLowerCase() || 'text';
  if (normalized === 'text' || normalized === 'plain') {
    return formatPlainOutput(text, options);
  }
  // Lightweight document formatters for dumps Shiki under-serves.
  if (normalized === 'csv' || normalized === 'tsv') {
    return formatCsvOutput(text, options);
  }
  if (normalized === 'properties' || normalized === 'ini' || normalized === 'dotenv') {
    return formatPropertiesOutput(text, options);
  }
  const highlighted = highlightLines(text, normalized, {
    palette: options.palette,
    pathHint: options.pathHint,
  }).join('\n');
  return options.isError === true ? tintErrorLines(highlighted) : highlighted;
}

/** True when the blob is mostly delimiter-separated columns (CSV/TSV). */
function looksLikeCsv(text: string): boolean {
  const lines = sampleLines(text, 24).filter((l) => l.trim().length > 0);
  if (lines.length < 2) return false;
  let commaHits = 0;
  let tabHits = 0;
  let consistent = 0;
  let lastCount = -1;
  for (const line of lines) {
    const commas = (line.match(/,/g) ?? []).length;
    const tabs = (line.match(/\t/g) ?? []).length;
    if (commas >= 2) commaHits++;
    if (tabs >= 2) tabHits++;
    const fields = tabs > commas ? tabs + 1 : commas + 1;
    if (fields < 3) continue;
    if (lastCount === -1) lastCount = fields;
    if (fields === lastCount) consistent++;
  }
  const sepHits = Math.max(commaHits, tabHits);
  return sepHits >= Math.ceil(lines.length * 0.7) && consistent >= Math.ceil(lines.length * 0.6);
}

/** KEY=value / key: value env & properties files. */
function looksLikeProperties(text: string): boolean {
  const lines = sampleLines(text, 32).filter((l) => l.trim().length > 0 && !l.trim().startsWith('#'));
  if (lines.length < 3) return false;
  let hits = 0;
  for (const line of lines) {
    if (/^[\w.-]+\s*[=:]\s*\S/.test(line.trim())) hits++;
  }
  return hits / lines.length >= 0.7;
}

function formatCsvOutput(text: string, options: FormatTranscriptOutputOptions): string {
  const p = options.palette ?? currentTheme.palette;
  const lines = text.split('\n');
  const sample = lines.find((l) => l.trim().length > 0) ?? '';
  const delim = (sample.match(/\t/g)?.length ?? 0) > (sample.match(/,/g)?.length ?? 0) ? '\t' : ',';
  const colors = [p.syntaxString, p.syntaxNumber, p.syntaxType, p.syntaxKeyword, p.syntaxMeta];
  return lines
    .map((line, row) => {
      if (line.length === 0) return line;
      const cells = splitCsvLine(line, delim);
      if (cells.length < 2) {
        return options.isError === true ? errorStyle(line) : dimStyle(line);
      }
      return cells
        .map((cell, i) => {
          const color = row === 0 ? p.syntaxKeyword : colors[i % colors.length]!;
          const painted = chalk.hex(color)(cell);
          return options.isError === true ? chalk.hex(p.error)(cell) : painted;
        })
        .join(chalk.hex(p.textMuted)(delim));
    })
    .join('\n');
}

function splitCsvLine(line: string, delim: string): string[] {
  if (delim === '\t') return line.split('\t');
  // Minimal CSV split: respect double-quoted fields.
  const out: string[] = [];
  let cur = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]!;
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }
    if (ch === delim && !inQuotes) {
      out.push(cur);
      cur = '';
      continue;
    }
    cur += ch;
  }
  out.push(cur);
  return out;
}

function formatPropertiesOutput(text: string, options: FormatTranscriptOutputOptions): string {
  const p = options.palette ?? currentTheme.palette;
  return text
    .split('\n')
    .map((line) => {
      const trimmed = line.trim();
      if (trimmed.length === 0) return line;
      if (trimmed.startsWith('#') || trimmed.startsWith('!')) {
        return chalk.hex(p.syntaxComment)(line);
      }
      const m = /^(\s*)([\w.-]+)(\s*[=:]\s*)(.*)$/.exec(line);
      if (m === null) {
        return options.isError === true ? errorStyle(line) : dimStyle(line);
      }
      return (
        (m[1] ?? '') +
        chalk.hex(p.syntaxKeyword)(m[2] ?? '') +
        chalk.hex(p.syntaxOperator)(m[3] ?? '') +
        chalk.hex(p.syntaxString)(m[4] ?? '')
      );
    })
    .join('\n');
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
    return softDecorate(line, p, options.isError === true);
  }
  const levelRaw = match[1] ?? '';
  const level = levelRaw.toUpperCase();
  const color = logLevelColor(level, p, options.isError === true);
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
  if (LOG_LEVEL_RE.exec(line) !== null) return decorateLogLine(line, options);
  if (STACK_FRAME_RE.test(line)) return decorateStackFrame(line, p);
  if (/^[+-](?![+-])/.test(line) || line.startsWith('@@ ')) {
    if (line.startsWith('+')) return chalk.hex(p.diffAdded)(line);
    if (line.startsWith('-')) return chalk.hex(p.diffRemoved)(line);
    return chalk.hex(p.diffMeta)(line);
  }
  // Inline JSON object/array on an otherwise plain line.
  const trimmed = line.trim();
  if (
    (trimmed.startsWith('{') || trimmed.startsWith('[')) &&
    tryParseJson(trimmed) !== undefined
  ) {
    return decorateJsonlLine(line, options);
  }
  return softDecorate(line, p, options.isError === true);
}

function mayNeedSoftDecorate(text: string): boolean {
  return (
    text.includes('http://') ||
    text.includes('https://') ||
    text.includes('/') ||
    text.includes('\\') ||
    text.includes('{') ||
    text.includes('[') ||
    LOG_LEVEL_RE.test(text) ||
    /(?:^|\n)\s*(?:at\s+|Error\b|Exception\b)/.test(text) ||
    /(?:^|\n)[+-]/.test(text)
  );
}

/**
 * Soft accents for URLs and explicit paths on an otherwise dim (or error) base
 * line. Numbers are intentionally left alone — coloring every digit makes
 * tool dumps unreadable and is not useful for prose/logs.
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
    // Require a path separator so we do not highlight single tokens.
    if (!path.includes('/') && !path.includes('\\')) continue;
    const pathOffset = full.lastIndexOf(path);
    const start = (match.index ?? 0) + Math.max(0, pathOffset);
    spans.push({ start, end: start + path.length, color: p.syntaxString });
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
      const resolved =
        lang !== undefined && lang.length > 0
          ? normalizeLangId(lang)
          : detectFenceLang(body);
      const hl = highlightLines(body, resolved, options.palette);
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
  const sniffed = sniffCodeLanguage(body);
  if (sniffed !== undefined) return sniffed;
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

// ─── Detection helpers ──────────────────────────────────────────────────────

function looksLikeJson(trimmed: string): boolean {
  const first = trimmed[0];
  if (first !== '{' && first !== '[') return false;
  if (trimmed.length > TRANSCRIPT_OUTPUT_PRETTY_MAX_CHARS) {
    return /[}\]]\s*$/.test(trimmed.slice(-80));
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

function tryParseJson(text: string): unknown {
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
