/**
 * Bounded line-level diff for file provenance.
 *
 * Computes which lines of the AFTER content a mutation added and how many
 * BEFORE lines it removed, as 1-based inclusive ranges. Common prefix/suffix
 * lines are trimmed first (typical edits touch a small middle), then an LCS
 * runs on the remaining middle. The LCS is capped: when the trimmed middle
 * exceeds the cell budget, every after-middle line counts as added — exact
 * for full rewrites, coarse for huge rearrangements, never unbounded work.
 *
 * Pure and allocation-light so file tools can call it on every successful
 * mutation without a measurable latency cost.
 */

/** 1-based inclusive line range in the post-mutation content. */
export interface LineRange {
  readonly start: number;
  readonly end: number;
}

export interface LineDiffSummary {
  /** Ranges of AFTER lines this mutation added; empty when nothing was added. */
  readonly added: readonly LineRange[];
  readonly addedLines: number;
  readonly removedLines: number;
}

/** LCS cell cap after prefix/suffix trimming (~4 MB Uint32 table). */
const MAX_LCS_CELLS = 1_000_000;

/**
 * Split file text into logical lines. A trailing newline does not produce a
 * phantom line; an empty string yields zero lines. CRLF endings keep their
 * `\r` — diffing only compares like-for-like texts whose line counts match
 * the on-disk file either way.
 */
function splitLines(text: string): readonly string[] {
  if (text.length === 0) return [];
  const parts = text.split('\n');
  if (parts.at(-1) === '') parts.pop();
  return parts;
}

/**
 * Summarize a before → after mutation at line granularity. `before === null`
 * means the file did not exist (every after line is added); `after === null`
 * means the file was deleted (everything removed, nothing added).
 */
export function diffAddedLineRanges(before: string | null, after: string | null): LineDiffSummary {
  const beforeLines = before === null ? [] : splitLines(before);
  const afterLines = after === null ? [] : splitLines(after);

  if (after === null) {
    return { added: [], addedLines: 0, removedLines: beforeLines.length };
  }
  if (beforeLines.length === 0 && afterLines.length === 0) {
    return { added: [], addedLines: 0, removedLines: 0 };
  }

  let prefix = 0;
  const minLen = Math.min(beforeLines.length, afterLines.length);
  while (prefix < minLen) {
    const b = beforeLines[prefix];
    const a = afterLines[prefix];
    if (b === undefined || a === undefined || b !== a) break;
    prefix++;
  }
  let suffix = 0;
  while (suffix < minLen - prefix) {
    const b = beforeLines[beforeLines.length - 1 - suffix];
    const a = afterLines[afterLines.length - 1 - suffix];
    if (b === undefined || a === undefined || b !== a) break;
    suffix++;
  }

  const middleBefore = beforeLines.slice(prefix, beforeLines.length - suffix);
  const middleAfter = afterLines.slice(prefix, afterLines.length - suffix);

  if (middleAfter.length === 0) {
    return { added: [], addedLines: 0, removedLines: middleBefore.length };
  }
  if (middleBefore.length === 0 || middleBefore.length * middleAfter.length > MAX_LCS_CELLS) {
    return range(prefix + 1, prefix + middleAfter.length, middleBefore.length);
  }

  const { keptAfter, removed } = lcsKeptAfter(middleBefore, middleAfter);
  const added: LineRange[] = [];
  let addedLines = 0;
  let runStart = -1;
  for (let i = 0; i < middleAfter.length; i++) {
    const line = prefix + i + 1;
    if (keptAfter[i]) {
      if (runStart !== -1) {
        added.push({ start: runStart, end: line - 1 });
        addedLines += line - runStart;
        runStart = -1;
      }
    } else if (runStart === -1) {
      runStart = line;
    }
  }
  if (runStart !== -1) {
    added.push({ start: runStart, end: prefix + middleAfter.length });
    addedLines += prefix + middleAfter.length - runStart + 1;
  }
  return { added, addedLines, removedLines: removed };
}

function range(start: number, end: number, removedLines: number): LineDiffSummary {
  return { added: [{ start, end }], addedLines: end - start + 1, removedLines };
}

/**
 * Full-table LCS on the trimmed middle. Returns a boolean per after-middle
 * line (true = matched to a before line, i.e. NOT added) plus the count of
 * unmatched before lines. Callers guarantee the cell budget.
 */
function lcsKeptAfter(
  before: readonly string[],
  after: readonly string[],
): { keptAfter: readonly boolean[]; removed: number } {
  const n = before.length;
  const m = after.length;
  // dp[i * (m + 1) + j] = LCS length of before[i..] and after[j..]
  const dp = new Uint32Array((n + 1) * (m + 1));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      const diag = dp[(i + 1) * (m + 1) + j + 1] ?? 0;
      const down = dp[(i + 1) * (m + 1) + j] ?? 0;
      const right = dp[i * (m + 1) + j + 1] ?? 0;
      dp[i * (m + 1) + j] =
        before[i] === after[j] ? diag + 1 : Math.max(down, right);
    }
  }
  const keptAfter = Array.from<boolean>({ length: m }).fill(false);
  let removed = 0;
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (before[i] === after[j]) {
      keptAfter[j] = true;
      i++;
      j++;
      continue;
    }
    const down = dp[(i + 1) * (m + 1) + j] ?? 0;
    const right = dp[i * (m + 1) + j + 1] ?? 0;
    if (down >= right) {
      i++;
      removed++;
    } else {
      j++;
    }
  }
  removed += n - i;
  return { keptAfter, removed };
}
