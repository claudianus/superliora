import type { NativeTerminalRendererFrameMetrics } from './native-renderer';
import type { RendererDamageScanStrategy } from './damage';

export interface NativeFrameStatsScanStrategyCounts {
  readonly none: number;
  readonly dirtyRows: number;
  readonly damageRect: number;
  readonly fullFrame: number;
}

export interface NativeFrameStatsSnapshot {
  readonly frames: number;
  readonly windowFrames: number;
  readonly windowSize: number;
  readonly health: NativeFrameStatsHealth;
  readonly avgFrameBudgetRatio: number;
  readonly maxFrameBudgetRatio: number;
  readonly avgChangedCellRatio: number;
  readonly avgScannedCellRatio: number;
  readonly avgScanRatio: number;
  readonly maxScanRatio: number;
  readonly avgDamageRatio: number;
  readonly maxDamageRatio: number;
  readonly dominantScanStrategy: RendererDamageScanStrategy;
  readonly scanStrategyCounts: NativeFrameStatsScanStrategyCounts;
  readonly avgDirtyRowRatio: number;
  readonly avgCompositionReuseRatio: number;
  readonly avgLineCacheHitRatio: number;
  readonly overBudgetFrames: number;
  readonly overBudgetRatio: number;
  readonly avgDurationMs: number;
  readonly p95DurationMs: number;
  readonly p99DurationMs: number;
  readonly maxDurationMs: number;
  readonly avgRenderCallbackDurationMs: number;
  readonly maxRenderCallbackDurationMs: number;
  readonly avgPresentDurationMs: number;
  readonly maxPresentDurationMs: number;
  readonly avgDiffDurationMs: number;
  readonly maxDiffDurationMs: number;
  readonly avgEncodeDurationMs: number;
  readonly maxEncodeDurationMs: number;
  readonly avgWriteDurationMs: number;
  readonly maxWriteDurationMs: number;
  readonly avgQualityDurationMs: number;
  readonly maxQualityDurationMs: number;
  readonly avgFrameIntervalMs: number;
  readonly avgFps: number;
  readonly avgOutputBytes: number;
  readonly totalOutputBytes: number;
  readonly outputBackpressureFrames: number;
  readonly outputBackpressureRatio: number;
  readonly avgOutputCells: number;
  readonly totalOutputCells: number;
  readonly avgOutputRuns: number;
  readonly totalOutputRuns: number;
  readonly avgOutputBridgedCells: number;
  readonly totalOutputBridgedCells: number;
  readonly avgOutputBridgedCellRatio: number;
  readonly avgCursorAbsoluteMoves: number;
  readonly totalCursorAbsoluteMoves: number;
  readonly avgCursorRelativeMoves: number;
  readonly totalCursorRelativeMoves: number;
  readonly avgCursorHorizontalAbsoluteMoves: number;
  readonly totalCursorHorizontalAbsoluteMoves: number;
  readonly avgCursorMoveBytes: number;
  readonly totalCursorMoveBytes: number;
  readonly avgCursorMoveSavedBytes: number;
  readonly totalCursorMoveSavedBytes: number;
  readonly avgChangedCells: number;
  readonly totalChangedCells: number;
  readonly avgScannedCells: number;
  readonly totalScannedCells: number;
  readonly avgScannedRows: number;
  readonly totalScannedRows: number;
  readonly avgDirtyRows: number;
  readonly totalDirtyRows: number;
  readonly totalCompositionRowsComposed: number;
  readonly totalCompositionRowsReused: number;
  readonly totalLineCacheHits: number;
  readonly totalLineCacheMisses: number;
  readonly totalLineCacheEvictions: number;
  readonly frameDurationSamplesMs: readonly number[];
  readonly frameBudgetRatioSamples: readonly number[];
  readonly last: NativeTerminalRendererFrameMetrics | undefined;
}

export type NativeFrameStatsHealth = 'idle' | 'healthy' | 'watch' | 'degraded';

export interface NativeFrameStatsBudget {
  readonly health: NativeFrameStatsHealth;
  readonly avgFrameBudgetRatio: number;
  readonly maxFrameBudgetRatio: number;
  readonly avgChangedCellRatio: number;
  readonly avgScannedCellRatio: number;
  readonly avgDirtyRowRatio: number;
}

export class NativeFrameStats {
  private readonly windowSize: number;
  private readonly recent: NativeTerminalRendererFrameMetrics[] = [];
  private frames = 0;
  private totalOutputBytes = 0;
  private outputBackpressureFrames = 0;
  private totalOutputCells = 0;
  private totalOutputRuns = 0;
  private totalOutputBridgedCells = 0;
  private totalCursorAbsoluteMoves = 0;
  private totalCursorRelativeMoves = 0;
  private totalCursorHorizontalAbsoluteMoves = 0;
  private totalCursorMoveBytes = 0;
  private totalCursorMoveSavedBytes = 0;
  private totalChangedCells = 0;
  private totalScannedCells = 0;
  private totalScannedRows = 0;
  private totalDirtyRows = 0;
  private totalCompositionRowsComposed = 0;
  private totalCompositionRowsReused = 0;
  private totalLineCacheHits = 0;
  private totalLineCacheMisses = 0;
  private totalLineCacheEvictions = 0;
  private overBudgetFrames = 0;
  private lastMetrics: NativeTerminalRendererFrameMetrics | undefined;

  constructor(options: { readonly windowSize?: number } = {}) {
    this.windowSize = normalizeWindowSize(options.windowSize);
  }

  record(metrics: NativeTerminalRendererFrameMetrics): NativeFrameStatsSnapshot {
    this.frames++;
    this.totalOutputBytes += metrics.outputBytes;
    if (metrics.outputBackpressure) this.outputBackpressureFrames++;
    this.totalOutputCells += metrics.outputCells;
    this.totalOutputRuns += metrics.outputRuns;
    this.totalOutputBridgedCells += metrics.outputBridgedCells;
    this.totalCursorAbsoluteMoves += metrics.cursorAbsoluteMoves;
    this.totalCursorRelativeMoves += metrics.cursorRelativeMoves;
    this.totalCursorHorizontalAbsoluteMoves += metrics.cursorHorizontalAbsoluteMoves;
    this.totalCursorMoveBytes += metrics.cursorMoveBytes;
    this.totalCursorMoveSavedBytes += metrics.cursorMoveSavedBytes;
    this.totalChangedCells += metrics.changedCells;
    this.totalScannedCells += metrics.scannedCells;
    this.totalScannedRows += metrics.scannedRows;
    this.totalDirtyRows += metrics.dirtyRows;
    this.totalCompositionRowsComposed += metrics.compositionRowsComposed;
    this.totalCompositionRowsReused += metrics.compositionRowsReused;
    this.totalLineCacheHits += metrics.lineCacheHits;
    this.totalLineCacheMisses += metrics.lineCacheMisses;
    this.totalLineCacheEvictions += metrics.lineCacheEvictions;
    if (metrics.overBudget) this.overBudgetFrames++;
    this.lastMetrics = metrics;
    this.recent.push(metrics);
    if (this.recent.length > this.windowSize) this.recent.shift();
    return this.snapshot();
  }

  reset(): void {
    this.recent.length = 0;
    this.frames = 0;
    this.totalOutputBytes = 0;
    this.outputBackpressureFrames = 0;
    this.totalOutputCells = 0;
    this.totalOutputRuns = 0;
    this.totalOutputBridgedCells = 0;
    this.totalCursorAbsoluteMoves = 0;
    this.totalCursorRelativeMoves = 0;
    this.totalCursorHorizontalAbsoluteMoves = 0;
    this.totalCursorMoveBytes = 0;
    this.totalCursorMoveSavedBytes = 0;
    this.totalChangedCells = 0;
    this.totalScannedCells = 0;
    this.totalScannedRows = 0;
    this.totalDirtyRows = 0;
    this.totalCompositionRowsComposed = 0;
    this.totalCompositionRowsReused = 0;
    this.totalLineCacheHits = 0;
    this.totalLineCacheMisses = 0;
    this.totalLineCacheEvictions = 0;
    this.overBudgetFrames = 0;
    this.lastMetrics = undefined;
  }

  snapshot(): NativeFrameStatsSnapshot {
    const windowFrames = this.recent.length;
    const windowDuration = sumBy(this.recent, (metrics) => metrics.durationMs);
    const windowRenderCallbackDuration = sumBy(
      this.recent,
      (metrics) => metrics.renderCallbackDurationMs,
    );
    const windowPresentDuration = sumBy(this.recent, (metrics) => metrics.presentDurationMs);
    const windowDiffDuration = sumBy(this.recent, (metrics) => metrics.diffDurationMs);
    const windowEncodeDuration = sumBy(this.recent, (metrics) => metrics.encodeDurationMs);
    const windowWriteDuration = sumBy(this.recent, (metrics) => metrics.writeDurationMs);
    const windowQualityDuration = sumBy(this.recent, (metrics) => metrics.qualityDurationMs);
    const windowOutputBytes = sumBy(this.recent, (metrics) => metrics.outputBytes);
    const windowOutputBackpressureFrames = this.recent.filter((metrics) =>
      metrics.outputBackpressure
    ).length;
    const windowOutputCells = sumBy(this.recent, (metrics) => metrics.outputCells);
    const windowOutputRuns = sumBy(this.recent, (metrics) => metrics.outputRuns);
    const windowOutputBridgedCells = sumBy(
      this.recent,
      (metrics) => metrics.outputBridgedCells,
    );
    const windowCursorAbsoluteMoves = sumBy(this.recent, (metrics) => metrics.cursorAbsoluteMoves);
    const windowCursorRelativeMoves = sumBy(this.recent, (metrics) => metrics.cursorRelativeMoves);
    const windowCursorHorizontalAbsoluteMoves = sumBy(
      this.recent,
      (metrics) => metrics.cursorHorizontalAbsoluteMoves,
    );
    const windowCursorMoveBytes = sumBy(this.recent, (metrics) => metrics.cursorMoveBytes);
    const windowCursorMoveSavedBytes = sumBy(
      this.recent,
      (metrics) => metrics.cursorMoveSavedBytes,
    );
    const windowChangedCells = sumBy(this.recent, (metrics) => metrics.changedCells);
    const windowScannedCells = sumBy(this.recent, (metrics) => metrics.scannedCells);
    const windowScanRatio = sumBy(this.recent, (metrics) => metrics.scanRatio);
    const windowDamageRatio = sumBy(this.recent, (metrics) => metrics.damageRatio);
    const windowScannedRows = sumBy(this.recent, (metrics) => metrics.scannedRows);
    const windowDirtyRows = sumBy(this.recent, (metrics) => metrics.dirtyRows);
    const windowCompositionRowsComposed = sumBy(
      this.recent,
      (metrics) => metrics.compositionRowsComposed,
    );
    const windowCompositionRowsReused = sumBy(
      this.recent,
      (metrics) => metrics.compositionRowsReused,
    );
    const windowLineCacheHits = sumBy(this.recent, (metrics) => metrics.lineCacheHits);
    const windowLineCacheMisses = sumBy(this.recent, (metrics) => metrics.lineCacheMisses);
    const frameDurationSamplesMs = this.recent.map((metrics) => metrics.durationMs);
    const sortedFrameDurationSamplesMs = frameDurationSamplesMs.toSorted((a, b) => a - b);
    const frameBudgetRatioSamples = this.recent.map(frameBudgetRatio);
    const frameCadence = summarizeFrameCadence(this.recent);
    const scanStrategies = summarizeScanStrategies(this.recent);
    const budget = summarizeNativeFrameStatsBudget(this.recent);
    return {
      frames: this.frames,
      windowFrames,
      windowSize: this.windowSize,
      health: budget.health,
      avgFrameBudgetRatio: budget.avgFrameBudgetRatio,
      maxFrameBudgetRatio: budget.maxFrameBudgetRatio,
      avgChangedCellRatio: budget.avgChangedCellRatio,
      avgScannedCellRatio: budget.avgScannedCellRatio,
      avgScanRatio: average(windowScanRatio, windowFrames),
      maxScanRatio: this.recent.reduce(
        (max, metrics) => Math.max(max, metrics.scanRatio),
        0,
      ),
      avgDamageRatio: average(windowDamageRatio, windowFrames),
      maxDamageRatio: this.recent.reduce(
        (max, metrics) => Math.max(max, metrics.damageRatio),
        0,
      ),
      dominantScanStrategy: scanStrategies.dominant,
      scanStrategyCounts: scanStrategies.counts,
      avgDirtyRowRatio: budget.avgDirtyRowRatio,
      avgCompositionReuseRatio: average(
        windowCompositionRowsReused,
        windowCompositionRowsComposed + windowCompositionRowsReused,
      ),
      avgLineCacheHitRatio: average(
        windowLineCacheHits,
        windowLineCacheHits + windowLineCacheMisses,
      ),
      overBudgetFrames: this.overBudgetFrames,
      overBudgetRatio: this.frames === 0 ? 0 : this.overBudgetFrames / this.frames,
      avgDurationMs: average(windowDuration, windowFrames),
      p95DurationMs: percentile(sortedFrameDurationSamplesMs, 0.95),
      p99DurationMs: percentile(sortedFrameDurationSamplesMs, 0.99),
      maxDurationMs: this.recent.reduce(
        (max, metrics) => Math.max(max, metrics.durationMs),
        0,
      ),
      avgRenderCallbackDurationMs: average(windowRenderCallbackDuration, windowFrames),
      maxRenderCallbackDurationMs: maxBy(this.recent, (metrics) => metrics.renderCallbackDurationMs),
      avgPresentDurationMs: average(windowPresentDuration, windowFrames),
      maxPresentDurationMs: maxBy(this.recent, (metrics) => metrics.presentDurationMs),
      avgDiffDurationMs: average(windowDiffDuration, windowFrames),
      maxDiffDurationMs: maxBy(this.recent, (metrics) => metrics.diffDurationMs),
      avgEncodeDurationMs: average(windowEncodeDuration, windowFrames),
      maxEncodeDurationMs: maxBy(this.recent, (metrics) => metrics.encodeDurationMs),
      avgWriteDurationMs: average(windowWriteDuration, windowFrames),
      maxWriteDurationMs: maxBy(this.recent, (metrics) => metrics.writeDurationMs),
      avgQualityDurationMs: average(windowQualityDuration, windowFrames),
      maxQualityDurationMs: maxBy(this.recent, (metrics) => metrics.qualityDurationMs),
      avgFrameIntervalMs: frameCadence.avgFrameIntervalMs,
      avgFps: frameCadence.avgFps,
      avgOutputBytes: average(windowOutputBytes, windowFrames),
      totalOutputBytes: this.totalOutputBytes,
      outputBackpressureFrames: this.outputBackpressureFrames,
      outputBackpressureRatio: average(windowOutputBackpressureFrames, windowFrames),
      avgOutputCells: average(windowOutputCells, windowFrames),
      totalOutputCells: this.totalOutputCells,
      avgOutputRuns: average(windowOutputRuns, windowFrames),
      totalOutputRuns: this.totalOutputRuns,
      avgOutputBridgedCells: average(windowOutputBridgedCells, windowFrames),
      totalOutputBridgedCells: this.totalOutputBridgedCells,
      avgOutputBridgedCellRatio: average(windowOutputBridgedCells, windowOutputCells),
      avgCursorAbsoluteMoves: average(windowCursorAbsoluteMoves, windowFrames),
      totalCursorAbsoluteMoves: this.totalCursorAbsoluteMoves,
      avgCursorRelativeMoves: average(windowCursorRelativeMoves, windowFrames),
      totalCursorRelativeMoves: this.totalCursorRelativeMoves,
      avgCursorHorizontalAbsoluteMoves: average(windowCursorHorizontalAbsoluteMoves, windowFrames),
      totalCursorHorizontalAbsoluteMoves: this.totalCursorHorizontalAbsoluteMoves,
      avgCursorMoveBytes: average(windowCursorMoveBytes, windowFrames),
      totalCursorMoveBytes: this.totalCursorMoveBytes,
      avgCursorMoveSavedBytes: average(windowCursorMoveSavedBytes, windowFrames),
      totalCursorMoveSavedBytes: this.totalCursorMoveSavedBytes,
      avgChangedCells: average(windowChangedCells, windowFrames),
      totalChangedCells: this.totalChangedCells,
      avgScannedCells: average(windowScannedCells, windowFrames),
      totalScannedCells: this.totalScannedCells,
      avgScannedRows: average(windowScannedRows, windowFrames),
      totalScannedRows: this.totalScannedRows,
      avgDirtyRows: average(windowDirtyRows, windowFrames),
      totalDirtyRows: this.totalDirtyRows,
      totalCompositionRowsComposed: this.totalCompositionRowsComposed,
      totalCompositionRowsReused: this.totalCompositionRowsReused,
      totalLineCacheHits: this.totalLineCacheHits,
      totalLineCacheMisses: this.totalLineCacheMisses,
      totalLineCacheEvictions: this.totalLineCacheEvictions,
      frameDurationSamplesMs,
      frameBudgetRatioSamples,
      last: this.lastMetrics,
    };
  }
}

function summarizeFrameCadence(frames: readonly NativeTerminalRendererFrameMetrics[]): {
  readonly avgFrameIntervalMs: number;
  readonly avgFps: number;
} {
  if (frames.length < 2) return { avgFrameIntervalMs: 0, avgFps: 0 };
  const intervals: number[] = [];
  for (let index = 1; index < frames.length; index++) {
    const previous = frames[index - 1];
    const current = frames[index];
    if (previous === undefined || current === undefined) continue;
    const interval = current.startedAt - previous.startedAt;
    if (Number.isFinite(interval) && interval > 0) intervals.push(interval);
  }
  const avgFrameIntervalMs = average(sum(intervals), intervals.length);
  return {
    avgFrameIntervalMs,
    avgFps: avgFrameIntervalMs <= 0 ? 0 : 1000 / avgFrameIntervalMs,
  };
}

function summarizeScanStrategies(
  frames: readonly NativeTerminalRendererFrameMetrics[],
): {
  readonly counts: NativeFrameStatsScanStrategyCounts;
  readonly dominant: RendererDamageScanStrategy;
} {
  const counts = { none: 0, dirtyRows: 0, damageRect: 0, fullFrame: 0 };
  for (const metrics of frames) {
    switch (metrics.scanStrategy) {
      case 'none':
        counts.none++;
        break;
      case 'dirty-rows':
        counts.dirtyRows++;
        break;
      case 'damage-rect':
        counts.damageRect++;
        break;
      case 'full-frame':
        counts.fullFrame++;
        break;
    }
  }
  const ordered: readonly RendererDamageScanStrategy[] = [
    'full-frame',
    'damage-rect',
    'dirty-rows',
    'none',
  ];
  let dominant: RendererDamageScanStrategy = 'none';
  let dominantCount = 0;
  for (const strategy of ordered) {
    const count = scanStrategyCount(counts, strategy);
    if (count > dominantCount) {
      dominant = strategy;
      dominantCount = count;
    }
  }
  return { counts, dominant };
}

export function summarizeNativeFrameStatsBudget(
  frames: readonly NativeTerminalRendererFrameMetrics[],
): NativeFrameStatsBudget {
  if (frames.length === 0) {
    return {
      health: 'idle',
      avgFrameBudgetRatio: 0,
      maxFrameBudgetRatio: 0,
      avgChangedCellRatio: 0,
      avgScannedCellRatio: 0,
      avgDirtyRowRatio: 0,
    };
  }

  const frameBudgetRatios = frames.map(frameBudgetRatio);
  const avgFrameBudgetRatio = average(sum(frameBudgetRatios), frames.length);
  const maxFrameBudgetRatio = Math.max(...frameBudgetRatios);
  const overBudgetRatio = average(
    frames.filter((metrics) => metrics.overBudget || frameBudgetRatio(metrics) > 1).length,
    frames.length,
  );

  return {
    health: resolveFrameStatsHealth({ avgFrameBudgetRatio, maxFrameBudgetRatio, overBudgetRatio }),
    avgFrameBudgetRatio,
    maxFrameBudgetRatio,
    avgChangedCellRatio: average(sumBy(frames, changedCellRatio), frames.length),
    avgScannedCellRatio: average(sumBy(frames, scannedCellRatio), frames.length),
    avgDirtyRowRatio: average(sumBy(frames, dirtyRowRatio), frames.length),
  };
}

function normalizeWindowSize(value: number | undefined): number {
  if (value === undefined || !Number.isFinite(value)) return 120;
  return Math.max(1, Math.floor(value));
}

function sumBy<T>(items: readonly T[], value: (item: T) => number): number {
  return items.reduce((sum, item) => sum + value(item), 0);
}

function average(total: number, count: number): number {
  return count === 0 ? 0 : total / count;
}

function maxBy<T>(items: readonly T[], value: (item: T) => number): number {
  return items.reduce((max, item) => Math.max(max, value(item)), 0);
}

function sum(items: readonly number[]): number {
  return items.reduce((total, value) => total + value, 0);
}

function scanStrategyCount(
  counts: NativeFrameStatsScanStrategyCounts,
  strategy: RendererDamageScanStrategy,
): number {
  switch (strategy) {
    case 'none':
      return counts.none;
    case 'dirty-rows':
      return counts.dirtyRows;
    case 'damage-rect':
      return counts.damageRect;
    case 'full-frame':
      return counts.fullFrame;
  }
}

function percentile(sortedValues: readonly number[], quantile: number): number {
  if (sortedValues.length === 0) return 0;
  const boundedQuantile = Math.min(1, Math.max(0, quantile));
  const index = Math.ceil(sortedValues.length * boundedQuantile) - 1;
  return sortedValues[Math.max(0, Math.min(sortedValues.length - 1, index))] ?? 0;
}

function frameBudgetRatio(metrics: NativeTerminalRendererFrameMetrics): number {
  if (metrics.targetFrameMs <= 0) return 0;
  return metrics.durationMs / metrics.targetFrameMs;
}

function changedCellRatio(metrics: NativeTerminalRendererFrameMetrics): number {
  return positiveRatio(metrics.changedCells, metrics.totalCells);
}

function scannedCellRatio(metrics: NativeTerminalRendererFrameMetrics): number {
  return positiveRatio(metrics.scannedCells, metrics.totalCells);
}

function dirtyRowRatio(metrics: NativeTerminalRendererFrameMetrics): number {
  const rows =
    metrics.scannedRows > 0
      ? metrics.scannedRows
      : Math.max(1, Math.ceil(metrics.totalCells / Math.max(1, metrics.scannedCells)));
  return positiveRatio(metrics.dirtyRows, rows);
}

function positiveRatio(value: number, total: number): number {
  if (total <= 0) return 0;
  return Math.min(1, Math.max(0, value / total));
}

function resolveFrameStatsHealth(options: {
  readonly avgFrameBudgetRatio: number;
  readonly maxFrameBudgetRatio: number;
  readonly overBudgetRatio: number;
}): NativeFrameStatsHealth {
  if (
    options.overBudgetRatio >= 0.25 ||
    options.avgFrameBudgetRatio >= 0.9 ||
    options.maxFrameBudgetRatio >= 1.5
  ) {
    return 'degraded';
  }
  if (
    options.overBudgetRatio > 0 ||
    options.avgFrameBudgetRatio >= 0.65 ||
    options.maxFrameBudgetRatio >= 1
  ) {
    return 'watch';
  }
  return 'healthy';
}
