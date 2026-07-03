import type { RendererCellBuffer, RendererCellStyle } from './cell-buffer';

export interface RendererCellSnapshotOptions {
  readonly includeStyles?: boolean;
}

export interface RendererCellSnapshot {
  readonly width: number;
  readonly height: number;
  readonly lines: readonly string[];
  readonly styles: readonly RendererCellSnapshotStyleRun[];
}

export interface RendererCellSnapshotStyleRun {
  readonly y: number;
  readonly x: number;
  readonly width: number;
  readonly style?: RendererCellStyle;
  readonly link?: string;
}

export type RendererCellSnapshotChangeKind = 'size' | 'line' | 'style';

export interface RendererCellSnapshotChange {
  readonly kind: RendererCellSnapshotChangeKind;
  readonly y?: number;
  readonly expected: string;
  readonly actual: string;
}

export interface RendererCellSnapshotDiff {
  readonly equal: boolean;
  readonly changes: readonly RendererCellSnapshotChange[];
}

export interface FormatRendererCellSnapshotDiffOptions {
  readonly maxChanges?: number;
}

const DEFAULT_MAX_SNAPSHOT_DIFF_CHANGES = 12;

export function snapshotRendererCellBuffer(
  buffer: RendererCellBuffer,
  options: RendererCellSnapshotOptions = {},
): RendererCellSnapshot {
  return {
    width: buffer.width,
    height: buffer.height,
    lines: Array.from({ length: buffer.height }, (_, y) => snapshotLine(buffer, y)),
    styles: options.includeStyles === false ? [] : snapshotStyleRuns(buffer),
  };
}

export function formatRendererCellSnapshot(snapshot: RendererCellSnapshot): string {
  const lines = [
    `RendererCellSnapshot ${String(snapshot.width)}x${String(snapshot.height)}`,
    ...snapshot.lines.map((line) => `|${line}|`),
  ];
  if (snapshot.styles.length === 0) return lines.join('\n');
  lines.push('styles:');
  for (const run of snapshot.styles) lines.push(`  ${formatStyleRun(run)}`);
  return lines.join('\n');
}

export function diffRendererCellSnapshots(
  expected: RendererCellSnapshot,
  actual: RendererCellSnapshot,
): RendererCellSnapshotDiff {
  const changes: RendererCellSnapshotChange[] = [];
  if (expected.width !== actual.width || expected.height !== actual.height) {
    changes.push({
      kind: 'size',
      expected: `${String(expected.width)}x${String(expected.height)}`,
      actual: `${String(actual.width)}x${String(actual.height)}`,
    });
  }

  const maxLines = Math.max(expected.lines.length, actual.lines.length);
  for (let y = 0; y < maxLines; y++) {
    const expectedLine = expected.lines[y] ?? '';
    const actualLine = actual.lines[y] ?? '';
    if (expectedLine === actualLine) continue;
    changes.push({
      kind: 'line',
      y,
      expected: expectedLine,
      actual: actualLine,
    });
  }

  const expectedStyles = expected.styles.map(formatStyleRun);
  const actualStyles = actual.styles.map(formatStyleRun);
  const maxStyles = Math.max(expectedStyles.length, actualStyles.length);
  for (let index = 0; index < maxStyles; index++) {
    const expectedStyle = expectedStyles[index] ?? '';
    const actualStyle = actualStyles[index] ?? '';
    if (expectedStyle === actualStyle) continue;
    changes.push({
      kind: 'style',
      expected: expectedStyle,
      actual: actualStyle,
    });
  }

  return {
    equal: changes.length === 0,
    changes,
  };
}

export function formatRendererCellSnapshotDiff(
  diff: RendererCellSnapshotDiff,
  options: FormatRendererCellSnapshotDiffOptions = {},
): string {
  if (diff.equal) return 'Renderer cell snapshots match.';
  const maxChanges = normalizeMaxChanges(options.maxChanges);
  const visibleChanges = diff.changes.slice(0, maxChanges);
  const lines = [
    `Renderer cell snapshot mismatch: ${String(diff.changes.length)} change${diff.changes.length === 1 ? '' : 's'}.`,
  ];
  for (const change of visibleChanges) lines.push(formatSnapshotChange(change));
  if (visibleChanges.length < diff.changes.length) {
    lines.push(`... ${String(diff.changes.length - visibleChanges.length)} more`);
  }
  return lines.join('\n');
}

function snapshotLine(buffer: RendererCellBuffer, y: number): string {
  let line = '';
  for (let x = 0; x < buffer.width; x++) {
    const cell = buffer.getCell(x, y);
    if (cell.continuation === true) continue;
    line += cell.char.length === 0 ? ' ' : cell.char;
  }
  return line;
}

function snapshotStyleRuns(buffer: RendererCellBuffer): RendererCellSnapshotStyleRun[] {
  const runs: RendererCellSnapshotStyleRun[] = [];
  for (let y = 0; y < buffer.height; y++) {
    let runStart = 0;
    let runStyle: RendererCellStyle | undefined;
    let runLink: string | undefined;
    let runSignature = '';
    for (let x = 0; x < buffer.width; x++) {
      const cell = buffer.getCell(x, y);
      const style = copySnapshotStyle(cell.style);
      const link = cell.link;
      const signature = styleRunSignature(style, link);
      if (x === 0) {
        runStart = 0;
        runStyle = style;
        runLink = link;
        runSignature = signature;
        continue;
      }
      if (signature === runSignature) continue;
      pushStyleRun(runs, y, runStart, x - runStart, runStyle, runLink);
      runStart = x;
      runStyle = style;
      runLink = link;
      runSignature = signature;
    }
    pushStyleRun(runs, y, runStart, buffer.width - runStart, runStyle, runLink);
  }
  return runs;
}

function pushStyleRun(
  runs: RendererCellSnapshotStyleRun[],
  y: number,
  x: number,
  width: number,
  style: RendererCellStyle | undefined,
  link: string | undefined,
): void {
  if (width <= 0) return;
  if (style === undefined && link === undefined) return;
  runs.push({ y, x, width, style, link });
}

function copySnapshotStyle(style: RendererCellStyle | undefined): RendererCellStyle | undefined {
  if (style === undefined) return undefined;
  const copy: {
    fg?: string;
    bg?: string;
    bold?: boolean;
    dim?: boolean;
    italic?: boolean;
    underline?: boolean;
    inverse?: boolean;
  } = {};
  if (style.fg !== undefined) copy.fg = style.fg;
  if (style.bg !== undefined) copy.bg = style.bg;
  if (style.bold !== undefined) copy.bold = style.bold;
  if (style.dim !== undefined) copy.dim = style.dim;
  if (style.italic !== undefined) copy.italic = style.italic;
  if (style.underline !== undefined) copy.underline = style.underline;
  if (style.inverse !== undefined) copy.inverse = style.inverse;
  return Object.keys(copy).length === 0 ? undefined : copy;
}

function formatStyleRun(run: RendererCellSnapshotStyleRun): string {
  const parts = [`y${String(run.y)}`, `x${String(run.x)}..${String(run.x + run.width - 1)}`];
  if (run.style !== undefined) parts.push(formatSnapshotStyle(run.style));
  if (run.link !== undefined) parts.push(`link=${run.link}`);
  return parts.join(' ');
}

function formatSnapshotStyle(style: RendererCellStyle): string {
  const parts: string[] = [];
  if (style.fg !== undefined) parts.push(`fg=${style.fg}`);
  if (style.bg !== undefined) parts.push(`bg=${style.bg}`);
  if (style.bold === true) parts.push('bold');
  if (style.dim === true) parts.push('dim');
  if (style.italic === true) parts.push('italic');
  if (style.underline === true) parts.push('underline');
  if (style.inverse === true) parts.push('inverse');
  return parts.join(' ');
}

function styleRunSignature(
  style: RendererCellStyle | undefined,
  link: string | undefined,
): string {
  return `${formatSnapshotStyle(style ?? {})}\u0000${link ?? ''}`;
}

function formatSnapshotChange(change: RendererCellSnapshotChange): string {
  const prefix = change.y === undefined
    ? `${change.kind}:`
    : `${change.kind} y${String(change.y)}:`;
  return [
    prefix,
    `  - ${change.expected}`,
    `  + ${change.actual}`,
  ].join('\n');
}

function normalizeMaxChanges(value: number | undefined): number {
  if (value === undefined || !Number.isFinite(value)) return DEFAULT_MAX_SNAPSHOT_DIFF_CHANGES;
  return Math.max(0, Math.floor(value));
}
