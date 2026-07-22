/**
 * Comprehensive text linkification for the TUI transcript.
 *
 * Detects URLs, file paths, git references, and other actionable patterns
 * in text and wraps them in OSC 8 hyperlink sequences so terminals that
 * support it (kitty, iTerm2, WezTerm, Ghostty, VS Code terminal) make
 * them Cmd/Ctrl-clickable.
 *
 * ANSI-aware: does not break existing escape sequences. Patterns inside
 * ANSI escape codes are never matched.
 */

import { pathToFileURL } from 'node:url';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type LinkKind = 'url' | 'file' | 'git-commit' | 'git-branch' | 'line-ref';

export interface DetectedLink {
  readonly kind: LinkKind;
  readonly text: string;
  readonly target: string;
  readonly start: number;
  readonly end: number;
}

export interface LinkifyOptions {
  /** Enable URL detection. @default true */
  readonly urls?: boolean;
  /** Enable file path detection. @default true */
  readonly filePaths?: boolean;
  /** Enable git commit hash detection. @default true */
  readonly gitCommits?: boolean;
  /** Enable file:line references (e.g. `src/foo.ts:42`). @default true */
  readonly lineRefs?: boolean;
  /** Working directory for resolving relative paths. */
  readonly cwd?: string;
  /** Maximum number of links to detect per line (perf guard). @default 20 */
  readonly maxLinks?: number;
}

// ---------------------------------------------------------------------------
// Regex patterns
// ---------------------------------------------------------------------------

/** URLs: http(s)://, git@, ssh:// */
const URL_RE = /https?:\/\/[^\s\x1b<>"')\]]+|git@[^\s\x1b]+:[^\s\x1b]+/g;

/** Absolute file paths: /foo/bar.ts, ~/foo/bar.ts */
const ABS_PATH_RE = /(?:~\/|\/)[\w./-]+\.[\w]+(?::\d+)?/g;

/** Relative file paths with extension: src/foo/bar.ts, ./foo.ts, ../bar.ts */
const REL_PATH_RE = /(?:\.{1,2}\/)?[\w-]+(?:\/[\w.-]+)*\.[\w]+(?::\d+)?/g;

/** Git short commit hashes: 7-40 hex chars preceded by word boundary */
const GIT_HASH_RE = /\b[0-9a-f]{7,40}\b/g;

/** File:line references: path/to/file.ts:42 or path/to/file.ts:42:10 */
const LINE_REF_RE = /([\w./-]+\.[\w]+):(\d+)(?::(\d+))?/g;

// ---------------------------------------------------------------------------
// ANSI stripping for safe matching
// ---------------------------------------------------------------------------

const ANSI_RE = /\x1b\[[0-9;]*[A-Za-z]|\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)/g;

interface PlainSegment {
  readonly text: string;
  readonly offset: number;
}

/**
 * Split a string into plain-text segments, skipping ANSI escape sequences.
 * Each segment records its offset in the original string.
 */
function splitPlainSegments(input: string): PlainSegment[] {
  const segments: PlainSegment[] = [];
  let lastIndex = 0;

  ANSI_RE.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = ANSI_RE.exec(input)) !== null) {
    if (match.index > lastIndex) {
      segments.push({ text: input.slice(lastIndex, match.index), offset: lastIndex });
    }
    lastIndex = match.index + match[0].length;
  }
  if (lastIndex < input.length) {
    segments.push({ text: input.slice(lastIndex), offset: lastIndex });
  }
  return segments;
}

// ---------------------------------------------------------------------------
// Detection
// ---------------------------------------------------------------------------

/**
 * Detect all actionable links in a line of text.
 * Returns links sorted by start position, non-overlapping.
 */
export function detectLinks(line: string, options: LinkifyOptions = {}): DetectedLink[] {
  const {
    urls = true,
    filePaths = true,
    gitCommits = true,
    lineRefs = true,
    maxLinks = 20,
  } = options;

  const links: DetectedLink[] = [];
  const segments = splitPlainSegments(line);

  for (const segment of segments) {
    if (links.length >= maxLinks) break;

    if (urls) {
      collectMatches(segment, URL_RE, 'url', links, (text) => text);
    }

    if (lineRefs) {
      collectLineRefs(segment, links);
    } else if (filePaths) {
      collectMatches(segment, ABS_PATH_RE, 'file', links, (text) => {
        const cleanPath = text.replace(/:\d+$/, '');
        return pathToFileURL(cleanPath.startsWith('~') ? cleanPath : cleanPath).href;
      });
      collectMatches(segment, REL_PATH_RE, 'file', links, (text) => {
        const cleanPath = text.replace(/:\d+$/, '');
        return pathToFileURL(cleanPath).href;
      });
    }

    if (gitCommits) {
      collectMatches(segment, GIT_HASH_RE, 'git-commit', links, (text) => text);
    }
  }

  // Sort by start position and remove overlaps
  links.sort((a, b) => a.start - b.start);
  return removeOverlaps(links).slice(0, maxLinks);
}

function collectMatches(
  segment: PlainSegment,
  re: RegExp,
  kind: LinkKind,
  out: DetectedLink[],
  toTarget: (text: string) => string,
): void {
  re.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = re.exec(segment.text)) !== null) {
    const text = match[0];
    // Skip very short matches that are likely false positives
    if (text.length < 4) continue;
    out.push({
      kind,
      text,
      target: toTarget(text),
      start: segment.offset + match.index,
      end: segment.offset + match.index + text.length,
    });
  }
}

function collectLineRefs(segment: PlainSegment, out: DetectedLink[]): void {
  LINE_REF_RE.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = LINE_REF_RE.exec(segment.text)) !== null) {
    const fullPath = match[0]!;
    const filePath = match[1]!;
    const line = match[2]!;
    const col = match[3];

    // Skip if it looks like a URL port (e.g. localhost:3000)
    if (/^\d+$/.test(filePath)) continue;
    // Skip if no file extension
    if (!filePath.includes('.')) continue;

    const target = col
      ? `${filePath}:${line}:${col}`
      : `${filePath}:${line}`;

    out.push({
      kind: 'line-ref',
      text: fullPath,
      target,
      start: segment.offset + match.index,
      end: segment.offset + match.index + fullPath.length,
    });
  }
}

function removeOverlaps(links: DetectedLink[]): DetectedLink[] {
  const result: DetectedLink[] = [];
  let lastEnd = -1;
  for (const link of links) {
    if (link.start >= lastEnd) {
      result.push(link);
      lastEnd = link.end;
    }
  }
  return result;
}

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

const ESC = '\u001B';
const ST = `${ESC}\\`;

/**
 * Wrap a text span in an OSC 8 hyperlink.
 * @param text - Visible text
 * @param target - Link target (URL, file:// URI, or raw path)
 * @param id - Optional link ID for multi-cell links
 */
export function wrapHyperlink(text: string, target: string, id?: string): string {
  const params = id ? `id=${id}` : '';
  return `${ESC}]8;${params};${target}${ST}${text}${ESC}]8;;${ST}`;
}

/**
 * Linkify a line of text: detect links and wrap them in OSC 8 sequences.
 * Preserves existing ANSI styling. Non-link text passes through unchanged.
 *
 * @param line - Input text (may contain ANSI escapes)
 * @param options - Detection options
 * @param styleLink - Optional function to style the link text (e.g. underline)
 * @returns The line with detected links wrapped in OSC 8 hyperlinks
 */
export function linkifyLine(
  line: string,
  options: LinkifyOptions = {},
  styleLink?: (text: string, kind: LinkKind) => string,
): string {
  const links = detectLinks(line, options);
  if (links.length === 0) return line;

  // Build the output by splicing hyperlink sequences around detected links
  let result = '';
  let pos = 0;

  for (const link of links) {
    // Append text before this link
    if (link.start > pos) {
      result += line.slice(pos, link.start);
    }

    // Wrap the link text
    const linkText = line.slice(link.start, link.end);
    const styled = styleLink ? styleLink(linkText, link.kind) : linkText;
    const target = resolveTarget(link);
    result += wrapHyperlink(styled, target, `lnk-${String(link.start)}`);

    pos = link.end;
  }

  // Append remaining text
  if (pos < line.length) {
    result += line.slice(pos);
  }

  return result;
}

/**
 * Resolve the final target for a detected link.
 * - URLs pass through as-is
 * - File paths become file:// URIs
 * - Git commits become a placeholder (caller can map to a URL)
 * - Line refs become file:// URIs with fragment
 */
function resolveTarget(link: DetectedLink): string {
  switch (link.kind) {
    case 'url':
      return link.target;
    case 'file': {
      const cleanPath = link.text.replace(/:\d+$/, '');
      if (cleanPath.startsWith('/') || cleanPath.startsWith('~')) {
        return pathToFileURL(cleanPath.replace('~', process.env['HOME'] ?? '~')).href;
      }
      return pathToFileURL(cleanPath).href;
    }
    case 'line-ref': {
      const parts = link.text.split(':');
      const filePath = parts[0]!;
      const line = parts[1] ?? '1';
      const resolved = filePath.startsWith('/')
        ? filePath
        : `${process.cwd()}/${filePath}`;
      return `${pathToFileURL(resolved).href}#L${line}`;
    }
    case 'git-commit':
      // Return the hash as-is; the terminal or a custom handler can map it
      return `git://${link.target}`;
    default:
      return link.target;
  }
}

// ---------------------------------------------------------------------------
// Batch linkification
// ---------------------------------------------------------------------------

/**
 * Linkify multiple lines at once. Useful for transcript rendering.
 * Returns a new array with links applied.
 */
export function linkifyLines(
  lines: string[],
  options: LinkifyOptions = {},
  styleLink?: (text: string, kind: LinkKind) => string,
): string[] {
  return lines.map((line) => linkifyLine(line, options, styleLink));
}
