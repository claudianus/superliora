/**
 * Working-tree change collection for the `/diff` review panel.
 *
 * `collectGitDiff` shells out to git (staged + unstaged vs HEAD, plus
 * untracked files as fully-added) and returns a structured report, or
 * `null` when `workDir` is not a git repo / git is missing. It never
 * throws. `parseUnifiedDiff` is the pure unified-diff parser so the
 * parsing rules are testable without a git binary.
 */

import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import type { DiffLine } from '#/tui/components/media/diff-preview';

const GIT_TIMEOUT_MS = 5_000;
const GIT_MAX_BUFFER = 8 * 1024 * 1024;

/** Per-file cap on rendered diff body lines. */
export const MAX_FILE_LINES = 400;
/** Total cap on rendered diff body lines across the whole report. */
export const MAX_TOTAL_LINES = 2_000;
/** Untracked files are enumerated as fully-added; cap how many we read. */
const MAX_UNTRACKED_FILES = 50;
/** Per-untracked-file read cap so one huge file cannot blow the budget. */
const MAX_UNTRACKED_FILE_LINES = 400;

export type GitDiffFileStatus = 'added' | 'modified' | 'deleted' | 'renamed' | 'binary';

export interface GitDiffFile {
  readonly path: string;
  readonly oldPath?: string;
  readonly status: GitDiffFileStatus;
  readonly added: number;
  readonly deleted: number;
  readonly lines: DiffLine[];
}

export interface GitDiffReport {
  readonly branch: string | null;
  readonly files: GitDiffFile[];
  readonly totalAdded: number;
  readonly totalDeleted: number;
  readonly truncated: boolean;
}

export interface ParseDiffOptions {
  readonly maxFileLines?: number;
  readonly maxTotalLines?: number;
}

const HUNK_HEADER_RE = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/;

/**
 * Parse a `git diff --unified=N` output into per-file {@link GitDiffFile}s.
 * Applies a per-file line cap and a total line cap to the rendered `lines`
 * (the `added`/`deleted` counts always reflect the true change totals).
 * Returns `[]` for empty or unparseable input.
 */
export function parseUnifiedDiff(text: string, options: ParseDiffOptions = {}): GitDiffFile[] {
  const maxFileLines = options.maxFileLines ?? MAX_FILE_LINES;
  const maxTotalLines = options.maxTotalLines ?? MAX_TOTAL_LINES;
  if (text.trim().length === 0) return [];

  const sections = splitFileSections(text);
  const files: GitDiffFile[] = [];
  let totalLines = 0;

  for (const section of sections) {
    const file = parseFileSection(section);
    if (file === null) continue;

    let lines = file.lines;
    if (lines.length > maxFileLines) {
      lines = lines.slice(0, maxFileLines);
    }
    const remaining = maxTotalLines - totalLines;
    if (remaining <= 0) {
      lines = [];
    } else if (lines.length > remaining) {
      lines = lines.slice(0, remaining);
    }
    totalLines += lines.length;

    files.push({ ...file, lines });
  }

  return files;
}

/**
 * Collect staged + unstaged changes (vs HEAD) plus untracked files for
 * `workDir`. Returns `null` when not a git repo or git is unavailable.
 */
export function collectGitDiff(workDir: string): GitDiffReport | null {
  if (!isGitRepo(workDir)) return null;

  const branch = readBranch(workDir);
  const diffText = runGit(workDir, [
    'diff',
    'HEAD',
    '--no-color',
    '--no-ext-diff',
    '--unified=3',
  ]);
  if (diffText === null) return null;

  const tracked = parseUnifiedDiff(diffText);
  const untracked = collectUntrackedFiles(workDir, tracked);
  const files = [...tracked, ...untracked];

  let totalAdded = 0;
  let totalDeleted = 0;
  let displayedLines = 0;
  for (const file of files) {
    totalAdded += file.added;
    totalDeleted += file.deleted;
    displayedLines += file.lines.length;
  }

  const truncated =
    displayedLines >= MAX_TOTAL_LINES || files.some((file) => file.lines.length >= MAX_FILE_LINES);

  return { branch, files, totalAdded, totalDeleted, truncated };
}

// ---------------------------------------------------------------------------
// Pure parsing helpers
// ---------------------------------------------------------------------------

function splitFileSections(text: string): string[][] {
  const sections: string[][] = [];
  let current: string[] | null = null;
  for (const line of text.split('\n')) {
    if (line.startsWith('diff --git ')) {
      current = [line];
      sections.push(current);
    } else if (current !== null) {
      current.push(line);
    }
  }
  return sections;
}

function parseFileSection(section: string[]): GitDiffFile | null {
  if (section.length === 0) return null;

  let status: GitDiffFileStatus = 'modified';
  let oldPath: string | undefined;
  let newPath: string | undefined;
  let renameFrom: string | undefined;
  let renameTo: string | undefined;

  for (const line of section) {
    if (line.startsWith('new file mode')) {
      status = 'added';
    } else if (line.startsWith('deleted file mode')) {
      status = 'deleted';
    } else if (line.startsWith('rename from ')) {
      status = 'renamed';
      renameFrom = line.slice('rename from '.length);
    } else if (line.startsWith('rename to ')) {
      status = 'renamed';
      renameTo = line.slice('rename to '.length);
    } else if (line.startsWith('Binary files ') && line.endsWith(' differ')) {
      status = 'binary';
    } else if (line.startsWith('--- ')) {
      oldPath = parseSidePath(line.slice(4), 'a');
    } else if (line.startsWith('+++ ')) {
      newPath = parseSidePath(line.slice(4), 'b');
    }
  }

  const paths = resolvePaths(section[0] ?? '', oldPath, newPath, renameFrom, renameTo);
  if (paths.path === null) return null;

  const { lines, added, deleted } = parseHunkLines(section);

  const file: GitDiffFile = {
    path: paths.path,
    status,
    added,
    deleted,
    lines,
  };
  if (paths.oldPath !== undefined && paths.oldPath !== paths.path) {
    return { ...file, oldPath: paths.oldPath };
  }
  return file;
}

function parseHunkLines(section: string[]): {
  lines: DiffLine[];
  added: number;
  deleted: number;
} {
  const lines: DiffLine[] = [];
  let added = 0;
  let deleted = 0;
  let oldLine = 0;
  let newLine = 0;
  let inHunk = false;

  for (const raw of section) {
    const hunk = HUNK_HEADER_RE.exec(raw);
    if (hunk !== null) {
      oldLine = Number.parseInt(hunk[1] ?? '1', 10) || 1;
      newLine = Number.parseInt(hunk[2] ?? '1', 10) || 1;
      inHunk = true;
      continue;
    }
    if (!inHunk) continue;
    if (raw.length === 0) continue; // trailing-newline artifact; empty context is " "
    if (raw.startsWith('\\')) continue; // "\ No newline at end of file"

    const marker = raw.charAt(0);
    const code = raw.slice(1);
    if (marker === '+') {
      lines.push({ kind: 'add', lineNum: newLine, code });
      newLine += 1;
      added += 1;
    } else if (marker === '-') {
      lines.push({ kind: 'delete', lineNum: oldLine, code });
      oldLine += 1;
      deleted += 1;
    } else {
      // Context line (' ' prefix) — or a blank line git emitted for an empty
      // context row. Numbered on the new side, matching computeDiffLines.
      lines.push({ kind: 'context', lineNum: newLine, code: marker === ' ' ? code : raw });
      oldLine += 1;
      newLine += 1;
    }
  }

  return { lines, added, deleted };
}

function parseSidePath(value: string, side: 'a' | 'b'): string | undefined {
  const trimmed = value.trim();
  if (trimmed === '/dev/null') return undefined;
  const prefix = `${side}/`;
  return trimmed.startsWith(prefix) ? trimmed.slice(prefix.length) : trimmed;
}

function resolvePaths(
  header: string,
  oldPath: string | undefined,
  newPath: string | undefined,
  renameFrom: string | undefined,
  renameTo: string | undefined,
): { path: string | null; oldPath?: string } {
  if (renameTo !== undefined) {
    return { path: renameTo, oldPath: renameFrom };
  }
  if (newPath !== undefined) {
    return { path: newPath, oldPath };
  }
  if (oldPath !== undefined) {
    return { path: oldPath, oldPath: undefined };
  }
  // Last resort: parse `diff --git a/<old> b/<new>`.
  const body = header.replace(/^diff --git /, '');
  const match = /^a\/(.+?) b\/(.+)$/.exec(body);
  if (match !== null) {
    return { path: match[2] ?? match[1] ?? null, oldPath: match[1] };
  }
  return { path: null };
}

// ---------------------------------------------------------------------------
// Git plumbing (never throws)
// ---------------------------------------------------------------------------

function isGitRepo(workDir: string): boolean {
  try {
    const out = runGit(workDir, ['rev-parse', '--is-inside-work-tree']);
    return out !== null && out.trim() === 'true';
  } catch {
    return false;
  }
}

function readBranch(workDir: string): string | null {
  const branch = runGit(workDir, ['branch', '--show-current']);
  if (branch !== null && branch.trim().length > 0) return branch.trim();
  // Detached HEAD: fall back to a short revision so the header stays useful.
  const rev = runGit(workDir, ['rev-parse', '--short', 'HEAD']);
  if (rev !== null && rev.trim().length > 0) return rev.trim();
  return null;
}

function collectUntrackedFiles(workDir: string, tracked: GitDiffFile[]): GitDiffFile[] {
  const listing = runGit(workDir, ['ls-files', '--others', '--exclude-standard']);
  if (listing === null) return [];

  const budget = MAX_TOTAL_LINES - tracked.reduce((n, file) => n + file.lines.length, 0);
  if (budget <= 0) return [];

  const files: GitDiffFile[] = [];
  let used = 0;
  let count = 0;
  for (const relPath of listing.split('\n')) {
    const path = relPath.trim();
    if (path.length === 0) continue;
    if (count >= MAX_UNTRACKED_FILES) break;
    count += 1;

    const lines = readUntrackedLines(join(workDir, path), MAX_UNTRACKED_FILE_LINES);
    if (lines === null) continue;

    const remaining = budget - used;
    const capped = lines.length > remaining ? lines.slice(0, remaining) : lines;
    used += capped.length;

    files.push({
      path,
      status: 'added',
      added: lines.length,
      deleted: 0,
      lines: capped,
    });
  }

  return files;
}

function readUntrackedLines(absPath: string, maxLines: number): DiffLine[] | null {
  try {
    const content = readFileSync(absPath, 'utf8');
    const rows = content.length === 0 ? [] : content.split('\n');
    const capped = rows.length > maxLines ? rows.slice(0, maxLines) : rows;
    return capped.map((code, index) => ({ kind: 'add' as const, lineNum: index + 1, code }));
  } catch {
    return null;
  }
}

function runGit(workDir: string, args: string[]): string | null {
  try {
    return execFileSync('git', ['-C', workDir, ...args], {
      encoding: 'utf8',
      timeout: GIT_TIMEOUT_MS,
      maxBuffer: GIT_MAX_BUFFER,
      stdio: ['ignore', 'pipe', 'ignore'],
    });
  } catch {
    return null;
  }
}
