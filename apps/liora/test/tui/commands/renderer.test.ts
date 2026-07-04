import { describe, expect, it, vi, afterEach } from 'vitest';

import { setExperimentalFeatures } from '#/tui/commands/experimental-flags';
import { dispatchInput, type SlashCommandHost } from '#/tui/commands/dispatch';
import {
  formatRendererDiagnosticsStatusReport,
  formatRendererTraceStatusReport,
  handleRendererCommand,
} from '#/tui/commands/renderer';
import type { RendererDiagnosticsSnapshot, RendererTraceSnapshot } from '#/tui/renderer';

function makeHost() {
  const host = {
    state: {
      appState: {
        streamingPhase: 'idle',
        isCompacting: false,
      },
    },
    skillCommandMap: new Map<string, string>(),
    pluginCommandMap: new Map<string, string>(),
    sendNormalUserInput: vi.fn(),
    setNativeRendererDiagnosticsOverlay: vi.fn(),
    setNativeRendererTrace: vi.fn(),
    showError: vi.fn(),
    track: vi.fn(),
  };
  return host as unknown as SlashCommandHost & typeof host;
}

describe('handleRendererCommand', () => {
  afterEach(() => {
    setExperimentalFeatures([]);
  });

  it('parses diagnostics HUD actions', () => {
    const host = makeHost();

    handleRendererCommand(host, '');
    handleRendererCommand(host, 'diagnostics');
    handleRendererCommand(host, 'diagnostics on');
    handleRendererCommand(host, 'diagnostics off');
    handleRendererCommand(host, 'diagnostics status');
    handleRendererCommand(host, 'diagnostics reset');

    expect(host.setNativeRendererDiagnosticsOverlay.mock.calls.map((call) => call[0])).toEqual([
      'status',
      'toggle',
      'on',
      'off',
      'status',
      'reset',
    ]);
    expect(host.setNativeRendererTrace).not.toHaveBeenCalled();
    expect(host.showError).not.toHaveBeenCalled();
  });

  it('parses renderer trace actions', () => {
    const host = makeHost();

    handleRendererCommand(host, 'trace');
    handleRendererCommand(host, 'trace status');
    handleRendererCommand(host, 'trace reset');
    handleRendererCommand(host, 'trace export');
    handleRendererCommand(host, 'trace export ./trace.json');

    expect(host.setNativeRendererTrace.mock.calls.map((call) => call[0])).toEqual([
      { action: 'status' },
      { action: 'status' },
      { action: 'reset' },
      { action: 'export', path: undefined },
      { action: 'export', path: './trace.json' },
    ]);
    expect(host.setNativeRendererDiagnosticsOverlay).not.toHaveBeenCalled();
    expect(host.showError).not.toHaveBeenCalled();
  });

  it('reports invalid renderer subcommands', () => {
    const host = makeHost();

    handleRendererCommand(host, 'fps on');

    expect(host.setNativeRendererDiagnosticsOverlay).not.toHaveBeenCalled();
    expect(host.setNativeRendererTrace).not.toHaveBeenCalled();
    expect(host.showError).toHaveBeenCalledWith(
      'Usage: /renderer diagnostics [on|off|toggle|status|reset] | /renderer trace [status|reset|export [path]]',
    );
  });

  it('dispatches the experimental renderer command when the native renderer flag is enabled', () => {
    const host = makeHost();
    setExperimentalFeatures([{ id: 'native_renderer', enabled: true }]);

    dispatchInput(host, '/renderer diagnostics on');
    dispatchInput(host, '/renderer trace status');

    expect(host.setNativeRendererDiagnosticsOverlay).toHaveBeenCalledWith('on');
    expect(host.setNativeRendererTrace).toHaveBeenCalledWith({ action: 'status' });
    expect(host.sendNormalUserInput).not.toHaveBeenCalled();
  });

  it('formats status when the native renderer is not enabled', () => {
    const report = formatRendererDiagnosticsStatusReport({
      hudEnabled: false,
      nativeRendererEnabled: false,
    });

    expect(report.color).toBe('warning');
    expect(report.message).toContain('Native renderer diagnostics HUD: OFF.');
    expect(report.message).toContain('Native renderer is not active.');
  });

  it('formats status when the native renderer has not produced a frame yet', () => {
    const report = formatRendererDiagnosticsStatusReport({
      hudEnabled: true,
      nativeRendererEnabled: true,
    });

    expect(report.color).toBe('warning');
    expect(report.message).toContain('Native renderer diagnostics HUD: ON.');
    expect(report.message).toContain('No native renderer frame has been recorded yet.');
  });

  it('formats status with renderer diagnostics lines and severity color', () => {
    const report = formatRendererDiagnosticsStatusReport({
      hudEnabled: true,
      nativeRendererEnabled: true,
      diagnostics: degradedDiagnostics(),
    });

    expect(report.color).toBe('error');
    expect(report.message).toContain('renderer degraded');
    expect(report.message).toContain('quality balanced');
    expect(report.message).toContain('output full');
    expect(report.message).toContain('sync on');
    expect(report.message).toContain('erase-line on');
    expect(report.message).toContain('degraded: frame-budget 120% >= 90%');
  });

  it('formats trace status with bounded buffer state', () => {
    const report = formatRendererTraceStatusReport({
      nativeRendererEnabled: true,
      trace: rendererTraceSnapshot(),
    });

    expect(report.color).toBe('warning');
    expect(report.message).toContain('Native renderer trace: ON.');
    expect(report.message).toContain('2/4 events buffered; 5 total; 3 dropped.');
    expect(report.message).toContain('1 frame events recorded.');
    expect(report.message).toContain('Trace window: 12ms.');
  });
});

function degradedDiagnostics(): RendererDiagnosticsSnapshot {
  return {
    severity: 'degraded',
    health: 'degraded',
    frames: 2,
    windowFrames: 2,
    quality: {
      level: 'balanced',
      consecutiveOverBudgetFrames: 1,
      consecutiveOutputPressureFrames: 0,
      consecutiveUnderBudgetFrames: 0,
      changes: 1,
      lastChangeReason: 'over-budget',
    },
    avgDurationMs: 12,
    p95DurationMs: 16,
    p99DurationMs: 16,
    maxDurationMs: 16,
    avgRenderCallbackDurationMs: 10,
    maxRenderCallbackDurationMs: 12,
    avgPresentDurationMs: 2,
    maxPresentDurationMs: 3,
    avgDiffDurationMs: 0.5,
    maxDiffDurationMs: 1,
    avgEncodeDurationMs: 1,
    maxEncodeDurationMs: 1.5,
    avgWriteDurationMs: 0.5,
    maxWriteDurationMs: 1,
    avgQualityDurationMs: 0,
    maxQualityDurationMs: 0,
    dominantPhase: 'render',
    dominantPhaseDurationMs: 10,
    dominantPhaseRatio: 10 / 12,
    avgFrameIntervalMs: 16,
    avgFps: 62.5,
    overBudgetRatio: 0.5,
    avgFrameBudgetRatio: 1.2,
    avgScanRatio: 0.12,
    maxScanRatio: 0.2,
    avgDamageRatio: 1,
    maxDamageRatio: 1,
    dominantScanStrategy: 'dirty-rows',
    avgOutputBytes: 4096,
    outputBackpressureFrames: 0,
    outputBackpressureRatio: 0,
    avgOutputCells: 16,
    avgOutputRuns: 4,
    avgOutputBridgedCells: 2,
    avgOutputBridgedCellRatio: 0.125,
    avgCursorAbsoluteMoves: 1,
    avgCursorRelativeMoves: 2,
    avgCursorHorizontalAbsoluteMoves: 0,
    avgCursorMoveBytes: 12,
    avgCursorMoveSavedBytes: 6,
    avgChangedCellRatio: 0.1,
    avgCompositionReuseRatio: 0.5,
    avgLineCacheHitRatio: 0.75,
    lastOutputMode: 'full',
    lastOutputSynchronized: true,
    lastOutputLargeFrame: true,
    lastOutputPolicyReason: 'full-frame',
    lastOutputEraseLine: true,
    frameTimeSparkline: '▆█',
    issues: [
      {
        code: 'frame-budget',
        severity: 'degraded',
        message: 'Renderer frame budget is under pressure.',
        value: 1.2,
        threshold: 0.9,
      },
    ],
  };
}

function rendererTraceSnapshot(): RendererTraceSnapshot {
  return {
    enabled: true,
    maxEvents: 4,
    eventCount: 2,
    totalEvents: 5,
    droppedEvents: 3,
    startedAtMs: 0,
    endedAtMs: 12,
    events: [
      {
        sequence: 3,
        kind: 'input',
        timestampMs: 8,
        input: { type: 'key', key: 'character', ctrl: false, alt: false, shift: false },
      },
      {
        sequence: 4,
        kind: 'frame',
        timestampMs: 12,
        frameIndex: 1,
        causes: ['manual'],
        size: { columns: 80, rows: 24 },
        health: 'healthy',
        qualityLevel: 'full',
        metrics: {
          startedAt: 12,
          endedAt: 12,
          durationMs: 0,
          targetFrameMs: 16,
          overBudget: false,
          renderCallbackDurationMs: 0,
          presentDurationMs: 0,
          diffDurationMs: 0,
          encodeDurationMs: 0,
          writeDurationMs: 0,
          qualityDurationMs: 0,
          outputBytes: 0,
          outputBackpressure: false,
          outputCells: 0,
          outputRuns: 0,
          outputBridgedCells: 0,
          outputBridgedCellRatio: 0,
          cursorAbsoluteMoves: 0,
          cursorRelativeMoves: 0,
          cursorHorizontalAbsoluteMoves: 0,
          cursorMoveBytes: 0,
          cursorMoveAbsoluteBytes: 0,
          cursorMoveSavedBytes: 0,
          outputMode: 'empty',
          outputSynchronized: false,
          outputLargeFrame: false,
          outputPolicyReason: 'empty',
          outputEraseLine: false,
          changedCells: 0,
          scannedCells: 0,
          scannedRows: 0,
          dirtyRows: 0,
          totalCells: 80 * 24,
          scanStrategy: 'none',
          scanRatio: 0,
          damageCells: 0,
          damageRatio: 0,
          compositionRowsVisited: 0,
          compositionRowsComposed: 0,
          compositionRowsReused: 0,
          compositionReuseRatio: 0,
          lineCacheHits: 0,
          lineCacheMisses: 0,
          lineCacheHitRatio: 0,
          lineCacheEvictions: 0,
        },
      },
    ],
  };
}
