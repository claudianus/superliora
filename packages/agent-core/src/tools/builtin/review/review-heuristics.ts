/**
 * Pure structural scan heuristics for LioraReview baseline findings.
 * Side-effect free so ToolManager registration stays thin and unit-testable.
 */

export type ReviewSeverity = 'info' | 'suggestion' | 'warning' | 'error';

export interface ReviewHeuristicComment {
  readonly path: string;
  readonly line: number;
  readonly severity: ReviewSeverity;
  readonly message: string;
}

export interface ReviewHeuristicLine {
  readonly type: 'context' | 'add' | 'remove';
  readonly newLineNo: number | null;
  readonly text: string;
}

export interface ReviewHeuristicHunk {
  readonly lines: readonly ReviewHeuristicLine[];
}

export interface ReviewHeuristicFile {
  readonly newPath: string;
  readonly hunks: readonly ReviewHeuristicHunk[];
}

/** Scan a single added line for baseline issues. */
export function scanAddedLine(
  path: string,
  lineNo: number,
  text: string,
): readonly ReviewHeuristicComment[] {
  const trimmed = text.trim();
  const comments: ReviewHeuristicComment[] = [];

  if (/\b(?:TODO|FIXME|HACK|XXX)\b/i.test(trimmed)) {
    comments.push({
      path,
      line: lineNo,
      severity: 'suggestion',
      message: 'Unresolved TODO/FIXME marker introduced in this change.',
    });
  }
  if (/catch\s*\([^)]*\)\s*\{\s*\}/.test(trimmed)) {
    comments.push({
      path,
      line: lineNo,
      severity: 'warning',
      message: 'Empty catch block swallows errors silently.',
    });
  }
  if (/\bconsole\.log\b/.test(trimmed)) {
    comments.push({
      path,
      line: lineNo,
      severity: 'suggestion',
      message: 'console.log left in code — consider removing or using a logger.',
    });
  }
  // debugger statements must never land in production paths
  if (/\bdebugger\b/.test(trimmed)) {
    comments.push({
      path,
      line: lineNo,
      severity: 'error',
      message: 'debugger statement introduced — remove before merge.',
    });
  }
  // Hard-coded secrets / tokens (MVP heuristic; not a full scanner)
  if (
    /(?:api[_-]?key|secret|password|token)\s*[:=]\s*['"][^'"]{8,}['"]/i.test(trimmed) ||
    /Bearer\s+[A-Za-z0-9\-._~+/]+=*/.test(trimmed)
  ) {
    comments.push({
      path,
      line: lineNo,
      severity: 'error',
      message: 'Possible hard-coded secret or bearer token in new code.',
    });
  }
  // any-typed escapes that weaken type safety
  if (/:\s*any\b|as\s+any\b/.test(trimmed)) {
    comments.push({
      path,
      line: lineNo,
      severity: 'suggestion',
      message: 'any type escape — prefer a concrete type or unknown + narrow.',
    });
  }
  // eslint / ts-ignore suppressions in new code
  if (/@ts-(?:ignore|expect-error|nocheck)\b|eslint-disable/.test(trimmed)) {
    comments.push({
      path,
      line: lineNo,
      severity: 'suggestion',
      message: 'Lint/type suppression introduced — document why or fix the root cause.',
    });
  }

  return comments;
}

/** Scan all added lines in a parsed diff file. */
export function scanDiffFile(file: ReviewHeuristicFile): readonly ReviewHeuristicComment[] {
  const comments: ReviewHeuristicComment[] = [];
  for (const hunk of file.hunks) {
    for (const line of hunk.lines) {
      if (line.type !== 'add' || line.newLineNo === null) continue;
      comments.push(...scanAddedLine(file.newPath, line.newLineNo, line.text));
    }
  }
  return comments;
}

/** Scan many files; preserves input order. */
export function scanDiffFiles(
  files: readonly ReviewHeuristicFile[],
): readonly ReviewHeuristicComment[] {
  const comments: ReviewHeuristicComment[] = [];
  for (const file of files) {
    comments.push(...scanDiffFile(file));
  }
  return comments;
}
