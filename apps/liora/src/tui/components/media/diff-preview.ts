/**
 * Diff preview rendering as plain ANSI strings.
 *
 * Reuses the diff algorithm from approval/DiffPreview.tsx, but outputs
 * formatted text lines instead of React elements.
 */

import chalk from 'chalk';
import sliceAnsi from 'slice-ansi';

import { projectRendererLineWindow, visibleWidth } from '#/tui/renderer';
import { currentTheme } from '#/tui/theme';
import type { ColorPalette } from '#/tui/theme';

import { highlightLines, langFromPath } from './code-highlight';
import { buildSyntaxLookup, formatDiffRow } from './diff-preview-row-format';

export type DiffLineKind = 'context' | 'add' | 'delete';

/**
 * Diff styles applied to already-rendered code strings.
 *
 * Two tiers: a low-chroma line tint marks added/removed rows at a glance, and
 * a stronger word background pinpoints the exact changed spans inside paired
 * rows. Both tiers are alpha-blended against the theme background so they read
 * as material, not neon.
 */
export interface DiffStyles {
  add: (s: string) => string;
  del: (s: string) => string;
  addBold: (s: string) => string;
  delBold: (s: string) => string;
  gutter: (s: string) => string;
  meta: (s: string) => string;
  addLineBg: (s: string) => string;
  delLineBg: (s: string) => string;
  addWordBg: (s: string) => string;
  delWordBg: (s: string) => string;
}

/** Linear blend of two #RRGGBB colors; `t` is the weight of `b`. */
function mixHex(a: string, b: string, t: number): string {
  const parse = (hex: string): [number, number, number] => {
    const raw = hex.replace('#', '');
    return [
      Number.parseInt(raw.slice(0, 2), 16),
      Number.parseInt(raw.slice(2, 4), 16),
      Number.parseInt(raw.slice(4, 6), 16),
    ];
  };
  const [ar, ag, ab] = parse(a);
  const [br, bg, bb] = parse(b);
  const channel = (x: number, y: number): string =>
    Math.round(x + (y - x) * t)
      .toString(16)
      .padStart(2, '0');
  return `#${channel(ar, br)}${channel(ag, bg)}${channel(ab, bb)}`;
}

export function makeDiffStyles(): DiffStyles {
  const palette = currentTheme.palette;
  const canvas = palette.background;
  return {
    add: (s) => chalk.hex(palette.diffAdded)(s),
    del: (s) => chalk.hex(palette.diffRemoved)(s),
    addBold: (s) => chalk.bold.hex(palette.diffAddedStrong)(s),
    delBold: (s) => chalk.bold.hex(palette.diffRemovedStrong)(s),
    gutter: (s) => chalk.hex(palette.diffGutter)(s),
    meta: (s) => chalk.hex(palette.diffMeta)(s),
    // ~16% tint of the semantic color over the canvas.
    addLineBg: (s) => chalk.bgHex(mixHex(palette.diffAdded, canvas, 0.84))(s),
    delLineBg: (s) => chalk.bgHex(mixHex(palette.diffRemoved, canvas, 0.84))(s),
    // ~45% tint for the exact changed words inside a paired row.
    addWordBg: (s) => chalk.bgHex(mixHex(palette.diffAddedStrong, canvas, 0.55))(s),
    delWordBg: (s) => chalk.bgHex(mixHex(palette.diffRemovedStrong, canvas, 0.55))(s),
  };
}

/** One run of tokens inside a changed line; `changed` marks the exact edit. */
export interface WordSpan {
  readonly text: string;
  readonly changed: boolean;
}

/** Tokenize into word runs, whitespace runs, and single punctuation symbols. */
function tokenizeWords(line: string): string[] {
  return line.match(/[A-Za-z0-9_]+|\s+|[^\sA-Za-z0-9_]/gu) ?? [];
}

/**
 * Word-level spans for a paired delete/add line. Returns undefined when the
 * pair is too dissimilar (word highlighting would just add noise) or too
 * large for the quadratic token LCS.
 */
function computeWordSpans(
  oldLine: string,
  newLine: string,
): { del: WordSpan[]; add: WordSpan[] } | undefined {
  // Word slicing assumes one column per unit; bail on wide characters.
  if (/[^\u0000-\u00ff]/u.test(oldLine) || /[^\u0000-\u00ff]/u.test(newLine)) return undefined;
  const a = tokenizeWords(oldLine);
  const b = tokenizeWords(newLine);
  if (a.length === 0 || b.length === 0) return undefined;
  if (a.length * b.length > 4096) return undefined;
  const dp: number[][] = Array.from({ length: a.length + 1 }, () =>
    new Array<number>(b.length + 1).fill(0),
  );
  for (let i = a.length - 1; i >= 0; i--) {
    for (let j = b.length - 1; j >= 0; j--) {
      dp[i]![j] =
        a[i] === b[j] ? dp[i + 1]![j + 1]! + 1 : Math.max(dp[i + 1]![j]!, dp[i]![j + 1]!);
    }
  }
  const common = dp[0]![0]!;
  if (common / Math.max(a.length, b.length) < 0.4) return undefined;
  const del: WordSpan[] = [];
  const add: WordSpan[] = [];
  const push = (target: WordSpan[], text: string, changed: boolean): void => {
    const last = target[target.length - 1];
    if (last !== undefined && last.changed === changed) {
      target[target.length - 1] = { text: last.text + text, changed };
    } else {
      target.push({ text, changed });
    }
  };
  let i = 0;
  let j = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) {
      push(del, a[i]!, false);
      push(add, b[j]!, false);
      i++;
      j++;
    } else if (dp[i + 1]![j]! >= dp[i]![j + 1]!) {
      push(del, a[i]!, true);
      i++;
    } else {
      push(add, b[j]!, true);
      j++;
    }
  }
  while (i < a.length) push(del, a[i++]!, true);
  while (j < b.length) push(add, b[j++]!, true);
  const hasChange = del.some((span) => span.changed) || add.some((span) => span.changed);
  return hasChange ? { del, add } : undefined;
}

/**
 * Pair consecutive delete/add runs so changed rows can show word-level
 * highlights. Only rows with a partner get spans; pure inserts and removals
 * keep the plain line tint.
 */
export function pairWordSpans(diffLines: readonly DiffLine[]): Map<DiffLine, WordSpan[]> {
  const spans = new Map<DiffLine, WordSpan[]>();
  let i = 0;
  while (i < diffLines.length) {
    if (diffLines[i]!.kind !== 'delete') {
      i++;
      continue;
    }
    let delEnd = i;
    while (delEnd < diffLines.length && diffLines[delEnd]!.kind === 'delete') delEnd++;
    let addEnd = delEnd;
    while (addEnd < diffLines.length && diffLines[addEnd]!.kind === 'add') addEnd++;
    const pairCount = Math.min(delEnd - i, addEnd - delEnd);
    for (let k = 0; k < pairCount; k++) {
      const result = computeWordSpans(diffLines[i + k]!.code, diffLines[delEnd + k]!.code);
      if (result === undefined) continue;
      spans.set(diffLines[i + k]!, result.del);
      spans.set(diffLines[delEnd + k]!, result.add);
    }
    i = addEnd > delEnd ? addEnd : delEnd;
  }
  return spans;
}

export interface DiffLine {
  kind: DiffLineKind;
  lineNum: number;
  code: string;
}

export function computeDiffLines(
  oldText: string,
  newText: string,
  oldStart: number = 1,
  newStart: number = 1,
  isIncomplete: boolean = false,
): DiffLine[] {
  const oldLines = oldText ? oldText.split('\n') : [];
  const newLines = newText ? newText.split('\n') : [];
  const m = oldLines.length;
  const n = newLines.length;

  const dp: number[][] = Array.from({ length: m + 1 }, () =>
    Array.from({ length: n + 1 }, () => 0),
  );
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      if (oldLines[i - 1] === newLines[j - 1]) {
        dp[i]![j] = dp[i - 1]![j - 1]! + 1;
      } else {
        dp[i]![j] = Math.max(dp[i - 1]![j]!, dp[i]![j - 1]!);
      }
    }
  }

  const reversed: DiffLine[] = [];
  let i = m;
  let j = n;
  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && oldLines[i - 1] === newLines[j - 1]) {
      reversed.push({ kind: 'context', lineNum: newStart + j - 1, code: newLines[j - 1]! });
      i--;
      j--;
    } else if (j > 0 && (i === 0 || dp[i]![j - 1]! >= dp[i - 1]![j]!)) {
      reversed.push({ kind: 'add', lineNum: newStart + j - 1, code: newLines[j - 1]! });
      j--;
    } else {
      reversed.push({ kind: 'delete', lineNum: oldStart + i - 1, code: oldLines[i - 1]! });
      i--;
    }
  }

  const result: DiffLine[] = [];
  for (let k = reversed.length - 1; k >= 0; k--) {
    result.push(reversed[k]!);
  }

  // While the text is still streaming, suppress trailing delete lines.
  // They are likely artefacts of newText not having arrived yet rather
  // than genuine deletions.
  if (isIncomplete && result.length > 0) {
    let lastNonDelete = result.length - 1;
    while (lastNonDelete >= 0 && result[lastNonDelete]!.kind === 'delete') {
      lastNonDelete--;
    }
    if (lastNonDelete >= 0) {
      result.length = lastNonDelete + 1;
    } else {
      // Every line would be shown as deleted; suppress them all so the
      // UI doesn't flash a wall of red before newText starts arriving.
      result.length = 0;
    }
  }

  return result;
}

export function renderDiffLines(
  oldText: string,
  newText: string,
  path: string,
  isIncomplete: boolean = false,
  oldStart?: number,
  newStart?: number,
  maxLines?: number,
): string[] {
  const s = makeDiffStyles();
  const diffLines = computeDiffLines(oldText, newText, oldStart ?? 1, newStart ?? 1, isIncomplete);
  const changedLines = diffLines.filter((l) => l.kind !== 'context');
  const added = changedLines.filter((l) => l.kind === 'add').length;
  const removed = changedLines.filter((l) => l.kind === 'delete').length;

  const output: string[] = [];

  let header = '';
  if (added > 0) header += s.addBold(`+${String(added)} `);
  if (removed > 0) header += s.delBold(`-${String(removed)} `);
  header += path;
  output.push(header);

  const preview = projectRendererLineWindow({
    lines: changedLines,
    maxLines: maxLines !== undefined && maxLines >= 0 ? maxLines : undefined,
  });

  const syntaxByCode = buildSyntaxLookup(changedLines, path, true);
  const wordSpans = pairWordSpans(preview.lines);
  for (const line of preview.lines) {
    output.push(formatDiffRow(line, s, syntaxByCode, wordSpans.get(line)));
  }

  const hidden = preview.hiddenLineCount;
  if (hidden > 0) {
    output.push(
      s.meta(
        `     … ${String(hidden)} more change${hidden > 1 ? 's' : ''} hidden (ctrl+o to expand)`,
      ),
    );
  }

  return output;
}


export type { ClusteredDiffOptions, DiffPreviewRow, DiffPreviewRowKind } from './diff-preview-cluster';
export {
  diffLineBackground,
  renderClusteredDiffBody,
  renderClusteredDiffRows,
  renderDiffLinesClustered,
  renderDiffLinesClusteredRows,
} from './diff-preview-cluster';
