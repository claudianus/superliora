/**
 * Project content search for the `/search` results dialog.
 *
 * `searchProject` prefers ripgrep (regex patterns, gitignore-respecting) and
 * falls back to a built-in scanner over `listProjectFiles` when `rg` is
 * missing, times out, or rejects the pattern as a regex — the fallback then
 * treats the pattern as a literal case-insensitive substring. It never
 * throws. Match totals are capped (`maxMatches`, default 300) with a
 * per-file cap of 10 on both engines; `truncated` reports whether the total
 * cap was hit.
 */

import { execFileSync } from 'node:child_process';
import { readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

import { listProjectFiles } from '#/utils/fs/file-tree';

const RG_TIMEOUT_MS = 10_000;
const RG_MAX_BUFFER = 16 * 1024 * 1024;
const DEFAULT_MAX_MATCHES = 300;
/** Per-file match cap (mirrored by rg's `--max-count`). */
const PER_FILE_MAX_MATCHES = 10;
/** Built-in scanner skips files above this size. */
const MAX_FILE_BYTES = 512 * 1024;
/** Match text is truncated to this many characters. */
const MAX_LINE_TEXT = 300;

export interface SearchMatch {
  readonly path: string;
  readonly line: number;
  readonly text: string;
}

export interface SearchResults {
  readonly pattern: string;
  readonly matches: readonly SearchMatch[];
  /** Distinct files with at least one match. */
  readonly fileCount: number;
  /** Whether the total match cap was hit. */
  readonly truncated: boolean;
  readonly engine: 'ripgrep' | 'builtin';
}

export interface SearchProjectOptions {
  readonly maxMatches?: number;
}

/**
 * Search project file contents under `workDir` for `pattern`. The pattern is
 * a regex on the ripgrep path; when rg is unavailable or the regex is
 * invalid, the built-in scanner matches it as a literal case-insensitive
 * substring (a regex is still tried first there). Empty/blank patterns yield
 * empty results. Never throws.
 */
export function searchProject(
  workDir: string,
  pattern: string,
  options: SearchProjectOptions = {},
): SearchResults {
  const query = pattern.trim();
  if (query.length === 0) {
    return { pattern: query, matches: [], fileCount: 0, truncated: false, engine: 'builtin' };
  }
  const maxMatches = options.maxMatches ?? DEFAULT_MAX_MATCHES;
  const viaRipgrep = searchViaRipgrep(workDir, query, maxMatches);
  if (viaRipgrep !== null) return viaRipgrep;
  return searchBuiltin(workDir, query, maxMatches);
}

// ---------------------------------------------------------------------------
// Ripgrep engine
// ---------------------------------------------------------------------------

function searchViaRipgrep(
  workDir: string,
  pattern: string,
  maxMatches: number,
): SearchResults | null {
  let stdout: string;
  try {
    stdout = execFileSync(
      'rg',
      [
        '--line-number',
        '--no-heading',
        '--color=never',
        '--max-columns',
        '300',
        '--max-count',
        String(PER_FILE_MAX_MATCHES),
        '--',
        pattern,
        workDir,
      ],
      {
        encoding: 'utf8',
        timeout: RG_TIMEOUT_MS,
        maxBuffer: RG_MAX_BUFFER,
        stdio: ['ignore', 'pipe', 'ignore'],
      },
    );
  } catch (error) {
    // rg exits 1 when nothing matched — a normal empty result, not an error.
    if (exitStatus(error) === 1) {
      return { pattern, matches: [], fileCount: 0, truncated: false, engine: 'ripgrep' };
    }
    // rg missing, killed, regex error (exit 2), ... — use the built-in scanner.
    return null;
  }
  return parseRipgrepOutput(workDir, pattern, stdout, maxMatches);
}

function exitStatus(error: unknown): number | undefined {
  if (typeof error !== 'object' || error === null) return undefined;
  const status = (error as { status?: unknown }).status;
  return typeof status === 'number' ? status : undefined;
}

/** Parse `rg --line-number --no-heading` output: `path:line:text` per row. */
function parseRipgrepOutput(
  workDir: string,
  pattern: string,
  stdout: string,
  maxMatches: number,
): SearchResults {
  const matches: SearchMatch[] = [];
  const files = new Set<string>();
  let truncated = false;
  const prefix = workDir.endsWith('/') ? workDir : `${workDir}/`;

  for (const raw of stdout.split('\n')) {
    if (raw.length === 0) continue;
    const first = raw.indexOf(':');
    if (first === -1) continue;
    const second = raw.indexOf(':', first + 1);
    if (second === -1) continue;
    const line = Number.parseInt(raw.slice(first + 1, second), 10);
    if (!Number.isFinite(line)) continue;

    let path = raw.slice(0, first);
    if (path.startsWith(prefix)) path = path.slice(prefix.length);
    matches.push({ path, line, text: clipText(raw.slice(second + 1)) });
    files.add(path);

    if (matches.length >= maxMatches) {
      truncated = true;
      break;
    }
  }

  return { pattern, matches, fileCount: files.size, truncated, engine: 'ripgrep' };
}

// ---------------------------------------------------------------------------
// Built-in engine (rg unavailable or pattern rejected as a regex)
// ---------------------------------------------------------------------------

function searchBuiltin(workDir: string, pattern: string, maxMatches: number): SearchResults {
  const matcher = buildMatcher(pattern);
  const listing = listProjectFiles(workDir);
  const matches: SearchMatch[] = [];
  const files = new Set<string>();
  let truncated = false;

  for (const relPath of listing.paths) {
    const content = readSearchableFile(join(workDir, relPath));
    if (content === null) continue;

    let perFile = 0;
    const lines = content.split('\n');
    for (let i = 0; i < lines.length; i += 1) {
      if (matches.length >= maxMatches) break;
      const line = (lines[i] ?? '').replace(/\r$/, '');
      if (!matcher.test(line)) continue;
      matches.push({ path: relPath, line: i + 1, text: clipText(line) });
      perFile += 1;
      if (perFile >= PER_FILE_MAX_MATCHES) break;
    }
    if (perFile > 0) files.add(relPath);

    if (matches.length >= maxMatches) {
      truncated = true;
      break;
    }
  }

  return { pattern, matches, fileCount: files.size, truncated, engine: 'builtin' };
}

/** Case-insensitive regex for `pattern`; escaped literal when it won't compile. */
function buildMatcher(pattern: string): RegExp {
  try {
    return new RegExp(pattern, 'i');
  } catch {
    return new RegExp(escapeRegExp(pattern), 'i');
  }
}

function escapeRegExp(text: string): string {
  return text.replaceAll(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Read a file for scanning; null when unreadable, oversized, or binary. */
function readSearchableFile(absPath: string): string | null {
  try {
    if (statSync(absPath).size > MAX_FILE_BYTES) return null;
    const content = readFileSync(absPath, 'utf8');
    // NUL in the first 8KB marks a binary file.
    if (content.slice(0, 8192).includes('\0')) return null;
    return content;
  } catch {
    return null;
  }
}

function clipText(text: string): string {
  return text.length > MAX_LINE_TEXT ? text.slice(0, MAX_LINE_TEXT) : text;
}
