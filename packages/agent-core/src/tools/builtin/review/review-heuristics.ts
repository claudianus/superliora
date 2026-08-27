/**
 * Mechanical diff inventory for Review / LioraReview.
 *
 * Quality, style, and exception calls belong to the Conductor/worker LLM.
 * This module must not emit regex or hardcoded policy findings (TODO,
 * console.log, debugger, secrets, `any`, lint suppressions, empty catch).
 * Compile / type / lint / protocol gates stay on their own tools.
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

export interface ReviewFileInventory {
  readonly path: string;
  readonly added: number;
  readonly removed: number;
}

/**
 * Intentionally empty: line-level quality policy is not a harness regex job.
 * Kept as a public no-op so SDK callers still resolve the export.
 */
export function scanAddedLine(
  _path: string,
  _lineNo: number,
  _text: string,
): readonly ReviewHeuristicComment[] {
  return [];
}

/** Quality comments are never produced from a parsed diff file. */
export function scanDiffFile(_file: ReviewHeuristicFile): readonly ReviewHeuristicComment[] {
  return [];
}

/** Quality comments are never produced from parsed diff files. */
export function scanDiffFiles(
  _files: readonly ReviewHeuristicFile[],
): readonly ReviewHeuristicComment[] {
  return [];
}

/** Count added/removed lines in one parsed file. No quality judgment. */
export function inventoryDiffFile(file: ReviewHeuristicFile): ReviewFileInventory {
  let added = 0;
  let removed = 0;
  for (const hunk of file.hunks) {
    for (const line of hunk.lines) {
      if (line.type === 'add') added += 1;
      else if (line.type === 'remove') removed += 1;
    }
  }
  return { path: file.newPath, added, removed };
}

/** Count added/removed lines across many parsed files. */
export function inventoryDiffFiles(
  files: readonly ReviewHeuristicFile[],
): readonly ReviewFileInventory[] {
  return files.map(inventoryDiffFile);
}
