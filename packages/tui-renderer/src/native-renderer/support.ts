import type { NativeFramePresentResult } from '../native/frame';
import type { NativeInputEvent } from '../input-events/index';
import type { NativeRenderCause } from '../render-loop';
import type { NativeTerminalSize } from '../terminal/session';
import { RendererLineCellCache, type RendererLineCellCacheOptions } from '../line-cache';
import { RendererCompositionCache, type RendererCompositionStats } from '../compositor';
import type { RendererQualityControllerOptions } from '../quality';
import { RendererQualityController } from '../quality';
import type { RendererTraceInputData, RendererTraceRecorderOptions } from '../trace';
import { RendererTraceRecorder } from '../trace';
import type { NativeTerminalRendererFrameMetrics } from './types';

export function createLineCache(
  option: boolean | RendererLineCellCache | RendererLineCellCacheOptions | undefined,
): RendererLineCellCache | undefined {
  if (option instanceof RendererLineCellCache) return option;
  if (option === false) return undefined;
  if (option === true || option === undefined) return new RendererLineCellCache();
  return new RendererLineCellCache(option);
}

export function createCompositionCache(
  option: boolean | RendererCompositionCache | undefined,
): RendererCompositionCache | undefined {
  if (option instanceof RendererCompositionCache) return option;
  return option === false ? undefined : new RendererCompositionCache();
}

export function createQualityController(
  option: boolean | RendererQualityController | RendererQualityControllerOptions | undefined,
): RendererQualityController {
  if (option instanceof RendererQualityController) return option;
  if (option === true || option === false || option === undefined) return new RendererQualityController();
  return new RendererQualityController(option);
}

export function createTraceRecorder(
  option: boolean | RendererTraceRecorder | RendererTraceRecorderOptions | undefined,
): RendererTraceRecorder {
  if (option instanceof RendererTraceRecorder) return option;
  if (option === false) return new RendererTraceRecorder({ enabled: false });
  if (option === true || option === undefined) return new RendererTraceRecorder();
  return new RendererTraceRecorder(option);
}

export function isAutoFrameHoldCause(cause: NativeRenderCause): boolean {
  return cause === 'request' || cause === 'animation' || cause === 'quality';
  // 'input' is intentionally excluded: editor keystrokes must repaint even while
  // transcript auto-frame hold is active (for example after scrolling up).
}

export function nativeInputTraceData(event: NativeInputEvent): RendererTraceInputData {
  switch (event.type) {
    case 'key':
      return {
        type: 'key',
        key: event.key,
        ctrl: event.ctrl,
        alt: event.alt,
        shift: event.shift,
      };
    case 'mouse':
      return {
        type: 'mouse',
        button: event.button,
        action: event.action,
        x: event.x,
        y: event.y,
        ctrl: event.ctrl,
        alt: event.alt,
        shift: event.shift,
      };
    case 'focus':
      return {
        type: 'focus',
        action: event.focused ? 'in' : 'out',
      };
    case 'paste':
      return {
        type: 'paste',
      };
    case 'terminal-mode-report':
      return {
        type: 'terminal-mode-report',
      };
    case 'unknown':
      return {
        type: 'unknown',
      };
  }
}

export function createFrameMetrics(
  startedAt: number,
  endedAt: number,
  targetFrameMs: number,
  present: NativeFramePresentResult | undefined,
  size: NativeTerminalSize,
  phases: {
    readonly renderCallbackDurationMs: number;
  },
): NativeTerminalRendererFrameMetrics {
  const durationMs = Math.max(0, endedAt - startedAt);
  const composition = compositionStatsFromPresent(present);
  const diff = present?.diff;
  const timing = present?.timing;
  const lineCacheFrame = composition?.lineCacheFrame;
  return {
    startedAt,
    endedAt,
    durationMs,
    targetFrameMs,
    overBudget: durationMs > targetFrameMs || present?.backpressure === true,
    renderCallbackDurationMs: phases.renderCallbackDurationMs,
    presentDurationMs: timing?.totalDurationMs ?? 0,
    diffDurationMs: timing?.diffDurationMs ?? 0,
    encodeDurationMs: timing?.encodeDurationMs ?? 0,
    writeDurationMs: timing?.writeDurationMs ?? 0,
    qualityDurationMs: 0,
    outputBytes: present?.bytes ?? 0,
    outputBackpressure: present?.backpressure ?? false,
    outputCells: diff?.outputCells ?? diff?.changedCells ?? 0,
    outputRuns: diff?.renderRuns ?? 0,
    outputBridgedCells: diff?.bridgedCells ?? 0,
    outputBridgedCellRatio: ratio(diff?.bridgedCells ?? 0, diff?.outputCells ?? 0),
    cursorAbsoluteMoves: present?.cursorMotion.absoluteMoves ?? 0,
    cursorRelativeMoves: present?.cursorMotion.relativeMoves ?? 0,
    cursorHorizontalAbsoluteMoves: present?.cursorMotion.horizontalAbsoluteMoves ?? 0,
    cursorMoveBytes: present?.cursorMotion.moveBytes ?? 0,
    cursorMoveAbsoluteBytes: present?.cursorMotion.absoluteMoveBytes ?? 0,
    cursorMoveSavedBytes: present?.cursorMotion.savedBytes ?? 0,
    outputMode: present?.outputPolicy.mode ?? 'empty',
    outputSynchronized: present?.outputPolicy.synchronized ?? false,
    outputLargeFrame: present?.outputPolicy.largeFrame ?? false,
    outputPolicyReason: present?.outputPolicy.reason ?? 'empty',
    outputEraseLine: present?.outputPolicy.eraseLine ?? false,
    changedCells: present?.diff.changedCells ?? 0,
    scannedCells: present?.diff.scannedCells ?? 0,
    scannedRows: present?.diff.scannedRows ?? 0,
    dirtyRows: present?.diff.dirtyRows ?? 0,
    totalCells: present?.diff.totalCells ?? size.columns * size.rows,
    scanStrategy: diff?.scanStrategy ?? 'none',
    scanRatio: diff?.scanRatio ?? 0,
    damageCells: diff?.damageCells ?? 0,
    damageRatio: diff?.damageRatio ?? 0,
    compositionRowsVisited: composition?.rowsVisited ?? 0,
    compositionRowsComposed: composition?.rowsComposed ?? 0,
    compositionRowsReused: composition?.rowsReused ?? 0,
    compositionReuseRatio: ratio(
      composition?.rowsReused ?? 0,
      (composition?.rowsComposed ?? 0) + (composition?.rowsReused ?? 0),
    ),
    lineCacheHits: lineCacheFrame?.hits ?? 0,
    lineCacheMisses: lineCacheFrame?.misses ?? 0,
    lineCacheHitRatio: lineCacheFrame?.hitRatio ?? 0,
    lineCacheEvictions: lineCacheFrame?.evictions ?? 0,
  };
}

function compositionStatsFromPresent(
  present: NativeFramePresentResult | undefined,
): RendererCompositionStats | undefined {
  if (present === undefined) return undefined;
  if (!('composition' in present)) return undefined;
  const composition = present.composition;
  if (typeof composition !== 'object' || composition === null) return undefined;
  return composition as RendererCompositionStats;
}

function ratio(value: number, total: number): number {
  return total <= 0 ? 0 : value / total;
}

export function frameDuration(startedAt: number, endedAt: number): number {
  return Math.max(0, endedAt - startedAt);
}
