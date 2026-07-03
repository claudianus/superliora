import { mixHexColor, triangleWave } from './animation';
import {
  cellsEqual,
  type RendererCell,
  type RendererCellBuffer,
  type RendererCellStyle,
  type RendererDamageRect,
} from './cell-buffer';
import { clipRendererDamageRect, unionRendererDamageRect } from './damage';
import { hashRendererEffectSeed } from './text-effects';
import { displayClusterWidth, splitDisplayClusters } from './text-metrics';

export type RendererCellVfxKind = 'none' | 'pulse' | 'shimmer' | 'reveal';
export type RendererCellVfxTarget = 'fg' | 'bg' | 'both';
export type RendererCellVfxDirection = 'forward' | 'reverse';

export interface RendererCellVfxTimingOptions {
  readonly progress?: number;
  readonly nowMs?: number;
  readonly intervalMs?: number;
  readonly seed?: string;
  readonly offset?: number;
}

export interface RendererCellVfxStyleOptions {
  readonly color?: string;
  readonly style?: RendererCellStyle;
  readonly target?: RendererCellVfxTarget;
}

export interface RendererCellPulseOptions extends RendererCellVfxTimingOptions, RendererCellVfxStyleOptions {
  readonly minIntensity?: number;
  readonly maxIntensity?: number;
}

export interface RendererCellShimmerOptions extends RendererCellVfxTimingOptions, RendererCellVfxStyleOptions {
  readonly width?: number;
  readonly direction?: RendererCellVfxDirection;
}

export interface RendererCellRevealOptions extends RendererCellVfxTimingOptions {
  readonly hiddenStyle?: RendererCellStyle;
  readonly maskChar?: string;
}

export type RendererCellVfxOptions =
  | ({ readonly kind: 'none' } & RendererCellVfxTimingOptions)
  | ({ readonly kind: 'pulse' } & RendererCellPulseOptions)
  | ({ readonly kind: 'shimmer' } & RendererCellShimmerOptions)
  | ({ readonly kind: 'reveal' } & RendererCellRevealOptions);

export interface RendererCellVfxBufferOptions {
  readonly effect: RendererCellVfxOptions;
  readonly rect?: RendererDamageRect;
}

export function applyRendererCellVfx(
  cells: readonly RendererCell[],
  options: RendererCellVfxOptions,
): readonly RendererCell[] {
  switch (options.kind) {
    case 'none':
      return cells;
    case 'pulse':
      return applyRendererCellPulse(cells, options);
    case 'shimmer':
      return applyRendererCellShimmer(cells, options);
    case 'reveal':
      return applyRendererCellReveal(cells, options);
  }
}

export function applyRendererCellVfxToBuffer(
  buffer: RendererCellBuffer,
  options: RendererCellVfxBufferOptions,
): RendererDamageRect | null {
  if (options.effect.kind === 'none') return null;
  const rect = clipRendererDamageRect(
    options.rect ?? { x: 0, y: 0, width: buffer.width, height: buffer.height },
    buffer.width,
    buffer.height,
  );
  if (rect === null) return null;

  let changedRect: RendererDamageRect | null = null;
  for (let y = rect.y; y < rect.y + rect.height; y++) {
    const row = readRendererCellVfxBufferRow(buffer, rect.x, y, rect.width);
    const nextRow = applyRendererCellVfx(row, options.effect);
    for (let offset = 0; offset < nextRow.length; offset++) {
      const nextCell = nextRow[offset]!;
      if (cellsEqual(row[offset]!, nextCell)) continue;
      const x = rect.x + offset;
      buffer.setCell(x, y, nextCell);
      changedRect = unionRendererDamageRect(changedRect, { x, y, width: 1, height: 1 });
    }
  }

  return changedRect;
}

export function applyRendererCellPulse(
  cells: readonly RendererCell[],
  options: RendererCellPulseOptions,
): readonly RendererCell[] {
  if (cells.length === 0) return [];
  const overlay = createRendererCellVfxOverlay(options);
  if (overlay === undefined) return cells;
  const wave = triangleWave(resolveRendererCellVfxProgress(options));
  const minIntensity = clamp01(options.minIntensity ?? 0.25);
  const maxIntensity = Math.max(minIntensity, clamp01(options.maxIntensity ?? 0.75));
  const intensity = minIntensity + (maxIntensity - minIntensity) * wave;
  return cells.map((cell) => applyRendererCellVfxStyle(cell, overlay, intensity));
}

export function applyRendererCellShimmer(
  cells: readonly RendererCell[],
  options: RendererCellShimmerOptions,
): readonly RendererCell[] {
  if (cells.length === 0) return [];
  const overlay = createRendererCellVfxOverlay(options);
  if (overlay === undefined) return cells;

  const ordinals = rendererCellVisualOrdinals(cells);
  const visualCellCount = rendererVisualCellCount(ordinals);
  if (visualCellCount === 0) return cells;

  const phase = options.direction === 'reverse'
    ? 1 - resolveRendererCellVfxProgress(options)
    : resolveRendererCellVfxProgress(options);
  const radius = normalizeShimmerWidth(options.width);
  const center = visualCellCount <= 1 ? 0 : phase * (visualCellCount - 1);

  return cells.map((cell, index) => {
    const ordinal = ordinals[index];
    if (ordinal === undefined) return cell;
    const distance = Math.abs(ordinal - center);
    if (distance >= radius) return { ...cell };
    return applyRendererCellVfxStyle(cell, overlay, 1 - distance / radius);
  });
}

export function applyRendererCellReveal(
  cells: readonly RendererCell[],
  options: RendererCellRevealOptions,
): readonly RendererCell[] {
  if (cells.length === 0) return [];
  const ordinals = rendererCellVisualOrdinals(cells);
  const visualCellCount = rendererVisualCellCount(ordinals);
  if (visualCellCount === 0) return cells;

  const progress = resolveRendererCellVfxProgress(options);
  const visibleCells = progress >= 1 ? visualCellCount : Math.floor(visualCellCount * progress);
  const maskChar = normalizeMaskChar(options.maskChar);
  return cells.map((cell, index) => {
    const ordinal = ordinals[index];
    if (ordinal !== undefined && ordinal < visibleCells) return { ...cell };
    return maskRendererCell(cell, maskChar, options.hiddenStyle);
  });
}

export function resolveRendererCellVfxProgress(
  options: RendererCellVfxTimingOptions = {},
): number {
  if (options.progress !== undefined) return clamp01(options.progress);
  const intervalMs = normalizeIntervalMs(options.intervalMs);
  if (intervalMs === 0) return 0;
  const timeProgress = normalizeTimeMs(options.nowMs) / intervalMs;
  const seedProgress = options.seed === undefined
    ? 0
    : (hashRendererEffectSeed(options.seed) % 10_000) / 10_000;
  return positiveModulo(timeProgress + seedProgress + (options.offset ?? 0), 1);
}

function applyRendererCellVfxStyle(
  cell: RendererCell,
  overlay: RendererCellStyle,
  intensity: number,
): RendererCell {
  const style = mixRendererCellVfxStyle(cell.style, overlay, intensity);
  return style === undefined ? { ...cell, style: undefined } : { ...cell, style };
}

function readRendererCellVfxBufferRow(
  buffer: RendererCellBuffer,
  x: number,
  y: number,
  width: number,
): readonly RendererCell[] {
  return Array.from({ length: width }, (_, offset) => buffer.getCell(x + offset, y));
}

function createRendererCellVfxOverlay(
  options: RendererCellVfxStyleOptions,
): RendererCellStyle | undefined {
  const target = options.target ?? 'fg';
  const overlay: RendererCellStyle = {
    ...options.style,
    fg: options.style?.fg ?? (target === 'fg' || target === 'both' ? options.color : undefined),
    bg: options.style?.bg ?? (target === 'bg' || target === 'both' ? options.color : undefined),
  };
  return normalizeRendererCellVfxStyle(overlay);
}

function mixRendererCellVfxStyle(
  base: RendererCellStyle | undefined,
  overlay: RendererCellStyle,
  intensity: number,
): RendererCellStyle | undefined {
  const t = clamp01(intensity);
  const style: RendererCellStyle = {
    fg: mixRendererCellVfxColor(base?.fg, overlay.fg, t),
    bg: mixRendererCellVfxColor(base?.bg, overlay.bg, t),
    bold: chooseRendererCellVfxFlag(base?.bold, overlay.bold, t),
    dim: chooseRendererCellVfxFlag(base?.dim, overlay.dim, t),
    italic: chooseRendererCellVfxFlag(base?.italic, overlay.italic, t),
    underline: chooseRendererCellVfxFlag(base?.underline, overlay.underline, t),
    inverse: chooseRendererCellVfxFlag(base?.inverse, overlay.inverse, t),
  };
  return normalizeRendererCellVfxStyle(style);
}

function mixRendererCellVfxColor(
  base: string | undefined,
  overlay: string | undefined,
  intensity: number,
): string | undefined {
  if (overlay === undefined || intensity <= 0) return base;
  if (base === undefined) return overlay;
  return mixHexColor(base, overlay, intensity);
}

function chooseRendererCellVfxFlag(
  base: boolean | undefined,
  overlay: boolean | undefined,
  intensity: number,
): boolean | undefined {
  if (overlay === undefined || intensity < 0.5) return base === true ? true : undefined;
  return overlay ? true : undefined;
}

function maskRendererCell(
  cell: RendererCell,
  maskChar: string,
  hiddenStyle: RendererCellStyle | undefined,
): RendererCell {
  const style = normalizeRendererCellVfxStyle(hiddenStyle);
  if (cell.continuation === true || cell.width === 0) {
    return style === undefined
      ? { char: '', width: 0, continuation: true }
      : { char: '', width: 0, continuation: true, style };
  }

  const width = rendererCellDisplayWidth(cell);
  const char = width === 1 ? maskChar : ' ';
  const masked: RendererCell = width === 1
    ? { char }
    : { char, width };
  return style === undefined ? masked : { ...masked, style };
}

function rendererCellVisualOrdinals(cells: readonly RendererCell[]): readonly (number | undefined)[] {
  const ordinals: (number | undefined)[] = [];
  let ordinal = -1;
  let lastOrdinal: number | undefined;
  for (const cell of cells) {
    if (cell.continuation === true || cell.width === 0) {
      ordinals.push(lastOrdinal);
      continue;
    }
    ordinal++;
    lastOrdinal = ordinal;
    ordinals.push(ordinal);
  }
  return ordinals;
}

function rendererVisualCellCount(ordinals: readonly (number | undefined)[]): number {
  let count = 0;
  for (const ordinal of ordinals) {
    if (ordinal !== undefined) count = Math.max(count, ordinal + 1);
  }
  return count;
}

function rendererCellDisplayWidth(cell: RendererCell): number {
  if (cell.continuation === true || cell.width === 0) return 0;
  const width = cell.width ?? displayClusterWidth(cell.char);
  if (!Number.isFinite(width) || width <= 0) return 1;
  return Math.max(1, Math.min(2, Math.floor(width)));
}

function normalizeMaskChar(value: string | undefined): string {
  const cluster = value === undefined ? undefined : splitDisplayClusters(value)[0];
  if (cluster === undefined || cluster.width !== 1) return ' ';
  return cluster.text;
}

function normalizeRendererCellVfxStyle(
  style: RendererCellStyle | undefined,
): RendererCellStyle | undefined {
  if (style === undefined) return undefined;
  const normalized: RendererCellStyle = {
    fg: style.fg,
    bg: style.bg,
    bold: style.bold === true ? true : undefined,
    dim: style.dim === true ? true : undefined,
    italic: style.italic === true ? true : undefined,
    underline: style.underline === true ? true : undefined,
    inverse: style.inverse === true ? true : undefined,
  };
  return Object.values(normalized).some((value) => value !== undefined) ? normalized : undefined;
}

function normalizeShimmerWidth(value: number | undefined): number {
  if (value === undefined || !Number.isFinite(value) || value <= 0) return 2;
  return Math.max(1, Math.floor(value));
}

function normalizeIntervalMs(value: number | undefined): number {
  if (value === undefined) return 1000;
  if (!Number.isFinite(value) || value <= 0) return 0;
  return Math.floor(value);
}

function normalizeTimeMs(value: number | undefined): number {
  if (value === undefined || !Number.isFinite(value) || value <= 0) return 0;
  return value;
}

function positiveModulo(value: number, modulo: number): number {
  if (!Number.isFinite(value) || !Number.isFinite(modulo) || modulo <= 0) return 0;
  return ((value % modulo) + modulo) % modulo;
}

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(1, Math.max(0, value));
}
