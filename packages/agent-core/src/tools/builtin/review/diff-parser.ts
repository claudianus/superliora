/**
 * Unified-diff parser. Parses `git diff -U3` output into structured hunks
 * with new-side and old-side line maps, for line-number resolution.
 * Absorbed from alibaba/open-code-review.
 */

export interface DiffHunkLine {
  readonly type: 'context' | 'add' | 'remove';
  readonly oldLineNo: number | null;
  readonly newLineNo: number | null;
  readonly text: string;
}

export interface DiffHunk {
  readonly oldStart: number;
  readonly oldCount: number;
  readonly newStart: number;
  readonly newCount: number;
  readonly lines: readonly DiffHunkLine[];
}

export interface DiffFile {
  readonly oldPath: string;
  readonly newPath: string;
  readonly hunks: readonly DiffHunk[];
}

const HUNK_HEADER = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/;

export function parseDiff(diff: string): readonly DiffFile[] {
  const files: DiffFile[] = [];
  const lines = diff.split('\n');
  let i = 0;
  while (i < lines.length) {
    const line = lines[i]!;
    if (line.startsWith('diff --git')) {
      const file = parseFileHeader(lines, i);
      if (file !== null) {
        i = file.nextIndex;
        const hunks = parseHunks(lines, i);
        i = hunks.nextIndex;
        files.push({ oldPath: file.oldPath, newPath: file.newPath, hunks: hunks.hunks });
      } else {
        i++;
      }
    } else {
      i++;
    }
  }
  return files;
}

function parseFileHeader(
  lines: readonly string[],
  start: number,
): { oldPath: string; newPath: string; nextIndex: number } | null {
  let i = start;
  let oldPath = '';
  let newPath = '';
  while (i < lines.length && !lines[i]!.startsWith('@@')) {
    const line = lines[i]!;
    if (line.startsWith('--- ')) oldPath = stripPrefix(line.slice(4));
    else if (line.startsWith('+++ ')) newPath = stripPrefix(line.slice(4));
    i++;
  }
  if (!oldPath && !newPath) return null;
  return { oldPath: oldPath || newPath, newPath: newPath || oldPath, nextIndex: i };
}

function parseHunks(
  lines: readonly string[],
  start: number,
): { hunks: DiffHunk[]; nextIndex: number } {
  const hunks: DiffHunk[] = [];
  let i = start;
  while (i < lines.length) {
    const header = HUNK_HEADER.exec(lines[i]!);
    if (header === null) {
      if (lines[i]!.startsWith('diff --git')) break;
      i++;
      continue;
    }
    const oldStart = Number(header[1]);
    const oldCount = header[2] !== undefined ? Number(header[2]) : 1;
    const newStart = Number(header[3]);
    const newCount = header[4] !== undefined ? Number(header[4]) : 1;
    i++;
    const hunkLines: DiffHunkLine[] = [];
    let oldNo = oldStart;
    let newNo = newStart;
    while (i < lines.length && !lines[i]!.startsWith('@@') && !lines[i]!.startsWith('diff ')) {
      const line = lines[i]!;
      if (line.startsWith('+')) {
        hunkLines.push({ type: 'add', oldLineNo: null, newLineNo: newNo++, text: line.slice(1) });
      } else if (line.startsWith('-')) {
        hunkLines.push({ type: 'remove', oldLineNo: oldNo++, newLineNo: null, text: line.slice(1) });
      } else if (line.startsWith('\\') && line.includes('No newline')) {
        i++;
        continue;
      } else {
        hunkLines.push({ type: 'context', oldLineNo: oldNo++, newLineNo: newNo++, text: line.startsWith(' ') ? line.slice(1) : line });
      }
      i++;
    }
    hunks.push({ oldStart, oldCount, newStart, newCount, lines: hunkLines });
  }
  return { hunks, nextIndex: i };
}

function stripPrefix(path: string): string {
  if (path === '/dev/null') return '';
  return path.startsWith('a/') ? path.slice(2) : path.startsWith('b/') ? path.slice(2) : path;
}

/**
 * Find the new-side line number for a snippet of code within a hunk. Uses
 * sliding-window matching on normalized lines. Returns null when not found.
 */
export function resolveLineBySnippet(
  hunk: DiffHunk,
  snippet: string,
): number | null {
  const target = normalizeSnippet(snippet);
  if (target.length === 0) return null;
  const newLines = hunk.lines.filter((l) => l.newLineNo !== null);
  for (const line of newLines) {
    if (normalizeLine(line.text) === target) return line.newLineNo;
  }
  // Fuzzy: contains match
  for (const line of newLines) {
    if (normalizeLine(line.text).includes(target) || target.includes(normalizeLine(line.text))) {
      return line.newLineNo;
    }
  }
  return null;
}

function normalizeSnippet(text: string): string {
  return text.trim().replaceAll(/\s+/g, ' ');
}
function normalizeLine(text: string): string {
  return text.trim().replaceAll(/\s+/g, ' ');
}
