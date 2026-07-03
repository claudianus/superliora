import type { RendererCell, RendererCellStyle } from './cell-buffer';
import { mixHexColor } from './animation';
import {
  type RendererColorMode,
} from './terminal-output';
import {
  createRendererStyledTextCells,
  renderRendererStyledTextRunsAnsi,
  type RendererStyledTextRun,
} from './styled-text';
import { splitDisplayClusters } from './text-metrics';

export interface RendererSeededIndexOptions {
  readonly seed?: string;
  readonly nowMs: number;
  readonly intervalMs: number;
  readonly length: number;
  readonly offset?: number;
}

export type RendererGradientTextRun = RendererStyledTextRun & {
  readonly style: RendererCellStyle;
};

export interface RendererGradientTextRunOptions {
  readonly from: string;
  readonly to: string;
  readonly accentBias?: number;
  readonly offset?: number;
  readonly bold?: boolean;
}

export interface RendererGradientTextAnsiOptions extends RendererGradientTextRunOptions {
  readonly colorMode?: RendererColorMode;
  readonly resetStyle?: boolean;
}

export function hashRendererEffectSeed(seed: string): number {
  let hash = 2166136261;
  for (let i = 0; i < seed.length; i++) {
    const codePoint = seed.codePointAt(i) ?? 0;
    hash ^= codePoint;
    hash = Math.imul(hash, 16777619);
    if (codePoint > 0xffff) i++;
  }
  return Math.abs(Math.trunc(hash));
}

export function rendererPositiveModulo(value: number, modulo: number): number {
  if (!Number.isFinite(modulo) || modulo <= 0) return 0;
  return ((Math.trunc(value) % Math.trunc(modulo)) + Math.trunc(modulo)) % Math.trunc(modulo);
}

export function resolveRendererSeededIndex(
  options: RendererSeededIndexOptions,
): number | undefined {
  const length = normalizeEffectLength(options.length);
  if (length === 0) return undefined;
  const tick = Number.isFinite(options.intervalMs) && options.intervalMs > 0
    ? Math.floor(normalizeEffectTime(options.nowMs) / Math.floor(options.intervalMs))
    : 0;
  return rendererPositiveModulo(
    tick + (options.seed === undefined ? 0 : hashRendererEffectSeed(options.seed)) + (options.offset ?? 0),
    length,
  );
}

export function createRendererGradientTextRuns(
  text: string,
  options: RendererGradientTextRunOptions,
): readonly RendererGradientTextRun[] {
  const clusters = splitDisplayClusters(text).map((cluster) => cluster.text);
  if (clusters.length === 0) return [];
  const rawAccentBias = options.accentBias;
  const rawOffset = options.offset;
  const accentBias = rawAccentBias !== undefined && Number.isFinite(rawAccentBias)
    ? Math.max(0, rawAccentBias)
    : 1;
  const offset = rawOffset !== undefined && Number.isFinite(rawOffset) ? Math.trunc(rawOffset) : 0;
  const bold = options.bold ?? true;
  const denominator = Math.max(1, clusters.length - 1);
  return clusters.map((cluster, index) => {
    const shiftedIndex = rendererPositiveModulo(index + offset, clusters.length);
    const ratio = clusters.length <= 1
      ? 0
      : Math.min(1, (shiftedIndex / denominator) * accentBias);
    const style: RendererCellStyle = {
      fg: mixHexColor(options.from, options.to, ratio),
      bold: bold ? true : undefined,
    };
    return { text: cluster, style };
  });
}

export function createRendererGradientTextCells(
  text: string,
  options: RendererGradientTextRunOptions,
): readonly RendererCell[] {
  return createRendererStyledTextCells(createRendererGradientTextRuns(text, options));
}

export function renderRendererGradientTextAnsi(
  text: string,
  options: RendererGradientTextAnsiOptions,
): string {
  return renderRendererStyledTextRunsAnsi(createRendererGradientTextRuns(text, options), options);
}

function normalizeEffectLength(value: number): number {
  if (!Number.isFinite(value) || value <= 0) return 0;
  return Math.floor(value);
}

function normalizeEffectTime(value: number): number {
  if (!Number.isFinite(value) || value <= 0) return 0;
  return Math.floor(value);
}
