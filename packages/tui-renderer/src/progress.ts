import { truncateToWidth, visibleWidth } from './text-component';

export const RENDERER_BRAILLE_PROGRESS_EMPTY = '⣀';
export const RENDERER_BRAILLE_PROGRESS_SEPARATOR = '⢸';
export const RENDERER_BRAILLE_PROGRESS_LEVELS = [
  '⣀',
  '⣄',
  '⣤',
  '⣦',
  '⣶',
  '⣷',
  '⣿',
] as const;
export const RENDERER_RATIO_PROGRESS_FILLED = '█';
export const RENDERER_RATIO_PROGRESS_EMPTY = '░';

export interface RendererSegmentedProgressSegment {
  readonly value: number;
  readonly char?: string;
  readonly style?: (text: string) => string;
}

export interface RendererSegmentedProgressBarOptions {
  readonly width: number;
  readonly segments: readonly RendererSegmentedProgressSegment[];
  readonly char?: string;
  readonly emptyChar?: string;
  readonly emptyStyle?: (text: string) => string;
}

export interface RendererSegmentedProgressSegmentProjection {
  readonly index: number;
  readonly value: number;
  readonly width: number;
  readonly char: string;
}

export interface RendererSegmentedProgressBarProjection {
  readonly width: number;
  readonly total: number;
  readonly segments: readonly RendererSegmentedProgressSegmentProjection[];
}

export interface RendererRatioProgressBarOptions {
  readonly ratio: number;
  readonly width: number;
  readonly filledChar?: string;
  readonly emptyChar?: string;
  readonly filledStyle?: (text: string) => string;
  readonly emptyStyle?: (text: string) => string;
}

export interface RendererRatioProgressBarProjection {
  readonly width: number;
  readonly ratio: number;
  readonly filledWidth: number;
  readonly emptyWidth: number;
  readonly filledChar: string;
  readonly emptyChar: string;
}

export interface RendererSteppedProgressBarCellProjection {
  readonly index: number;
  readonly char: string;
  readonly level: number;
  readonly filled: boolean;
  readonly separator: boolean;
}

export interface RendererSteppedProgressBarProjection {
  readonly width: number;
  readonly ticks: number;
  readonly levelsPerCell: number;
  readonly completedCycles: number;
  readonly cycleTicks: number;
  readonly cells: readonly RendererSteppedProgressBarCellProjection[];
}

export type RendererSteppedProgressBarCellStyle = (
  text: string,
  cell: RendererSteppedProgressBarCellProjection,
) => string;

export interface RendererSteppedProgressBarOptions {
  readonly width: number;
  readonly ticks: number;
  readonly levels?: readonly string[];
  readonly emptyChar?: string;
  readonly separatorChar?: string;
  readonly filledStyle?: RendererSteppedProgressBarCellStyle;
  readonly emptyStyle?: RendererSteppedProgressBarCellStyle;
  readonly separatorStyle?: RendererSteppedProgressBarCellStyle;
  readonly styleForCell?: (
    cell: RendererSteppedProgressBarCellProjection,
  ) => RendererSteppedProgressBarCellStyle | undefined;
}

export function projectRendererSegmentedProgressBar(
  options: RendererSegmentedProgressBarOptions,
): RendererSegmentedProgressBarProjection {
  const width = normalizeProgressWidth(options.width);
  const values = options.segments.map((segment) => normalizeSegmentValue(segment.value));
  const total = values.reduce((sum, value) => sum + value, 0);
  const segmentWidths = allocateProgressSegmentWidths(values, width);
  const fallbackChar = normalizeProgressChar(options.char ?? '━');
  return {
    width,
    total,
    segments: options.segments.map((segment, index) => ({
      index,
      value: values[index] ?? 0,
      width: segmentWidths[index] ?? 0,
      char: normalizeProgressChar(segment.char ?? fallbackChar),
    })),
  };
}

export function renderRendererSegmentedProgressBar(
  options: RendererSegmentedProgressBarOptions,
): string {
  const projection = projectRendererSegmentedProgressBar(options);
  if (projection.width <= 0) return '';
  if (projection.total <= 0) {
    const empty = fillProgressSegment(
      normalizeProgressChar(options.emptyChar ?? options.char ?? '━'),
      projection.width,
    );
    return options.emptyStyle?.(empty) ?? empty;
  }

  let rendered = '';
  for (const segment of projection.segments) {
    if (segment.width <= 0) continue;
    const text = fillProgressSegment(segment.char, segment.width);
    const style = options.segments[segment.index]?.style;
    rendered += style?.(text) ?? text;
  }
  return truncateToWidth(rendered, projection.width, '');
}

export function projectRendererRatioProgressBar(
  options: RendererRatioProgressBarOptions,
): RendererRatioProgressBarProjection {
  const width = normalizeProgressWidth(options.width);
  const ratio = normalizeProgressRatio(options.ratio);
  const filledWidth = Math.round(ratio * width);
  return {
    width,
    ratio,
    filledWidth,
    emptyWidth: Math.max(0, width - filledWidth),
    filledChar: normalizeProgressChar(
      options.filledChar ?? RENDERER_RATIO_PROGRESS_FILLED,
    ),
    emptyChar: normalizeProgressChar(options.emptyChar ?? RENDERER_RATIO_PROGRESS_EMPTY),
  };
}

export function renderRendererRatioProgressBar(
  options: RendererRatioProgressBarOptions,
): string {
  const projection = projectRendererRatioProgressBar(options);
  if (projection.width <= 0) return '';
  const filled = fillProgressSegment(projection.filledChar, projection.filledWidth);
  const empty = fillProgressSegment(projection.emptyChar, projection.emptyWidth);
  const rendered =
    (options.filledStyle?.(filled) ?? filled) +
    (options.emptyStyle?.(empty) ?? empty);
  return truncateToWidth(rendered, projection.width, '');
}

export function projectRendererSteppedProgressBar(
  options: RendererSteppedProgressBarOptions,
): RendererSteppedProgressBarProjection {
  const width = normalizeProgressWidth(options.width);
  const levels = normalizeProgressLevels(options.levels);
  const levelsPerCell = levels.length;
  const ticks = normalizeProgressTicks(options.ticks);
  const cycleSize = width * levelsPerCell;
  const completedCycles = cycleSize > 0 ? Math.floor(ticks / cycleSize) : 0;
  const cycleTicks = cycleSize > 0 ? ticks % cycleSize : 0;
  const activeCells = cycleTicks === 0 ? 0 : Math.ceil(cycleTicks / levelsPerCell);
  const separatorIndex = completedCycles > 0 && activeCells > 0 && activeCells < width
    ? activeCells
    : -1;
  const emptyChar = normalizeProgressChar(
    options.emptyChar ?? RENDERER_BRAILLE_PROGRESS_EMPTY,
  );
  const separatorChar = normalizeProgressChar(
    options.separatorChar ?? RENDERER_BRAILLE_PROGRESS_SEPARATOR,
  );

  const cells: RendererSteppedProgressBarCellProjection[] = [];
  for (let index = 0; index < width; index += 1) {
    if (index === separatorIndex) {
      cells.push({
        index,
        char: separatorChar,
        level: levelsPerCell,
        filled: true,
        separator: true,
      });
      continue;
    }

    const cellStart = index * levelsPerCell;
    const countThisCycle = Math.max(
      0,
      Math.min(levelsPerCell, cycleTicks - cellStart),
    );
    const level = countThisCycle > 0
      ? countThisCycle
      : completedCycles > 0
        ? levelsPerCell
        : 0;
    cells.push({
      index,
      char: level === 0 ? emptyChar : levels[level - 1]!,
      level,
      filled: level > 0,
      separator: false,
    });
  }

  return {
    width,
    ticks,
    levelsPerCell,
    completedCycles,
    cycleTicks,
    cells,
  };
}

export function renderRendererSteppedProgressBar(
  options: RendererSteppedProgressBarOptions,
): string {
  const projection = projectRendererSteppedProgressBar(options);
  if (projection.width <= 0) return '';

  let rendered = '';
  for (const cell of projection.cells) {
    const style =
      options.styleForCell?.(cell) ??
      (cell.separator
        ? options.separatorStyle ?? options.filledStyle
        : cell.filled
          ? options.filledStyle
          : options.emptyStyle);
    rendered += style?.(cell.char, cell) ?? cell.char;
  }
  return truncateToWidth(rendered, projection.width, '');
}

function allocateProgressSegmentWidths(values: readonly number[], width: number): number[] {
  const total = values.reduce((sum, value) => sum + value, 0);
  if (total <= 0 || width <= 0) return values.map(() => 0);

  const exact = values.map((value) => value * width / total);
  const widths = exact.map(Math.floor);
  let remaining = width - widths.reduce((sum, value) => sum + value, 0);
  const order = exact
    .map((value, index) => ({ index, fraction: value - Math.floor(value) }))
    .toSorted((a, b) => b.fraction - a.fraction || a.index - b.index);

  for (const entry of order) {
    if (remaining <= 0) break;
    widths[entry.index] = (widths[entry.index] ?? 0) + 1;
    remaining -= 1;
  }
  return widths;
}

function fillProgressSegment(char: string, width: number): string {
  const safeWidth = normalizeProgressWidth(width);
  let output = '';
  while (visibleWidth(output) < safeWidth) {
    output += char;
  }
  return visibleWidth(output) > safeWidth ? truncateToWidth(output, safeWidth, '') : output;
}

function normalizeProgressWidth(value: number): number {
  return Number.isFinite(value) ? Math.max(0, Math.floor(value)) : 0;
}

function normalizeSegmentValue(value: number): number {
  return Number.isFinite(value) ? Math.max(0, value) : 0;
}

function normalizeProgressTicks(value: number): number {
  return Number.isFinite(value) ? Math.max(0, Math.ceil(value)) : 0;
}

function normalizeProgressRatio(value: number): number {
  return Number.isFinite(value) ? Math.max(0, Math.min(value, 1)) : 0;
}

function normalizeProgressChar(value: string): string {
  return visibleWidth(value) > 0 ? value : '━';
}

function normalizeProgressLevels(
  levels: readonly string[] | undefined,
): readonly string[] {
  const normalized = (levels ?? RENDERER_BRAILLE_PROGRESS_LEVELS)
    .map(normalizeProgressChar)
    .filter((level) => visibleWidth(level) > 0);
  return normalized.length > 0 ? normalized : RENDERER_BRAILLE_PROGRESS_LEVELS;
}
