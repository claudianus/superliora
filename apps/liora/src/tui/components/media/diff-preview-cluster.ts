import sliceAnsi from 'slice-ansi';

import { projectRendererLineWindow } from '#/tui/renderer';
import type { ColorPalette } from '#/tui/theme';

import {
  computeDiffLines,
  makeDiffStyles,
  pairWordSpans,
  type DiffLine,
  type DiffLineKind,
} from './diff-preview';
import { buildSyntaxLookup, formatDiffRow } from './diff-preview-row-format';

export interface ClusteredDiffOptions {
  readonly contextLines?: number;
  readonly maxLines?: number;
  readonly isIncomplete?: boolean;
  readonly expandKeyHint?: string;
  /**
   * When true (default), highlight code on each diff row using language from
   * `path`. Diff markers (+/-) and gutter stay on the diff palette; only the
   * code body receives syntax colors.
   */
  readonly syntaxHighlight?: boolean;
  readonly palette?: ColorPalette;
  /**
   * Paint changed rows across the gutter+marker+code span instead of hugging
   * the code text. When `width` is set, the tint is padded to that many
   * visible columns so short rows still read as one edge-to-edge surface.
   */
  readonly fullRowBackground?: boolean;
  /** Target visible column count for `fullRowBackground` padding. */
  readonly width?: number;
  /**
   * Anchor the preview window to the newest changes instead of the first
   * ones — the streaming "follow the edit" mode. Mirrors Write's live tail
   * window so the viewport tracks the code currently being written.
   */
  readonly tail?: boolean;
}

interface Cluster {
  readonly start: number;
  readonly end: number;
}

interface DiffBodyRow {
  readonly text: string;
  readonly kind: DiffPreviewRowKind;
  readonly line?: DiffLine;
}

function buildClusters(
  diffLines: DiffLine[],
  contextLines: number,
): { clusters: Cluster[]; changedCount: number; addedCount: number; removedCount: number } {
  const changeIndices: number[] = [];
  let added = 0;
  let removed = 0;
  for (const [i, line] of diffLines.entries()) {
    if (line.kind === 'add') {
      added++;
      changeIndices.push(i);
    } else if (line.kind === 'delete') {
      removed++;
      changeIndices.push(i);
    }
  }

  const clusters: Cluster[] = [];
  if (changeIndices.length === 0) {
    return { clusters, changedCount: 0, addedCount: added, removedCount: removed };
  }

  const mergeGap = 2 * contextLines;
  let groupStart = changeIndices[0]!;
  let groupEnd = changeIndices[0]!;
  for (let i = 1; i < changeIndices.length; i++) {
    const idx = changeIndices[i]!;
    if (idx - groupEnd <= mergeGap) {
      groupEnd = idx;
    } else {
      clusters.push({
        start: Math.max(0, groupStart - contextLines),
        end: Math.min(diffLines.length - 1, groupEnd + contextLines),
      });
      groupStart = idx;
      groupEnd = idx;
    }
  }
  clusters.push({
    start: Math.max(0, groupStart - contextLines),
    end: Math.min(diffLines.length - 1, groupEnd + contextLines),
  });

  return {
    clusters,
    changedCount: changeIndices.length,
    addedCount: added,
    removedCount: removed,
  };
}

/** Semantic kind of a rendered diff row; `meta` covers headers and footers. */
export type DiffPreviewRowKind = DiffLineKind | 'meta';

/** One rendered diff row plus its kind, so callers can paint full lines. */
export interface DiffPreviewRow {
  readonly text: string;
  readonly kind: DiffPreviewRowKind;
}

/**
 * Line background painter for diff rows rendered through `Text`'s
 * `customBgFn`: the component pads every visual line to full width, and this
 * paints the padded span with the same material tint the inline row carries.
 */
export function diffLineBackground(kind: 'add' | 'delete'): (text: string) => string {
  const s = makeDiffStyles();
  return kind === 'add' ? s.addLineBg : s.delLineBg;
}

/**
 * Render a diff with surrounding context, eliding unchanged middle
 * regions between change clusters with a `… N unchanged lines …`
 * separator. When `maxLines` is set, the renderer projection selects
 * the body window and a `ctrl+o to expand` footer is appended.
 *
 * Used by Edit's call preview where we want to show *what changed*
 * with enough context to read the change, but not the whole file.
 */
export function renderDiffLinesClustered(
  oldText: string,
  newText: string,
  path: string,
  opts: ClusteredDiffOptions = {},
): string[] {
  return renderDiffLinesClusteredRows(oldText, newText, path, opts).map((row) => row.text);
}

/**
 * Like {@link renderDiffLinesClustered}, but keeps each row's diff kind so
 * callers (e.g. the Edit tool card) can paint the full terminal line.
 */
export function renderDiffLinesClusteredRows(
  oldText: string,
  newText: string,
  path: string,
  opts: ClusteredDiffOptions = {},
): DiffPreviewRow[] {
  const diffLines = computeDiffLines(oldText, newText, 1, 1, opts.isIncomplete ?? false);
  return renderClusteredDiffRows(diffLines, path, opts);
}

/**
 * Render pre-computed {@link DiffLine}s (for example, lines parsed from a
 * `git diff` unified output) with the same clustering, gutter formatting,
 * and elision as {@link renderDiffLinesClustered}. Callers that already hold
 * diff lines reuse this single formatter instead of re-deriving one.
 */
export function renderClusteredDiffBody(
  diffLines: DiffLine[],
  path: string,
  opts: ClusteredDiffOptions = {},
): string[] {
  return renderClusteredDiffRows(diffLines, path, opts).map((row) => row.text);
}

/** Row-kind-aware core behind {@link renderClusteredDiffBody}. */
export function renderClusteredDiffRows(
  diffLines: DiffLine[],
  path: string,
  opts: ClusteredDiffOptions = {},
): DiffPreviewRow[] {
  const s = makeDiffStyles();
  const contextLines = opts.contextLines ?? 3;
  const maxLines = opts.maxLines;
  const syntaxHighlight = opts.syntaxHighlight !== false;
  const syntaxByCode = buildSyntaxLookup(
    diffLines,
    path,
    syntaxHighlight,
    opts.palette,
  );
  const wordSpans = pairWordSpans(diffLines);
  const fullRow = opts.fullRowBackground === true ? { width: opts.width } : undefined;
  const { clusters, changedCount, addedCount, removedCount } = buildClusters(
    diffLines,
    contextLines,
  );

  const output: DiffPreviewRow[] = [];
  let header = '';
  if (addedCount > 0) header += s.addBold(`+${String(addedCount)} `);
  if (removedCount > 0) header += s.delBold(`-${String(removedCount)} `);
  header += path;
  output.push({ text: header, kind: 'meta' });

  if (clusters.length === 0) return output;

  const bodyRows: DiffBodyRow[] = [];
  let prevEnd = -1;

  for (const cluster of clusters) {
    if (prevEnd >= 0) {
      const gap = cluster.start - prevEnd - 1;
      if (gap > 0) {
        bodyRows.push({
          text: s.meta(`     … ${String(gap)} unchanged line${gap > 1 ? 's' : ''} …`),
          kind: 'meta',
        });
      }
    }
    for (let i = cluster.start; i <= cluster.end; i++) {
      const line = diffLines[i]!;
      bodyRows.push({
        text: formatDiffRow(line, s, syntaxByCode, wordSpans.get(line), fullRow),
        kind: line.kind,
        line,
      });
    }
    prevEnd = cluster.end;
  }

  const preview = projectRendererLineWindow({
    lines: bodyRows,
    maxLines: maxLines !== undefined && maxLines >= 0 ? maxLines : undefined,
    tail: opts.tail === true,
  });
  output.push(...preview.lines.map((row) => ({ text: row.text, kind: row.kind })));

  if (preview.hiddenLineCount > 0) {
    const shownChanges = preview.lines.filter((row) => row.line?.kind !== 'context').length;
    const hidden = changedCount - shownChanges;
    if (hidden > 0) {
      const hint = opts.expandKeyHint ?? 'ctrl+o';
      output.push({
        text: s.meta(
          `     … ${String(hidden)} more change${hidden > 1 ? 's' : ''} hidden (${hint} to expand)`,
        ),
        kind: 'meta',
      });
    }
  }

  return output;
}
