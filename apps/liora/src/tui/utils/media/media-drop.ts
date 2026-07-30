/**
 * Interpret pasted terminal text as a terminal file drop.
 *
 * Terminals cannot transfer binary drops into a TUI directly. Instead, the
 * major terminals (iTerm2, Ghostty, WezTerm, Terminal.app, and Kitty in its
 * default mode) implement drag-and-drop by inserting the dropped file paths
 * into the input stream as text — usually wrapped in a bracketed paste. The
 * editor's paste hook runs pasted text through `parseDroppedFilePaths` and,
 * when the whole paste is a list of existing files, attaches images/videos
 * instead of inserting raw path text.
 *
 * The parser is deliberately conservative: it only returns paths when EVERY
 * token resolves to an existing file. Anything ambiguous (prose that mentions
 * a path, relative paths, non-existent files) falls through to a normal text
 * paste so regular clipboard text is never mangled.
 */

import { statSync } from 'node:fs';
import { isAbsolute } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Parse pasted text as a dropped file list.
 *
 * Returns absolute file paths when the text is purely a list of existing
 * files, otherwise `null`. Handles the common terminal drop encodings:
 *   - one path per line (multi-file drops)
 *   - `file://` URLs with percent-encoding
 *   - shell-quoted paths (`"..."` / `'...'`)
 *   - backslash-escaped spaces (`/path/My\ Image.png`)
 *   - space-separated `file://` URLs on a single line
 */
export function parseDroppedFilePaths(text: string): readonly string[] | null {
  const trimmed = text.trim();
  if (trimmed.length === 0) return null;

  const tokens = trimmed
    .split(/\r?\n/)
    .map((line) => normalizeDroppedToken(line))
    .filter((line) => line.length > 0);
  if (tokens.length === 0) return null;

  if (tokens.length > 1) {
    // Multi-line drops: terminals insert one path per line. Every line must
    // resolve to an existing file, otherwise this is ordinary pasted text.
    const paths: string[] = [];
    for (const token of tokens) {
      const path = resolveDroppedPath(token);
      if (path === null || !isExistingFile(path)) return null;
      paths.push(path);
    }
    return paths;
  }

  const single = tokens[0];
  if (single === undefined) return null;

  // A single path, possibly containing literal spaces.
  const direct = resolveDroppedPath(single);
  if (direct !== null && isExistingFile(direct)) return [direct];

  // Space-separated file:// URLs (URLs cannot contain raw spaces, so
  // splitting on whitespace is safe here).
  if (single.startsWith('file://') && single.includes(' ')) {
    const paths: string[] = [];
    for (const part of single.split(/\s+/)) {
      const path = resolveDroppedPath(part);
      if (path === null || !isExistingFile(path)) return null;
      paths.push(path);
    }
    if (paths.length > 0) return paths;
  }

  return null;
}

function normalizeDroppedToken(raw: string): string {
  let token = raw.trim();
  // Terminals quote paths that contain spaces when inserting them.
  if (token.length >= 2) {
    const first = token[0];
    const last = token[token.length - 1];
    if ((first === '"' && last === '"') || (first === "'" && last === "'")) {
      token = token.slice(1, -1);
    }
  }
  // iTerm2-style shell escaping: `/Users/me/My\ Image.png`.
  token = token.replaceAll('\\ ', ' ');
  return token.trim();
}

function resolveDroppedPath(token: string): string | null {
  if (token.startsWith('file://')) {
    try {
      return fileURLToPath(token);
    } catch {
      return null;
    }
  }
  // Relative paths are too ambiguous to treat as drops (a pasted sentence
  // fragment like `src/index.ts` must stay text).
  return isAbsolute(token) ? token : null;
}

function isExistingFile(path: string): boolean {
  try {
    return statSync(path).isFile();
  } catch {
    return false;
  }
}
