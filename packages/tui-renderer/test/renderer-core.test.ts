import { EventEmitter } from 'node:events';

import { describe, expect, it } from 'vitest';

import {
  ANSI_BEGIN_SYNCHRONIZED_UPDATE,
  ANSI_END_SYNCHRONIZED_UPDATE,
  ANSI_HIDE_CURSOR,
  ANSI_QUERY_SYNCHRONIZED_OUTPUT_SUPPORT,
  ANSI_RESET_STYLE,
  ANSI_SHOW_CURSOR,
  ANSI_CLEAR_SCREEN,
  ANSI_DISABLE_BRACKETED_PASTE,
  ANSI_DISABLE_FOCUS_EVENTS,
  ANSI_DISABLE_MOUSE_TRACKING,
  ANSI_DISABLE_MOUSE_BUTTON_EVENT_TRACKING,
  ANSI_DISABLE_SGR_MOUSE_MODE,
  ANSI_END_HYPERLINK,
  ANSI_ENABLE_BRACKETED_PASTE,
  ANSI_ENABLE_FOCUS_EVENTS,
  ANSI_ENABLE_MOUSE_TRACKING,
  ANSI_ENABLE_MOUSE_BUTTON_EVENT_TRACKING,
  ANSI_ENABLE_SGR_MOUSE_MODE,
  ANSI_ENTER_ALTERNATE_SCREEN,
  ANSI_DISABLE_AUTO_WRAP,
  ANSI_ENABLE_AUTO_WRAP,
  ANSI_ERASE_IN_LINE,
  ANSI_EXIT_ALTERNATE_SCREEN,
  ANSI_POP_KITTY_KEYBOARD_PROTOCOL,
  ANSI_PUSH_KITTY_KEYBOARD_PROTOCOL,
  NativeFrameStats,
  RENDERER_BRAILLE_PROGRESS_EMPTY,
  RENDERER_BRAILLE_PROGRESS_LEVELS,
  RENDERER_BRAILLE_PROGRESS_SEPARATOR,
  RENDERER_RATIO_PROGRESS_EMPTY,
  RENDERER_RATIO_PROGRESS_FILLED,
  RendererAnimationFrameGate,
  RendererQualityController,
  RendererTimeline,
  RendererTimelinePlayback,
  ansiTextToCells,
  ansiTextToCellLines,
  applyRendererCellPulse,
  applyRendererCellReveal,
  applyRendererCellShimmer,
  applyRendererCellVfx,
  applyRendererCellVfxToBuffer,
  auditRendererTheme,
  Box,
  calculateRendererInlineImageRows,
  coalesceCellPatches,
  Container,
  composeRendererRegions,
  createRendererRegionVfx,
  createRendererTheme,
  createRendererGradientTextCells,
  createRendererGradientTextRuns,
  createRendererStyledTextCells,
  createRendererDiagnosticsOverlayRegion,
  createRendererOverlayPanelRegion,
  CURSOR_MARKER,
  cursorShapeToAnsi,
  cursorStateToAnsi,
  cursorBackward,
  cursorDown,
  cursorForward,
  cursorHorizontalAbsolute,
  cursorUp,
  diagnoseNativeRenderer,
  diagnoseNativeRendererStats,
  diffCellBuffers,
  encodeTerminalFrame,
  encodeTerminalRuns,
  encodeTerminalRunsWithMetrics,
  escapeTerminalText,
  formatRendererDiagnosticsLine,
  formatRendererDiagnosticsLines,
  formatRendererDiagnosticsPanel,
  hyperlinkToAnsi,
  hashRendererEffectSeed,
  interpolateRendererCellStyle,
  layoutFlex,
  layoutLength,
  layoutMax,
  layoutMin,
  layoutPercent,
  layoutRatio,
  Markdown,
  formatRendererToolHeaderChip,
  fitRendererFrameTitle,
  fitRendererLineToWidth,
  formatRendererScrollPosition,
  measureRendererTranscriptContentWidth,
  measureAnsiDisplayWidth,
  measureDisplayWidth,
  measureRendererStyledTextRuns,
  mergeNativeTerminalFeatureOptions,
  mixHexColor,
  RendererScalarTransition,
  NativeFrameRenderer,
  RendererCellBuffer,
  RendererChildrenRenderCache,
  RendererCompositionCache,
  RendererDoubleBuffer,
  RendererGutterContainer,
  RendererWidthRenderCache,
  NativeTerminalCapabilityProbe,
  NativeTerminalRenderer,
  NativeTerminalSession,
  detectNativeTerminalCapabilities,
  detectNativeTerminalColorMode,
  detectNativeTerminalImageProtocol,
  encodeIterm2InlineImage,
  encodeKittyDeleteImages,
  encodeKittyGraphicsCommand,
  encodeKittyInlineImage,
  encodeRendererClearInlineImages,
  encodeRendererInlineImage,
  interpolateRendererScalar,
  isFocusable,
  nativeTerminalAdaptiveFeatureProfile,
  resolveNativePremiumRendererDefaults,
  nativeTerminalFeatureProfile,
  parseNativeSynchronizedOutputSupport,
  parseNativeTerminalDecModeReport,
  parseNativeTerminalDecModeReports,
  probeNativeSynchronizedOutputSupport,
  planRendererDamage,
  coalesceCellPatchesWithFrameGaps,
  RendererPrefixedWrappedLine,
  RendererScrollableLineViewport,
  RendererStableScrollableLineViewport,
  RendererTruncatedOutputComponent,
  projectRendererCursorMarkerLine,
  projectRendererCursorMarkerLines,
  projectRendererLineWindow,
  projectRendererNonEmptyLineWindow,
  projectRendererRatioProgressBar,
  projectRendererSegmentedProgressBar,
  projectRendererToolActivityPhase,
  projectRendererWrappedTextPreview,
  renderNativeLayoutFrame,
  renderRendererDividerRow,
  renderRendererFrameRows,
  renderRendererLabeledDividerRow,
  renderRendererPanelChromeRows,
  renderRendererRatioProgressBar,
  renderRendererSegmentedProgressBar,
  renderRendererFooterRow,
  renderRendererScrollableFrameRows,
  renderRendererStableScrollableFrameRows,
  renderRendererSteppedProgressBar,
  renderRendererScrollablePanelChromeRows,
  rendererMotionTimelineOptions,
  rendererContrastRatio,
  rendererDarkTheme,
  rendererLightTheme,
  rendererRegionVfxRequiresAnimationFrame,
  rendererRegionsRequireAnimationFrame,
  RendererRegionVfxAnimationScheduler,
  rendererThemeStyle,
  resolveRendererMotion,
  resolveRendererFrameOutputPolicy,
  resolveNativeSynchronizedOutputSupport,
  resolveRendererLayoutTree,
  rendererQualityAllows,
  rendererEffectAllows,
  rendererEffectFrameIntervalMs,
  rendererAnimationFrameIntervalMs,
  rendererPositiveModulo,
  sampleRendererStyleKeyframes,
  SelectList,
  snapshotRendererCellBuffer,
  resolveRendererEffectLevel,
  resolveRendererCellVfxProgress,
  resolveRendererRegionVfxPreset,
  resolveRendererSeededIndex,
  renderRendererGradientTextAnsi,
  renderRendererStyledTextRunsAnsi,
  renderRendererTranscriptLineBlock,
  renderRendererToolActivityHeader,
  splitRendererRect,
  splitDisplayClusters,
  Spacer,
  styleToAnsi,
  Text,
  textToCells,
  themedCell,
  truncateAnsiDisplayText,
  truncateDisplayText,
  truncateRendererStyledTextRuns,
  truncateToWidth,
  wrapAnsiDisplayText,
  triangleWave,
  visibleWidth,
  wrapDisplayText,
  wrapRendererStyledTextRuns,
  wrapTextWithAnsi,
  projectRendererLinePreview,
  diffRendererCellSnapshots,
  formatRendererCellSnapshot,
  formatRendererCellSnapshotDiff,
  projectRendererSteppedProgressBar,
  type MarkdownTheme,
  type RendererAnimationClock,
  type RendererAnimationFrame,
  type RendererAnimationFrameCallback,
  type RendererCell,
  type RendererFrameDiff,
  type RendererRootUI,
  type RendererTerminalHost,
  type NativeTerminalRendererFrameMetrics,
} from '../src';

describe('renderer themes', () => {
  it('resolves semantic theme tokens into concrete cell styles', () => {
    const theme = createRendererTheme({
      name: 'brand',
      base: rendererDarkTheme,
      palette: {
        accent: '#abc',
        surface: '#010203',
      },
      styles: {
        badge: { fg: 'accent', bg: '#112233', bold: true },
      },
    });

    expect(theme.palette.accent).toBe('#aabbcc');
    expect(theme.palette.surface).toBe('#010203');
    expect(rendererThemeStyle(theme, 'badge')).toEqual({
      fg: '#aabbcc',
      bg: '#112233',
      bold: true,
    });
    expect(themedCell(theme, 'x', 'accent')).toEqual({
      char: 'x',
      style: { fg: '#aabbcc', bold: true },
    });
  });

  it('ships distinct dark and light default palettes', () => {
    expect(rendererDarkTheme.mode).toBe('dark');
    expect(rendererLightTheme.mode).toBe('light');
    expect(rendererDarkTheme.palette.surface).not.toBe(rendererLightTheme.palette.surface);
    expect(rendererThemeStyle(rendererLightTheme, 'panelRaised')).toMatchObject({
      fg: rendererLightTheme.palette.text,
      bg: rendererLightTheme.palette.surfaceRaised,
    });
  });

  it('audits default theme contrast for text and terminal UI chrome', () => {
    const darkAudit = auditRendererTheme(rendererDarkTheme);
    const lightAudit = auditRendererTheme(rendererLightTheme);

    expect(darkAudit.passed).toBe(true);
    expect(lightAudit.passed).toBe(true);
    expect(rendererContrastRatio('#000000', '#ffffff')).toBeCloseTo(21);
    expect(darkAudit.checks.find((check) => check.id === 'border')).toMatchObject({
      role: 'ui',
      passed: true,
    });
    expect(lightAudit.checks.find((check) => check.id === 'body')?.ratio).toBeGreaterThanOrEqual(4.5);
  });

  it('reports failing contrast checks for custom themes', () => {
    const theme = createRendererTheme({
      name: 'low-contrast',
      palette: {
        text: '#777777',
        surface: '#777777',
      },
    });
    const audit = auditRendererTheme(theme, {
      checks: [{ id: 'body', foreground: 'text', background: 'surface', role: 'text' }],
    });

    expect(audit.passed).toBe(false);
    expect(audit.failures).toEqual([
      {
        id: 'body',
        foreground: '#777777',
        background: '#777777',
        role: 'text',
        ratio: 1,
        minRatio: 4.5,
        passed: false,
      },
    ]);
  });
});

describe('renderer adaptive quality', () => {
  it('summarizes renderer diagnostics from frame stats and quality state', () => {
    const stats = new NativeFrameStats({ windowSize: 4 });

    expect(diagnoseNativeRendererStats(stats.snapshot())).toMatchObject({
      severity: 'ok',
      health: 'idle',
      issues: [],
    });

    stats.record(frameMetrics({ durationMs: 16, targetFrameMs: 10, outputBytes: 70_000 }));
    stats.record(frameMetrics({ durationMs: 12, targetFrameMs: 10, outputBytes: 80_000 }));
    const diagnostics = diagnoseNativeRendererStats(stats.snapshot(), {
      level: 'high',
      consecutiveOverBudgetFrames: 0,
      consecutiveOutputPressureFrames: 0,
      consecutiveUnderBudgetFrames: 0,
      changes: 1,
      lastChangeReason: 'over-budget',
    });

    expect(diagnostics.severity).toBe('degraded');
    expect(diagnostics.issues.map((issue) => issue.code)).toEqual([
      'frame-budget',
      'phase',
      'quality',
      'output-volume',
    ]);
    expect(formatRendererDiagnosticsLine(diagnostics)).toContain('renderer degraded');
    expect(formatRendererDiagnosticsLine(diagnostics)).toContain('quality high');
    expect(formatRendererDiagnosticsLines(diagnostics, { maxIssues: 2 })).toEqual([
      'renderer degraded | 14ms avg | 16ms p95 | 16ms p99 | 16ms max | 100% over',
      'frames █▆ | scan 100%/100% full | changed 0% | 73.2 KiB avg out',
      'output full | sync off | large yes | erase-line off | reason full-frame',
      'phase top render 14ms | render 14ms | present 0ms | write 0ms',
      'cache rows 0% | lines 0% | quality high over-budget',
      'degraded: frame-budget 140% >= 90%',
      'degraded: phase render 14ms >= 85%',
    ]);
    expect(formatRendererDiagnosticsLines(diagnostics, { maxIssues: 2, layout: 'compact' })).toEqual([
      'renderer degraded | 14ms avg | 16ms p95 | 16ms p99 | 16ms max | frames █▆ | phase top render 14ms | render 14ms | present 0ms | write 0ms | scan 100%/100% full | 100% over | 73.2 KiB avg out | 0% row cache | 0% line cache | quality high over-budget | output full sync off el off',
      'degraded: frame-budget 140% >= 90%',
      'degraded: phase render 14ms >= 85%',
    ]);

    const panel = formatRendererDiagnosticsPanel(diagnostics, {
      width: 44,
      maxIssues: 1,
      title: 'Render',
    });
    expect(panel).toHaveLength(8);
    expect(panel.every((line) => measureDisplayWidth(line) === 44)).toBe(true);
    expect(panel[0]).toMatch(/^╭ Render /);
    expect(panel[1]).toMatch(/^│renderer degraded/);
    expect(panel[2]).toContain('frames');
    expect(panel[3]).toContain('output full');
    expect(panel[4]).toContain('phase top');
    expect(panel[5]).toContain('cache rows');
    expect(panel[6]).toContain('frame-budget');
    expect(panel[7]).toBe(`╰${'─'.repeat(42)}╯`);

    const unframedPanel = formatRendererDiagnosticsPanel(diagnostics, {
      width: 28,
      border: false,
      includeIssues: false,
    });
    expect(unframedPanel).toHaveLength(5);
    expect(unframedPanel.every((line) => measureDisplayWidth(line) === 28)).toBe(true);
    expect(unframedPanel[0]).toContain('renderer degraded');
    expect(unframedPanel[1]).toContain('frames');
    expect(unframedPanel[2]).toContain('output full');
  });

  it('surfaces synchronized-output probe results in renderer diagnostics', () => {
    const stats = new NativeFrameStats({ windowSize: 4 });
    stats.record(frameMetrics({ durationMs: 8, targetFrameMs: 16, outputBytes: 128 }));
    const diagnostics = diagnoseNativeRendererStats(stats.snapshot(), undefined, {
      synchronizedOutputProbeResult: {
        support: 'unsupported',
        timedOut: false,
      },
      synchronizedOutputEnabled: false,
    });

    expect(diagnostics).toMatchObject({
      severity: 'watch',
      synchronizedOutputSupport: 'unsupported',
      synchronizedOutputProbeTimedOut: false,
      synchronizedOutputEnabled: false,
    });
    expect(diagnostics.issues.map((issue) => issue.code)).toContain('terminal-capability');
    expect(formatRendererDiagnosticsLines(diagnostics, { includeIssues: false })[2]).toBe(
      'output full | sync off probe unsupported | large yes | erase-line off | reason full-frame',
    );

    const syncedStats = new NativeFrameStats({ windowSize: 4 });
    syncedStats.record(
      frameMetrics({
        durationMs: 8,
        targetFrameMs: 16,
        outputBytes: 128,
        outputSynchronized: true,
      }),
    );
    const timedOut = diagnoseNativeRendererStats(syncedStats.snapshot(), undefined, {
      synchronizedOutputProbeResult: {
        support: 'unknown',
        timedOut: true,
      },
      synchronizedOutputEnabled: true,
    });
    expect(formatRendererDiagnosticsLine(timedOut)).toContain('sync on probe timeout');
    expect(timedOut.issues.map((issue) => issue.message)).toContain(
      'Terminal synchronized-output probe timed out; kept sync enabled.',
    );
  });

  it('surfaces output stream backpressure in renderer diagnostics', () => {
    const stats = new NativeFrameStats({ windowSize: 4 });
    stats.record(frameMetrics({ outputBackpressure: true, outputBytes: 12 }));
    stats.record(frameMetrics({ outputBackpressure: false, outputBytes: 8 }));
    const diagnostics = diagnoseNativeRendererStats(stats.snapshot());

    expect(diagnostics).toMatchObject({
      severity: 'degraded',
      outputBackpressureFrames: 1,
      outputBackpressureRatio: 0.5,
    });
    expect(diagnostics.issues.map((issue) => issue.code)).toContain('output-backpressure');
    expect(formatRendererDiagnosticsLines(diagnostics, { includeIssues: false })[1]).toContain(
      'backpressure 50%',
    );
    expect(formatRendererDiagnosticsLines(diagnostics, { maxIssues: 5 })).toContain(
      'degraded: output-backpressure 50% >= 0%',
    );
  });

  it('reports cache efficiency diagnostics when cache samples are large enough', () => {
    const stats = new NativeFrameStats({ windowSize: 30 });
    for (let i = 0; i < 30; i++) {
      stats.record(frameMetrics({
        durationMs: 2,
        targetFrameMs: 10,
        compositionRowsComposed: 10,
        compositionRowsReused: 1,
        compositionReuseRatio: 1 / 11,
        lineCacheHits: i % 10 === 0 ? 1 : 0,
        lineCacheMisses: 1,
        lineCacheHitRatio: i % 10 === 0 ? 0.5 : 0,
      }));
    }

    const diagnostics = diagnoseNativeRenderer({
      stats: stats.snapshot(),
      quality: {
        level: 'full',
        consecutiveOverBudgetFrames: 0,
        consecutiveOutputPressureFrames: 0,
        consecutiveUnderBudgetFrames: 0,
        changes: 0,
      },
    });

    expect(diagnostics.severity).toBe('watch');
    expect(diagnostics.issues.map((issue) => issue.code)).toEqual([
      'composition-cache',
      'line-cache',
    ]);
  });

  it('summarizes rolling frame budget health for adaptive renderers', () => {
    const stats = new NativeFrameStats({ windowSize: 3 });

    expect(stats.snapshot()).toMatchObject({
      health: 'idle',
      avgFrameBudgetRatio: 0,
      maxFrameBudgetRatio: 0,
    });

    stats.record(frameMetrics({ durationMs: 4, targetFrameMs: 10, changedCells: 10 }));
    expect(stats.snapshot()).toMatchObject({
      health: 'healthy',
      avgFrameBudgetRatio: 0.4,
      maxFrameBudgetRatio: 0.4,
      avgChangedCellRatio: 0.1,
      avgScannedCellRatio: 1,
    });

    stats.record(frameMetrics({ durationMs: 9, targetFrameMs: 10, changedCells: 20 }));
    const watchStats = stats.snapshot();
    expect(watchStats.health).toBe('watch');
    expect(watchStats.avgFrameBudgetRatio).toBeCloseTo(0.65);
    expect(watchStats.maxFrameBudgetRatio).toBeCloseTo(0.9);
    expect(watchStats.avgChangedCellRatio).toBeCloseTo(0.15);

    stats.record(frameMetrics({ durationMs: 16, targetFrameMs: 10, changedCells: 100 }));
    const degradedStats = stats.snapshot();
    expect(degradedStats.health).toBe('degraded');
    expect(degradedStats.avgFrameBudgetRatio).toBeCloseTo(0.9666666666666667);
    expect(degradedStats.maxFrameBudgetRatio).toBeCloseTo(1.6);
    expect(degradedStats.avgChangedCellRatio).toBeCloseTo(0.43333333333333335);
  });

  it('summarizes renderer frame cadence and recent frame samples', () => {
    const stats = new NativeFrameStats({ windowSize: 4 });

    stats.record(frameMetrics({ startedAt: 0, durationMs: 4, targetFrameMs: 16 }));
    stats.record(frameMetrics({
      startedAt: 16,
      durationMs: 8,
      targetFrameMs: 16,
      scanStrategy: 'dirty-rows',
      scannedCells: 12,
      scanRatio: 0.12,
      damageCells: 100,
      damageRatio: 1,
    }));
    stats.record(frameMetrics({
      startedAt: 32,
      durationMs: 16,
      targetFrameMs: 16,
      scanStrategy: 'dirty-rows',
      scannedCells: 8,
      scanRatio: 0.08,
      damageCells: 100,
      damageRatio: 1,
    }));
    const snapshot = stats.snapshot();
    const diagnostics = diagnoseNativeRendererStats(snapshot);

    expect(snapshot.avgFrameIntervalMs).toBe(16);
    expect(snapshot.avgFps).toBeCloseTo(62.5);
    expect(snapshot.p95DurationMs).toBe(16);
    expect(snapshot.p99DurationMs).toBe(16);
    expect(snapshot.avgScanRatio).toBeCloseTo(0.4);
    expect(snapshot.maxScanRatio).toBe(1);
    expect(snapshot.avgDamageRatio).toBe(1);
    expect(snapshot.maxDamageRatio).toBe(1);
    expect(snapshot.dominantScanStrategy).toBe('dirty-rows');
    expect(snapshot.scanStrategyCounts).toEqual({
      none: 0,
      dirtyRows: 2,
      damageRect: 0,
      fullFrame: 1,
    });
    expect(snapshot.frameDurationSamplesMs).toEqual([4, 8, 16]);
    expect(snapshot.frameBudgetRatioSamples).toEqual([0.25, 0.5, 1]);
    expect(diagnostics.p95DurationMs).toBe(16);
    expect(diagnostics.p99DurationMs).toBe(16);
    expect(diagnostics.avgScanRatio).toBeCloseTo(0.4);
    expect(diagnostics.avgDamageRatio).toBe(1);
    expect(diagnostics.dominantScanStrategy).toBe('dirty-rows');
    expect(diagnostics.frameTimeSparkline).toBe('▂▄█');
    expect(formatRendererDiagnosticsLine(diagnostics)).toContain('62.5 fps');
    expect(formatRendererDiagnosticsLine(diagnostics)).toContain('16ms p95');
    expect(formatRendererDiagnosticsLine(diagnostics)).toContain('16ms p99');
    expect(formatRendererDiagnosticsLine(diagnostics)).toContain('scan 40%/100% dirty');
    expect(formatRendererDiagnosticsLine(diagnostics)).toContain('frames ▂▄█');
  });

  it('summarizes optimized output run metrics for renderer diagnostics', () => {
    const stats = new NativeFrameStats({ windowSize: 4 });

    stats.record(frameMetrics({
      outputBytes: 20,
      outputCells: 4,
      outputRuns: 1,
      outputBridgedCells: 2,
      outputBridgedCellRatio: 0.5,
      cursorAbsoluteMoves: 1,
      cursorRelativeMoves: 2,
      cursorHorizontalAbsoluteMoves: 0,
      cursorMoveBytes: 12,
      cursorMoveAbsoluteBytes: 18,
      cursorMoveSavedBytes: 6,
      changedCells: 2,
    }));
    stats.record(frameMetrics({
      outputBytes: 40,
      outputCells: 8,
      outputRuns: 2,
      outputBridgedCells: 2,
      outputBridgedCellRatio: 0.25,
      cursorAbsoluteMoves: 2,
      cursorRelativeMoves: 2,
      cursorHorizontalAbsoluteMoves: 1,
      cursorMoveBytes: 20,
      cursorMoveAbsoluteBytes: 28,
      cursorMoveSavedBytes: 8,
      changedCells: 6,
    }));

    const snapshot = stats.snapshot();
    const diagnostics = diagnoseNativeRendererStats(snapshot);

    expect(snapshot).toMatchObject({
      avgOutputCells: 6,
      totalOutputCells: 12,
      avgOutputRuns: 1.5,
      totalOutputRuns: 3,
      avgOutputBridgedCells: 2,
      totalOutputBridgedCells: 4,
      avgOutputBridgedCellRatio: 1 / 3,
      avgCursorAbsoluteMoves: 1.5,
      totalCursorAbsoluteMoves: 3,
      avgCursorRelativeMoves: 2,
      totalCursorRelativeMoves: 4,
      avgCursorHorizontalAbsoluteMoves: 0.5,
      totalCursorHorizontalAbsoluteMoves: 1,
      avgCursorMoveBytes: 16,
      totalCursorMoveBytes: 32,
      avgCursorMoveSavedBytes: 7,
      totalCursorMoveSavedBytes: 14,
    });
    expect(diagnostics).toMatchObject({
      avgOutputCells: 6,
      avgOutputRuns: 1.5,
      avgOutputBridgedCells: 2,
      avgOutputBridgedCellRatio: 1 / 3,
      avgCursorAbsoluteMoves: 1.5,
      avgCursorRelativeMoves: 2,
      avgCursorHorizontalAbsoluteMoves: 0.5,
      avgCursorMoveBytes: 16,
      avgCursorMoveSavedBytes: 7,
    });
    expect(formatRendererDiagnosticsLines(diagnostics, { includeIssues: false })[1]).toContain(
      'runs 1.5 out-cells 6 bridged 2 33.3%',
    );
    expect(formatRendererDiagnosticsLines(diagnostics, { includeIssues: false })[1]).toContain(
      'cursor abs 1.5 rel 2 cha 0.5 saved 7 B',
    );
  });

  it('degrades under repeated frame-budget misses and recovers after stable frames', () => {
    const quality = new RendererQualityController({
      degradeAfterFrames: 2,
      recoverAfterFrames: 2,
      recoverBelowFrameBudgetRatio: 0.5,
    });

    expect(quality.snapshot().level).toBe('full');

    quality.record({ durationMs: 12, targetFrameMs: 10, overBudget: true });
    expect(quality.snapshot()).toMatchObject({
      level: 'full',
      consecutiveOverBudgetFrames: 1,
    });

    quality.record({ durationMs: 11, targetFrameMs: 10, overBudget: true });
    expect(quality.snapshot()).toMatchObject({
      level: 'high',
      changes: 1,
      lastChangeReason: 'over-budget',
    });

    quality.record({ durationMs: 4, targetFrameMs: 10, overBudget: false });
    quality.record({ durationMs: 4, targetFrameMs: 10, overBudget: false });
    expect(quality.snapshot()).toMatchObject({
      level: 'full',
      changes: 2,
      lastChangeReason: 'recovered',
    });
  });

  it('degrades immediately when terminal output is backpressured', () => {
    const quality = new RendererQualityController({
      recoverAfterFrames: 2,
      recoverBelowFrameBudgetRatio: 0.5,
    });

    quality.record({
      durationMs: 1,
      targetFrameMs: 16,
      overBudget: false,
      outputBackpressure: true,
    });

    expect(quality.snapshot()).toMatchObject({
      level: 'high',
      changes: 1,
      lastChangeReason: 'output-backpressure',
    });

    quality.record({ durationMs: 4, targetFrameMs: 16, overBudget: false });
    quality.record({ durationMs: 4, targetFrameMs: 16, overBudget: false });

    expect(quality.snapshot()).toMatchObject({
      level: 'full',
      changes: 2,
      lastChangeReason: 'recovered',
    });
  });

  it('degrades after sustained terminal output volume pressure', () => {
    const quality = new RendererQualityController({
      degradeAfterOutputPressureFrames: 2,
      outputPressureBytes: 10,
      recoverAfterFrames: 2,
      recoverBelowFrameBudgetRatio: 0.5,
    });

    quality.record({
      durationMs: 1,
      targetFrameMs: 16,
      overBudget: false,
      outputBytes: 12,
    });
    expect(quality.snapshot()).toMatchObject({
      level: 'full',
      consecutiveOutputPressureFrames: 1,
    });

    quality.record({
      durationMs: 1,
      targetFrameMs: 16,
      overBudget: false,
      outputBytes: 12,
    });
    expect(quality.snapshot()).toMatchObject({
      level: 'high',
      changes: 1,
      lastChangeReason: 'output-pressure',
    });

    quality.record({ durationMs: 4, targetFrameMs: 16, overBudget: false, outputBytes: 0 });
    quality.record({ durationMs: 4, targetFrameMs: 16, overBudget: false, outputBytes: 0 });
    expect(quality.snapshot()).toMatchObject({
      level: 'full',
      changes: 2,
      lastChangeReason: 'recovered',
    });
  });

  it('degrades after sustained changed-cell pressure', () => {
    const quality = new RendererQualityController({
      degradeAfterOutputPressureFrames: 1,
      outputPressureBytes: 1000,
      outputPressureCellRatio: 0.5,
    });

    quality.record({
      durationMs: 1,
      targetFrameMs: 16,
      overBudget: false,
      outputBytes: 0,
      changedCells: 6,
      totalCells: 10,
    });

    expect(quality.snapshot()).toMatchObject({
      level: 'high',
      changes: 1,
      lastChangeReason: 'output-pressure',
    });
  });

  it('compares quality levels for optional visual effects', () => {
    expect(rendererQualityAllows('full', 'balanced')).toBe(true);
    expect(rendererQualityAllows('balanced', 'minimal')).toBe(true);
    expect(rendererQualityAllows('minimal', 'balanced')).toBe(false);
  });
});

describe('renderer overlays', () => {
  it('creates fixed-width overlay panel regions with stable placement', () => {
    const region = createRendererOverlayPanelRegion({
      viewport: { x: 0, y: 0, width: 40, height: 10 },
      title: 'Status',
      lines: ['hello', 'world'],
      width: 20,
      placement: 'bottom-right',
      style: {
        container: { fg: '#dddddd', bg: '#111111' },
        border: { fg: '#77aaff' },
        title: { fg: '#ffffff', bold: true },
      },
    });

    expect(region).toBeDefined();
    expect(region?.rect).toEqual({ x: 19, y: 5, width: 20, height: 4 });
    expect(region?.zIndex).toBe(10_000);
    expect(region?.clear).toBe(true);
    expect(region?.content).toHaveLength(4);
    expect(region?.content.every((line) => regionLineDisplayWidth(line) === 20)).toBe(true);
    expect(regionLineText(region!.content[0]!)).toContain('Status');
    expect((region!.content[0] as readonly RendererCell[])[0]?.style).toMatchObject({
      fg: '#77aaff',
      bg: '#111111',
    });
  });

  it('clamps overlay panels and summarizes hidden lines when height is constrained', () => {
    const region = createRendererOverlayPanelRegion({
      viewport: { x: 0, y: 0, width: 16, height: 4 },
      title: 'Long diagnostics title',
      lines: ['one', 'two', 'three'],
      width: 30,
      maxHeight: 3,
      placement: 'center',
      marginX: 0,
      marginY: 0,
    });

    expect(region?.rect).toEqual({ x: 0, y: 0, width: 16, height: 3 });
    expect(region?.content).toHaveLength(3);
    expect(region?.content.every((line) => regionLineDisplayWidth(line) === 16)).toBe(true);
    expect(regionLineText(region!.content[0]!)).toContain('Long dia');
    expect(regionLineText(region!.content[1]!)).toContain('+3 more');
  });

  it('creates severity-styled diagnostics overlay regions', () => {
    const stats = new NativeFrameStats({ windowSize: 4 });
    stats.record(frameMetrics({ durationMs: 16, targetFrameMs: 10, outputBytes: 70_000 }));
    stats.record(frameMetrics({ durationMs: 12, targetFrameMs: 10, outputBytes: 80_000 }));
    const diagnostics = diagnoseNativeRendererStats(stats.snapshot(), {
      level: 'high',
      consecutiveOverBudgetFrames: 0,
      consecutiveOutputPressureFrames: 0,
      consecutiveUnderBudgetFrames: 0,
      changes: 1,
      lastChangeReason: 'over-budget',
    });

    const region = createRendererDiagnosticsOverlayRegion(diagnostics, {
      viewport: { x: 0, y: 0, width: 60, height: 10 },
      width: 38,
      maxIssues: 1,
      placement: 'top-right',
      theme: rendererDarkTheme,
    });

    expect(region).toBeDefined();
    expect(region?.id).toBe('renderer-diagnostics');
    expect(region?.rect).toEqual({ x: 21, y: 1, width: 38, height: 8 });
    expect(region?.content.every((line) => regionLineDisplayWidth(line) === 38)).toBe(true);
    expect((region!.content[0] as readonly RendererCell[])[0]?.style).toMatchObject({
      fg: rendererDarkTheme.palette.danger,
      bg: rendererDarkTheme.palette.surfaceRaised,
    });
    expect(regionLineText(region!.content[3]!)).toContain('output full');
    expect(regionLineText(region!.content[6]!)).toContain('frame-budget');
  });
});

describe('renderer effect policy', () => {
  it('resolves requested effects against quality and motion preferences', () => {
    expect(resolveRendererEffectLevel({ requested: 'premium', quality: 'full' })).toBe('premium');
    expect(resolveRendererEffectLevel({ requested: 'premium', quality: 'balanced' })).toBe('subtle');
    expect(resolveRendererEffectLevel({ requested: 'subtle', quality: 'minimal' })).toBe('off');
    expect(resolveRendererEffectLevel({ requested: 'premium', motion: 'reduced' })).toBe('subtle');
    expect(resolveRendererEffectLevel({ requested: 'premium', motion: 'none' })).toBe('off');
    expect(resolveRendererEffectLevel({ requested: 'premium', health: 'watch' })).toBe('subtle');
    expect(resolveRendererEffectLevel({ requested: 'subtle', health: 'degraded' })).toBe('off');
  });

  it('compares effect levels and provides default frame intervals', () => {
    expect(rendererEffectAllows('premium', 'subtle')).toBe(true);
    expect(rendererEffectAllows('subtle', 'premium')).toBe(false);
    expect(rendererEffectFrameIntervalMs('premium')).toBe(100);
    expect(rendererEffectFrameIntervalMs('subtle')).toBe(420);
    expect(rendererEffectFrameIntervalMs('off')).toBe(Number.POSITIVE_INFINITY);
    expect(rendererAnimationFrameIntervalMs({ fps: 30, requested: 'premium' })).toBe(100);
    expect(rendererAnimationFrameIntervalMs({ fps: 30, requested: 'premium', health: 'watch' })).toBe(420);
    expect(
      rendererAnimationFrameIntervalMs({
        fps: 30,
        requested: 'premium',
        health: 'degraded',
        offMs: 1000,
      }),
    ).toBe(1000);
  });

  it('creates adaptive region VFX presets from quality and motion policy', () => {
    expect(createRendererRegionVfx({
      preset: 'loading-shimmer',
      requested: 'premium',
      nowMs: 450,
      color: '#ffffff',
    })).toEqual({
      rect: undefined,
      effect: {
        kind: 'shimmer',
        progress: undefined,
        nowMs: 450,
        intervalMs: 900,
        seed: undefined,
        offset: undefined,
        color: '#ffffff',
        style: undefined,
        target: 'fg',
        width: 3,
        direction: 'forward',
      },
    });

    expect(resolveRendererRegionVfxPreset({
      preset: 'loading-shimmer',
      requested: 'premium',
      quality: 'balanced',
      nowMs: 450,
    })).toMatchObject({
      effectLevel: 'subtle',
      vfx: {
        effect: {
          kind: 'pulse',
          intervalMs: 1300,
          minIntensity: 0.08,
          maxIntensity: 0.24,
        },
      },
    });

    expect(createRendererRegionVfx({
      preset: 'focus-pulse',
      requested: 'premium',
      health: 'degraded',
    })).toBeUndefined();
    expect(createRendererRegionVfx({
      preset: 'content-reveal',
      requested: 'premium',
      motion: 'reduced',
      progress: 0.3,
    })).toBeUndefined();
    expect(createRendererRegionVfx({
      preset: 'content-reveal',
      requested: 'premium',
      rect: { x: 1, y: 2, width: 3, height: 4 },
    })).toMatchObject({
      rect: { x: 1, y: 2, width: 3, height: 4 },
      effect: {
        kind: 'reveal',
        progress: 1,
        intervalMs: 520,
        hiddenStyle: { dim: true },
        maskChar: ' ',
      },
    });
  });

  it('classifies region VFX that require animation frames', () => {
    const timeBased = createRendererRegionVfx({
      preset: 'loading-shimmer',
      requested: 'premium',
      nowMs: 450,
    });

    expect(rendererRegionVfxRequiresAnimationFrame(timeBased)).toBe(true);
    expect(rendererRegionsRequireAnimationFrame([{ vfx: undefined }, { vfx: timeBased }])).toBe(true);
    expect(rendererRegionVfxRequiresAnimationFrame({
      effect: {
        kind: 'pulse',
        progress: 0.5,
        nowMs: 450,
      },
    })).toBe(false);
    expect(rendererRegionVfxRequiresAnimationFrame({
      effect: {
        kind: 'shimmer',
        nowMs: 450,
        intervalMs: 0,
      },
    })).toBe(false);
    expect(rendererRegionVfxRequiresAnimationFrame({
      effect: {
        kind: 'shimmer',
        nowMs: 450,
        intervalMs: Number.POSITIVE_INFINITY,
      },
    })).toBe(false);
    expect(rendererRegionVfxRequiresAnimationFrame({
      effect: {
        kind: 'none',
        nowMs: 450,
      },
    })).toBe(false);
    expect(rendererRegionVfxRequiresAnimationFrame(createRendererRegionVfx({
      preset: 'content-reveal',
      requested: 'premium',
    }))).toBe(false);
    expect(rendererRegionsRequireAnimationFrame([{ vfx: undefined }])).toBe(false);
  });

  it('schedules animation frames for animated region VFX only', () => {
    const clock = new FakeAnimationClock();
    const frames: number[] = [];
    const scheduler = new RendererRegionVfxAnimationScheduler({
      clock,
      onFrame: (frame) => {
        frames.push(frame.frame);
      },
    });
    const timeBased = createRendererRegionVfx({
      preset: 'loading-shimmer',
      requested: 'premium',
      nowMs: 450,
    });

    expect(scheduler.requestForRegions([{ vfx: undefined }])).toBe(false);
    expect(clock.pendingFrames).toBe(0);
    expect(scheduler.requestForRegions([{ vfx: timeBased }])).toBe(true);
    expect(scheduler.requestForRegions([{ vfx: timeBased }])).toBe(false);
    expect(scheduler.hasPendingFrame).toBe(true);
    expect(clock.pendingFrames).toBe(1);

    clock.tick({ timestamp: 0, deltaMs: 0, frame: 0 });
    expect(frames).toEqual([0]);
    expect(scheduler.hasPendingFrame).toBe(false);
  });

  it('renders styled text runs to cells and ANSI output', () => {
    const runs = [
      { text: 'ab', style: { fg: '#ffffff' } },
      { text: '한🙂', style: { bold: true }, link: 'https://example.test' },
    ];
    expect(measureRendererStyledTextRuns(runs)).toBe(6);
    expect(truncateRendererStyledTextRuns(runs, {
      width: 5,
      ellipsis: '…',
      ellipsisStyle: { dim: true },
    })).toEqual([
      { text: 'ab', style: { fg: '#ffffff' } },
      { text: '한', style: { bold: true }, link: 'https://example.test' },
      { text: '…', style: { dim: true } },
    ]);
    expect(wrapRendererStyledTextRuns([
      { text: 'ab ', style: { fg: '#ffffff' } },
      { text: '한🙂\ncd', style: { bold: true }, link: 'https://example.test' },
    ], {
      width: 3,
      trimEnd: true,
    })).toEqual([
      [{ text: 'ab', style: { fg: '#ffffff' } }],
      [{ text: '한', style: { bold: true }, link: 'https://example.test' }],
      [{ text: '🙂', style: { bold: true }, link: 'https://example.test' }],
      [{ text: 'cd', style: { bold: true }, link: 'https://example.test' }],
    ]);

    const cells = createRendererStyledTextCells([
      {
        text: '한',
        style: { bold: true },
        link: 'https://example.test',
      },
    ]);

    expect(cells.map((cell) => [cell.char, cell.width, cell.style, cell.link])).toEqual([
      ['한', 2, { bold: true }, 'https://example.test'],
      ['', 0, { bold: true }, 'https://example.test'],
    ]);

    expect(renderRendererStyledTextRunsAnsi([
      { text: 'a', style: { fg: '#ffffff' } },
      { text: 'b', style: { fg: '#ffffff' } },
      { text: 'x', style: { underline: true }, link: 'https://example.test' },
    ])).toBe(
      '\u001B[0;38;2;255;255;255mab' +
      hyperlinkToAnsi('https://example.test') +
      '\u001B[0;4mx' +
      ANSI_END_HYPERLINK +
      '\u001B[0m',
    );
  });

  it('projects transcript line blocks and previews with ANSI-aware widths', () => {
    const redPrefix = '\u001B[31m● \u001B[0m';

    expect(measureRendererTranscriptContentWidth({ width: 8, prefix: redPrefix })).toBe(6);
    expect(renderRendererTranscriptLineBlock({
      width: 8,
      prefix: redPrefix,
      continuationPrefix: '  ',
      lines: ['abcdef', 'ghijklmnop'],
      leadingBlank: true,
      truncateMark: '…',
    }).map((line) => line.replaceAll(/\u001B\[[0-9;]*m/g, ''))).toEqual([
      '',
      '● abcdef',
      '  ghijk…',
    ]);

    const preserved = renderRendererTranscriptLineBlock({
      width: 4,
      prefix: '  ',
      lines: ['\u001B_Gpayload\u001B\\'],
      preserveLine: (line) => line.includes('\u001B_G'),
    });
    expect(preserved).toEqual(['  \u001B_Gpayload\u001B\\']);

    expect(projectRendererLinePreview({
      lines: ['a', 'b', 'c', 'd'],
      maxLines: 2,
    })).toEqual({
      lines: ['a', 'b'],
      hiddenLineCount: 2,
      hintPosition: 'after',
    });
    expect(projectRendererLinePreview({
      lines: ['a', 'b', 'c', 'd'],
      maxLines: 2,
      tail: true,
    })).toEqual({
      lines: ['c', 'd'],
      hiddenLineCount: 2,
      hintPosition: 'before',
    });
    expect(projectRendererLineWindow({
      lines: ['a', 'b', 'c', 'd'],
      maxLines: 2,
      tail: true,
    })).toEqual({
      lines: ['c', 'd'],
      hiddenLineCount: 2,
      startIndex: 2,
      endIndex: 4,
      anchor: 'tail',
    });
    expect(projectRendererLineWindow({
      lines: ['a', 'b', 'c', 'd'],
      maxLines: 2,
    })).toEqual({
      lines: ['a', 'b'],
      hiddenLineCount: 2,
      startIndex: 0,
      endIndex: 2,
      anchor: 'head',
    });
    const structuredRows = [{ id: 1 }, { id: 2 }, { id: 3 }];
    const structuredWindow = projectRendererLineWindow({
      lines: structuredRows,
      maxLines: 2,
    });
    expect(structuredWindow.lines).toEqual([{ id: 1 }, { id: 2 }]);
    expect(structuredWindow.lines[0]).toBe(structuredRows[0]);
    expect(structuredWindow.hiddenLineCount).toBe(1);
    expect(projectRendererNonEmptyLineWindow({
      text: 'a\n\nb  \n   \nc',
      maxLines: 2,
      tail: true,
    })).toEqual({
      lines: ['b', 'c'],
      hiddenLineCount: 1,
      startIndex: 1,
      endIndex: 3,
      anchor: 'tail',
      totalLineCount: 3,
    });
    expect(projectRendererWrappedTextPreview({
      text: 'alpha beta gamma delta',
      width: 8,
      maxLines: 2,
      normalizeWhitespace: true,
    })).toEqual({
      lines: ['alpha', 'beta…'],
      hiddenLineCount: 2,
      startIndex: 0,
      endIndex: 2,
      anchor: 'head',
      wrappedLineCount: 4,
    });

    const wrappedLine = new RendererPrefixedWrappedLine({
      firstPrefix: '● ',
      continuationPrefix: '  ',
      text: 'alpha beta gamma',
      tailLines: 2,
    });
    expect(wrappedLine.render(9)).toEqual(['● beta   ', '  gamma  ']);
    const cachedWrappedLine = wrappedLine.render(9);
    expect(wrappedLine.render(9)).toBe(cachedWrappedLine);
    wrappedLine.invalidate();
    const invalidatedWrappedLine = wrappedLine.render(9);
    expect(invalidatedWrappedLine).toEqual(['● beta   ', '  gamma  ']);
    expect(invalidatedWrappedLine).not.toBe(cachedWrappedLine);

    const truncatedOutput = new RendererTruncatedOutputComponent('a\nb\nc\nd', {
      expanded: false,
      maxLines: 2,
      indent: 4,
      formatText: (text) => `>${text}`,
      formatHint: (hint) => `!${hint}`,
    });
    expect(truncatedOutput.render(80).map((line) => line.trimEnd())).toEqual([
      '    >a',
      '    b',
      '    !... (2 more lines, ctrl+o to expand)',
    ]);
    const tailOutput = new RendererTruncatedOutputComponent('a\nb\nc\nd', {
      expanded: false,
      maxLines: 2,
      tail: true,
    });
    expect(tailOutput.render(80).map((line) => line.trimEnd())).toEqual([
      '  ... (2 earlier lines)',
      '  c',
      '  d',
    ]);
  });

  it('projects reusable tool activity headers', () => {
    expect(projectRendererToolActivityPhase({ finished: true })).toBe('succeeded');
    expect(projectRendererToolActivityPhase({ finished: true, error: true })).toBe('failed');
    expect(projectRendererToolActivityPhase({ truncated: true })).toBe('truncated');
    expect(projectRendererToolActivityPhase({})).toBe('running');

    expect(formatRendererToolHeaderChip({ text: '3 lines' })).toBe(' · 3 lines');
    expect(formatRendererToolHeaderChip({ text: '' })).toBe('');
    expect(renderRendererToolActivityHeader({
      marker: '● ',
      action: 'Using',
      label: 'Read',
      detail: ' (file.ts)',
      chip: ' · 3 lines',
    })).toBe('● Using Read (file.ts) · 3 lines');
  });

  it('projects seeded text-effect phases and gradient runs', () => {
    expect(rendererPositiveModulo(-1, 4)).toBe(3);
    expect(hashRendererEffectSeed('pulse')).toBe(hashRendererEffectSeed('pulse'));
    expect(resolveRendererSeededIndex({
      seed: 'pulse',
      nowMs: 0,
      intervalMs: 100,
      length: 4,
    })).toBe(resolveRendererSeededIndex({
      seed: 'pulse',
      nowMs: 99,
      intervalMs: 100,
      length: 4,
    }));
    expect(resolveRendererSeededIndex({
      seed: 'pulse',
      nowMs: 100,
      intervalMs: 100,
      length: 4,
    })).not.toBe(resolveRendererSeededIndex({
      seed: 'pulse',
      nowMs: 0,
      intervalMs: 100,
      length: 4,
    }));

    const runs = createRendererGradientTextRuns('한a🙂', {
      from: '#000000',
      to: '#ffffff',
      offset: 1,
    });

    expect(runs.map((run) => run.text)).toEqual(['한', 'a', '🙂']);
    expect(runs.map((run) => run.style)).toEqual([
      { fg: '#808080', bold: true },
      { fg: '#ffffff', bold: true },
      { fg: '#000000', bold: true },
    ]);

    const cells = createRendererGradientTextCells('한a', {
      from: '#000000',
      to: '#ffffff',
    });
    expect(cells.map((cell) => [cell.char, cell.width, cell.style])).toEqual([
      ['한', 2, { fg: '#000000', bold: true }],
      ['', 0, { fg: '#000000', bold: true }],
      ['a', undefined, { fg: '#ffffff', bold: true }],
    ]);
    expect(renderRendererGradientTextAnsi('ab', {
      from: '#000000',
      to: '#ffffff',
    })).toBe('\u001B[0;1;38;2;0;0;0ma\u001B[0;1;38;2;255;255;255mb\u001B[0m');
  });

  it('applies reusable cell VFX without mutating source cells', () => {
    const cells = createRendererStyledTextCells([{ text: '한a', style: { fg: '#000000' } }]);

    const pulse = applyRendererCellPulse(cells, {
      progress: 0.25,
      color: '#ffffff',
      minIntensity: 0,
      maxIntensity: 1,
    });
    expect(pulse.map((cell) => cell.style?.fg)).toEqual(['#808080', '#808080', '#808080']);
    expect(cells.map((cell) => cell.style?.fg)).toEqual(['#000000', '#000000', '#000000']);

    const shimmer = applyRendererCellShimmer(textToCells('abc', { fg: '#000000' }), {
      progress: 0.5,
      width: 2,
      color: '#ffffff',
    });
    expect(shimmer.map((cell) => cell.style?.fg)).toEqual(['#808080', '#ffffff', '#808080']);

    const reveal = applyRendererCellReveal(cells, {
      progress: 0.5,
      hiddenStyle: { fg: '#999999' },
      maskChar: '·',
    });
    expect(reveal.map((cell) => [cell.char, cell.width, cell.continuation, cell.style])).toEqual([
      ['한', 2, undefined, { fg: '#000000' }],
      ['', 0, true, { fg: '#000000' }],
      ['·', undefined, undefined, { fg: '#999999' }],
    ]);

    const hidden = applyRendererCellReveal(cells, {
      progress: 0,
      hiddenStyle: { dim: true },
      maskChar: '·',
    });
    expect(hidden.map((cell) => [cell.char, cell.width, cell.continuation, cell.style])).toEqual([
      [' ', 2, undefined, { dim: true }],
      ['', 0, true, { dim: true }],
      ['·', undefined, undefined, { dim: true }],
    ]);

    expect(applyRendererCellVfx(cells, { kind: 'none' })).toBe(cells);
    expect(resolveRendererCellVfxProgress({ nowMs: 250, intervalMs: 1000 })).toBe(0.25);
  });

  it('applies cell VFX to clipped frame-buffer rects with tracked damage', () => {
    const buffer = new RendererCellBuffer(5, 2);
    buffer.writeText(0, 0, 'abcde', { fg: '#000000' });
    buffer.writeText(0, 1, 'zzzzz', { fg: '#111111' });
    buffer.resetDamage();

    const changed = applyRendererCellVfxToBuffer(buffer, {
      rect: { x: 1, y: 0, width: 2, height: 1 },
      effect: {
        kind: 'pulse',
        progress: 0.25,
        color: '#ffffff',
        minIntensity: 0,
        maxIntensity: 1,
      },
    });

    expect(changed).toEqual({ x: 1, y: 0, width: 2, height: 1 });
    expect(buffer.damage).toEqual({ x: 1, y: 0, width: 2, height: 1 });
    expect(Array.from({ length: 5 }, (_, x) => buffer.getCell(x, 0).style?.fg)).toEqual([
      '#000000',
      '#808080',
      '#808080',
      '#000000',
      '#000000',
    ]);
    expect(Array.from({ length: 5 }, (_, x) => buffer.getCell(x, 1).style?.fg)).toEqual([
      '#111111',
      '#111111',
      '#111111',
      '#111111',
      '#111111',
    ]);
    expect(applyRendererCellVfxToBuffer(buffer, { effect: { kind: 'none' } })).toBeNull();
  });

  it('resolves motion presets against reduced motion and renderer pressure', () => {
    expect(resolveRendererMotion({ preset: 'emphasized', requested: 'premium' })).toMatchObject({
      preset: 'emphasized',
      effectLevel: 'premium',
      motion: 'normal',
      enabled: true,
      durationMs: 320,
      delayMs: 0,
      easing: 'easeInOutCubic',
    });
    expect(resolveRendererMotion({
      preset: 'emphasized',
      requested: 'premium',
      quality: 'balanced',
    })).toMatchObject({
      effectLevel: 'subtle',
      enabled: true,
      durationMs: 220,
    });
    expect(resolveRendererMotion({
      preset: 'ambient',
      requested: 'premium',
      motion: 'reduced',
    })).toMatchObject({
      effectLevel: 'subtle',
      motion: 'reduced',
      enabled: false,
      durationMs: 0,
    });
    expect(rendererMotionTimelineOptions({
      preset: 'quick',
      delayMs: 20,
      requested: 'premium',
    })).toEqual({
      durationMs: 120,
      delayMs: 20,
      easing: 'easeOutCubic',
    });
    expect(rendererMotionTimelineOptions({ preset: 'instant' })).toBeUndefined();
  });

  it('samples scalar transitions with adaptive motion presets', () => {
    const transition = new RendererScalarTransition({
      initial: 0,
      preset: 'quick',
      requested: 'premium',
      now: 100,
    });

    expect(transition.setTarget(10, 100)).toMatchObject({
      value: 0,
      from: 0,
      target: 10,
      active: false,
      done: false,
      progress: 0,
    });
    expect(transition.sample(160).value).toBeCloseTo(8.75);
    expect(transition.sample(220)).toMatchObject({
      value: 10,
      active: false,
      done: true,
      progress: 1,
    });

    transition.updateMotion({ preset: 'ambient', requested: 'premium', motion: 'reduced' }, 220);
    expect(transition.setTarget(20, 220)).toMatchObject({
      value: 20,
      active: false,
      done: true,
    });
    expect(interpolateRendererScalar(10, 20, 0.25)).toBe(12.5);
  });
});

describe('renderer animation primitives', () => {
  it('samples delayed, alternating, eased timelines from render timestamps', () => {
    const timeline = new RendererTimeline({
      durationMs: 100,
      delayMs: 50,
      iterations: 2,
      direction: 'alternate',
      easing: 'easeInOutQuad',
    });

    expect(timeline.sample(1000)).toMatchObject({
      active: false,
      done: false,
      iteration: 0,
      progress: 0,
    });
    expect(timeline.sample(1100)).toMatchObject({
      active: true,
      done: false,
      iteration: 0,
      progress: 0.5,
      easedProgress: 0.5,
    });
    expect(timeline.sample(1150)).toMatchObject({
      active: true,
      done: false,
      iteration: 1,
      progress: 1,
    });
    expect(timeline.sample(1250)).toMatchObject({
      active: false,
      done: true,
      iteration: 1,
      progress: 0,
    });
  });

  it('interpolates colors and style keyframes for terminal VFX', () => {
    expect(mixHexColor('#000', '#fff', 0.5)).toBe('#808080');
    expect(triangleWave(0.25)).toBe(0.5);
    expect(interpolateRendererCellStyle({ fg: '#000000' }, { fg: '#ffffff', bold: true }, 0.25)).toEqual({
      fg: '#404040',
    });
    expect(sampleRendererStyleKeyframes(
      [
        { offset: 0, style: { fg: '#000000' } },
        { offset: 1, style: { fg: '#ffffff', underline: true } },
      ],
      0.5,
    )).toEqual({
      fg: '#808080',
      underline: true,
    });
  });

  it('plays timeline samples on a renderer animation clock until completion', () => {
    const clock = new FakeAnimationClock();
    const samples: string[] = [];
    const completed: string[] = [];
    const playback = new RendererTimelinePlayback({
      clock,
      durationMs: 100,
      onSample: (sample, frame) => {
        samples.push(`${String(frame.frame)}:${sample.progress.toFixed(1)}:${String(sample.done)}`);
      },
      onComplete: (sample, frame) => {
        completed.push(`${String(frame.frame)}:${sample.progress.toFixed(1)}`);
      },
    });

    playback.start();

    expect(clock.pendingFrames).toBe(1);
    clock.tick({ timestamp: 0, deltaMs: 0, frame: 0 });
    clock.tick({ timestamp: 50, deltaMs: 50, frame: 1 });
    clock.tick({ timestamp: 100, deltaMs: 50, frame: 2 });

    expect(samples).toEqual(['0:0.0:false', '1:0.5:false', '2:1.0:true']);
    expect(completed).toEqual(['2:1.0']);
    expect(playback.isRunning).toBe(false);
    expect(playback.hasPendingFrame).toBe(false);
    expect(clock.pendingFrames).toBe(0);
  });

  it('cancels pending timeline playback without sampling another frame', () => {
    const clock = new FakeAnimationClock();
    const samples: number[] = [];
    const playback = new RendererTimelinePlayback({
      clock,
      durationMs: 100,
      autoStart: true,
      onSample: (sample) => {
        samples.push(sample.progress);
      },
    });

    expect(clock.pendingFrames).toBe(1);
    playback.stop();
    clock.tick({ timestamp: 0, deltaMs: 0, frame: 0 });

    expect(samples).toEqual([]);
    expect(clock.pendingFrames).toBe(0);
    expect(playback.isRunning).toBe(false);
  });

  it('gates duplicate renderer animation frame requests', () => {
    const clock = new FakeAnimationClock();
    const frames: number[] = [];
    const gate = new RendererAnimationFrameGate({
      clock,
      onFrame: (frame) => {
        frames.push(frame.frame);
      },
    });

    expect(gate.request()).toBe(true);
    expect(gate.request()).toBe(false);
    expect(gate.hasPendingFrame).toBe(true);
    expect(clock.pendingFrames).toBe(1);

    clock.tick({ timestamp: 0, deltaMs: 0, frame: 0 });
    expect(frames).toEqual([0]);
    expect(gate.hasPendingFrame).toBe(false);

    expect(gate.request((frame) => {
      frames.push(frame.frame + 10);
    })).toBe(true);
    clock.tick({ timestamp: 16, deltaMs: 16, frame: 1 });

    expect(frames).toEqual([0, 1, 11]);
  });

  it('cancels pending renderer animation frame gates', () => {
    const clock = new FakeAnimationClock();
    const frames: number[] = [];
    const gate = new RendererAnimationFrameGate({
      clock,
      onFrame: (frame) => {
        frames.push(frame.frame);
      },
    });

    expect(gate.request()).toBe(true);
    gate.cancel();
    clock.tick({ timestamp: 0, deltaMs: 0, frame: 0 });

    expect(frames).toEqual([]);
    expect(gate.hasPendingFrame).toBe(false);
    expect(clock.pendingFrames).toBe(0);
  });
});

describe('renderer text metrics', () => {
  it('measures grapheme clusters by terminal display cells', () => {
    expect(splitDisplayClusters('한a🙂').map((cluster) => [cluster.text, cluster.width])).toEqual([
      ['한', 2],
      ['a', 1],
      ['🙂', 2],
    ]);
    expect(measureDisplayWidth('한a🙂')).toBe(5);
    expect(measureDisplayWidth('e\u0301')).toBe(1);
    expect(measureDisplayWidth('👩‍💻')).toBe(2);
  });

  it('truncates and wraps without splitting grapheme clusters', () => {
    expect(truncateDisplayText('한글abc', 5, '…')).toBe('한글…');
    expect(truncateDisplayText('abc', 2, '…')).toBe('a…');
    expect(wrapDisplayText('한글abc', 4)).toEqual(['한글', 'abc']);
  });

  it('converts display text into wide-cell aware renderer cells', () => {
    expect(textToCells('한a').map((cell) => [cell.char, cell.width, cell.continuation])).toEqual([
      ['한', 2, undefined],
      ['', 0, true],
      ['a', undefined, undefined],
    ]);
  });

  it('measures and wraps ANSI-styled text without counting escape bytes', () => {
    expect(measureAnsiDisplayWidth('\u001B[31m한a\u001B[0m')).toBe(3);

    const wrapped = wrapAnsiDisplayText('\u001B[31mabcdef', 3);
    expect(wrapped).toEqual([
      '\u001B[31mabc\u001B[0m',
      '\u001B[31mdef\u001B[0m',
    ]);
    expect(wrapped.every((line) => measureAnsiDisplayWidth(line) <= 3)).toBe(true);
  });

  it('renders a width-safe reusable Text component', () => {
    const text = new Text('한a🙂\nnext', 1, 0);
    const lines = text.render(5);

    expect(lines).toEqual([' 한a ', ' 🙂  ', ' nex ', ' t   ']);
    expect(lines.every((line) => measureAnsiDisplayWidth(line) === 5)).toBe(true);
    expect(text.render(5)).toBe(lines);
  });

  it('truncates ANSI text with a style reset and optional padding', () => {
    expect(truncateAnsiDisplayText('\u001B[31mabcdef', 5, '…', true)).toBe(
      '\u001B[31mabcd\u001B[0m…',
    );
  });

  it('exposes pi-tui compatible text utility names from the renderer package', () => {
    expect(visibleWidth('\u001B[31m한a\u001B[0m')).toBe(3);
    expect(wrapTextWithAnsi('alpha beta', 6)).toEqual(['alpha', 'beta']);
    expect(truncateToWidth('abcdef', 5, '…', true)).toBe('abcd…');
    expect(truncateToWidth('', 3, '…', true)).toBe('   ');
  });

  it('renders reusable Markdown with block and inline styling contracts', () => {
    const theme = {
      heading: (text) => text,
      link: (text) => text,
      linkUrl: (text) => text,
      code: (text) => `[${text}]`,
      codeBlock: (text) => `|${text}|`,
      codeBlockBorder: (text) => text,
      quote: (text) => text,
      quoteBorder: (text) => `> ${text}`,
      hr: (text) => text,
      listBullet: (text) => text.replace(/^-/, '•'),
      bold: (text) => `**${text}**`,
      italic: (text) => `_${text}_`,
      strikethrough: (text) => `~${text}~`,
      underline: (text) => text,
    } satisfies MarkdownTheme;

    const markdown = new Markdown(
      [
        '# Title',
        '',
        '- **one** and `two`',
        '',
        '[docs](https://example.test)',
        '',
        '```ts',
        'const x = 1;',
        '```',
      ].join('\n'),
      0,
      0,
      theme,
    );

    const lines = markdown.render(60);
    const trimmed = lines.map((line) => line.trimEnd());

    expect(trimmed).toContain('**Title**');
    expect(trimmed).toContain('• **one** and [two]');
    expect(trimmed).toContain('docs (https://example.test)');
    expect(trimmed).toContain('```ts');
    expect(trimmed).toContain('  |const x = 1;|');
    expect(lines.every((line) => measureAnsiDisplayWidth(line) === 60)).toBe(true);
    expect(markdown.render(60)).toBe(lines);
  });

  it('renders reusable Container, Spacer, and Box component primitives', () => {
    const container = new Container();
    const text = new Text('hello', 0, 0);
    const spacer = new Spacer(2);
    container.addChild(text);
    container.addChild(spacer);
    container.addChild(new Text('world', 0, 0));

    expect(container.render(8)).toEqual(['hello   ', '', '', 'world   ']);

    spacer.setLines(1);
    const removeContainerChild = container.removeChild.bind(container);
    removeContainerChild(text);
    expect(container.render(8)).toEqual(['', 'world   ']);

    const box = new Box(1, 1, (line) => `\u001B[41m${line}\u001B[0m`);
    box.addChild(new Text('x', 0, 0));
    const lines = box.render(5);
    expect(lines).toEqual([
      '\u001B[41m     \u001B[0m',
      '\u001B[41m x   \u001B[0m',
      '\u001B[41m     \u001B[0m',
    ]);
    expect(box.render(5)).toBe(lines);

    box.clear();
    expect(box.render(5)).toEqual([]);
  });

  it('renders reusable gutter containers with stable inner width and cached output', () => {
    const container = new RendererGutterContainer({ leftPad: 2, rightPad: 3 });
    const childLines = ['hello'];
    container.addChild({
      invalidate: () => {},
      render: () => childLines,
    });

    expect(container.render(12)).toEqual(['  hello']);
    const rendered = container.render(12);
    expect(container.render(12)).toBe(rendered);

    const narrow = new RendererGutterContainer({ leftPad: 5, rightPad: 5 });
    let seenWidth = 0;
    narrow.addChild({
      invalidate: () => {},
      render: (width) => {
        seenWidth = width;
        return ['x'];
      },
    });
    expect(narrow.render(2)).toEqual(['     x']);
    expect(seenWidth).toBe(1);
  });

  it('lets reusable gutter containers use host-provided line painting and cache policy', () => {
    let paintCalls = 0;
    const container = new RendererGutterContainer({
      leftPad: 1,
      rightPad: 1,
      isCacheEnabled: () => false,
      paintLine: (line, width) => {
        paintCalls++;
        return `${line}${'.'.repeat(Math.max(0, width - visibleWidth(line)))}`;
      },
    });
    container.addChild({
      invalidate: () => {},
      render: () => ['x'],
    });

    expect(container.render(4)).toEqual([' x..']);
    expect(container.render(4)).toEqual([' x..']);
    expect(paintCalls).toBe(2);
  });

  it('caches flattened child render output for composite components', () => {
    const cache = new RendererChildrenRenderCache();
    const childLines = ['a', 'b'];
    let renderCalls = 0;
    const child = {
      invalidate: () => {},
      render: (_width: number): string[] => {
        renderCalls++;
        return childLines;
      },
    };

    const first = cache.render({ width: 4, children: [child] });
    const second = cache.render({ width: 4, children: [child] });

    expect(first).toEqual(['a', 'b']);
    expect(second).toBe(first);
    expect(renderCalls).toBe(2);

    cache.clear();
    expect(cache.render({ width: 4, children: [child] })).toEqual(['a', 'b']);
    expect(renderCalls).toBe(3);
  });

  it('supports child-line projection and disabled cache policy', () => {
    const cache = new RendererChildrenRenderCache();
    const child = {
      invalidate: () => {},
      render: (): string[] => ['x'],
    };

    expect(cache.render({
      width: 4,
      children: [child],
      projectChildLines: (lines, _child, width) =>
        lines.map((line) => `${line}${String(width)}`),
    })).toEqual(['x4']);

    const uncachedA = cache.render({
      width: 4,
      children: [child],
      isCacheEnabled: () => false,
    });
    const uncachedB = cache.render({
      width: 4,
      children: [child],
      isCacheEnabled: () => false,
    });
    expect(uncachedB).not.toBe(uncachedA);
  });

  it('caches width-keyed render output for components with explicit invalidation', () => {
    const cache = new RendererWidthRenderCache();
    let renderCalls = 0;

    const first = cache.render({
      width: 10,
      render: (width) => {
        renderCalls++;
        return [`width ${String(width)}`];
      },
    });
    const second = cache.render({
      width: 10,
      render: () => {
        renderCalls++;
        return ['stale'];
      },
    });

    expect(first).toEqual(['width 10']);
    expect(second).toBe(first);
    expect(renderCalls).toBe(1);

    cache.clear();
    expect(cache.render({
      width: 10,
      render: (width) => {
        renderCalls++;
        return [`fresh ${String(width)}`];
      },
    })).toEqual(['fresh 10']);
    expect(renderCalls).toBe(2);
  });

  it('lets width render caches be disabled by host policy', () => {
    const cache = new RendererWidthRenderCache();
    const first = cache.render({
      width: 8,
      isCacheEnabled: () => false,
      render: () => ['first'],
    });
    const second = cache.render({
      width: 8,
      isCacheEnabled: () => false,
      render: () => ['second'],
    });

    expect(second).not.toBe(first);
    expect(second).toEqual(['second']);
  });

  it('renders reusable divider rows with exact dimensions', () => {
    expect(renderRendererDividerRow({ width: 5 })).toBe('─────');
    expect(renderRendererDividerRow({ width: 5, lineStyle: 'heavy' })).toBe('━━━━━');
    expect(renderRendererDividerRow({ width: 5, lineStyle: 'double' })).toBe('═════');
    expect(renderRendererDividerRow({ width: 5, lineStyle: 'dashed' })).toBe('╍╍╍╍╍');
    expect(renderRendererDividerRow({ width: 5, lineStyle: 'ascii' })).toBe('-----');
    expect(renderRendererDividerRow({ width: 5, lineStyle: 'thick' })).toBe('█████');
    const styledDivider = renderRendererDividerRow({
      width: 4,
      style: (text) => `\u001B[31m${text}\u001B[0m`,
    });
    expect(styledDivider).toBe('\u001B[31m────\u001B[0m');
    expect(measureAnsiDisplayWidth(styledDivider)).toBe(4);
    expect(renderRendererDividerRow({ width: 5, char: '━' })).toBe('━━━━━');
    expect(renderRendererDividerRow({ width: 5, char: '' })).toBe('─────');
  });

  it('renders reusable labeled divider rows with exact dimensions', () => {
    expect(renderRendererLabeledDividerRow({
      width: 12,
      label: 'Title',
    })).toBe('─ Title ────');
    expect(renderRendererLabeledDividerRow({
      width: 12,
      label: 'Very long title',
      ellipsis: '…',
    })).toBe('─ Very lon… ');

    const styled = renderRendererLabeledDividerRow({
      width: 16,
      label: 'Panel',
      dividerStyle: (text) => `\u001B[36m${text}\u001B[0m`,
      labelStyle: (text) => `\u001B[1m${text}\u001B[0m`,
    });
    expect(styled).toBe(
      '\u001B[36m─\u001B[0m\u001B[36m \u001B[0m' +
        '\u001B[1mPanel\u001B[0m' +
        '\u001B[36m \u001B[0m\u001B[36m────────\u001B[0m',
    );
    expect(measureAnsiDisplayWidth(styled)).toBe(16);
  });

  it('renders reusable segmented progress bars with exact dimensions', () => {
    const projection = projectRendererSegmentedProgressBar({
      width: 10,
      segments: [
        { value: 1, char: 'A' },
        { value: 2, char: 'B' },
        { value: 1, char: 'C' },
      ],
    });

    expect(projection).toEqual({
      width: 10,
      total: 4,
      segments: [
        { index: 0, value: 1, width: 3, char: 'A' },
        { index: 1, value: 2, width: 5, char: 'B' },
        { index: 2, value: 1, width: 2, char: 'C' },
      ],
    });

    const styled = renderRendererSegmentedProgressBar({
      width: 10,
      segments: [
        { value: 1, char: 'A', style: (text) => `\u001B[31m${text}\u001B[0m` },
        { value: 2, char: 'B', style: (text) => `\u001B[32m${text}\u001B[0m` },
        { value: 1, char: 'C', style: (text) => `\u001B[33m${text}\u001B[0m` },
      ],
    });
    expect(styled).toBe(
      '\u001B[31mAAA\u001B[0m' +
        '\u001B[32mBBBBB\u001B[0m' +
        '\u001B[33mCC\u001B[0m',
    );
    expect(measureAnsiDisplayWidth(styled)).toBe(10);

    const empty = renderRendererSegmentedProgressBar({
      width: 5,
      char: '─',
      emptyStyle: (text) => `\u001B[2m${text}\u001B[0m`,
      segments: [],
    });
    expect(empty).toBe('\u001B[2m─────\u001B[0m');
    expect(measureAnsiDisplayWidth(empty)).toBe(5);
  });

  it('renders reusable ratio progress bars with exact dimensions', () => {
    expect(projectRendererRatioProgressBar({
      ratio: 0.75,
      width: 4,
    })).toEqual({
      width: 4,
      ratio: 0.75,
      filledWidth: 3,
      emptyWidth: 1,
      filledChar: RENDERER_RATIO_PROGRESS_FILLED,
      emptyChar: RENDERER_RATIO_PROGRESS_EMPTY,
    });
    expect(renderRendererRatioProgressBar({ ratio: 0, width: 10 })).toBe(
      RENDERER_RATIO_PROGRESS_EMPTY.repeat(10),
    );
    expect(renderRendererRatioProgressBar({ ratio: 1, width: 10 })).toBe(
      RENDERER_RATIO_PROGRESS_FILLED.repeat(10),
    );
    expect(renderRendererRatioProgressBar({ ratio: 0.5, width: 10 })).toBe(
      RENDERER_RATIO_PROGRESS_FILLED.repeat(5) +
        RENDERER_RATIO_PROGRESS_EMPTY.repeat(5),
    );
    expect(renderRendererRatioProgressBar({ ratio: -1, width: 8 })).toBe(
      RENDERER_RATIO_PROGRESS_EMPTY.repeat(8),
    );
    expect(renderRendererRatioProgressBar({ ratio: 2, width: 8 })).toBe(
      RENDERER_RATIO_PROGRESS_FILLED.repeat(8),
    );
    expect(renderRendererRatioProgressBar({ ratio: Number.NaN, width: 6 })).toBe(
      RENDERER_RATIO_PROGRESS_EMPTY.repeat(6),
    );

    const styled = renderRendererRatioProgressBar({
      ratio: 0.5,
      width: 6,
      filledStyle: (text) => `\u001B[32m${text}\u001B[0m`,
      emptyStyle: (text) => `\u001B[2m${text}\u001B[0m`,
    });
    expect(styled).toBe('\u001B[32m███\u001B[0m\u001B[2m░░░\u001B[0m');
    expect(measureAnsiDisplayWidth(styled)).toBe(6);
  });

  it('renders reusable stepped progress bars with exact dimensions', () => {
    const projection = projectRendererSteppedProgressBar({
      width: 4,
      ticks: 14,
      levels: ['1', '2', '3'],
      emptyChar: '.',
      separatorChar: '|',
    });

    expect(projection).toMatchObject({
      width: 4,
      ticks: 14,
      levelsPerCell: 3,
      completedCycles: 1,
      cycleTicks: 2,
      cells: [
        { index: 0, char: '2', level: 2, filled: true, separator: false },
        { index: 1, char: '|', level: 3, filled: true, separator: true },
        { index: 2, char: '3', level: 3, filled: true, separator: false },
        { index: 3, char: '3', level: 3, filled: true, separator: false },
      ],
    });

    const styled = renderRendererSteppedProgressBar({
      width: 4,
      ticks: 5,
      levels: ['a', 'b'],
      emptyChar: '_',
      filledStyle: (text) => `\u001B[32m${text}\u001B[0m`,
      emptyStyle: (text) => `\u001B[2m${text}\u001B[0m`,
    });
    expect(styled).toBe(
      '\u001B[32mb\u001B[0m' +
        '\u001B[32mb\u001B[0m' +
        '\u001B[32ma\u001B[0m' +
        '\u001B[2m_\u001B[0m',
    );
    expect(measureAnsiDisplayWidth(styled)).toBe(4);
    expect(renderRendererSteppedProgressBar({
      width: 3,
      ticks: 0,
      levels: RENDERER_BRAILLE_PROGRESS_LEVELS,
      emptyChar: RENDERER_BRAILLE_PROGRESS_EMPTY,
      separatorChar: RENDERER_BRAILLE_PROGRESS_SEPARATOR,
    })).toBe(RENDERER_BRAILLE_PROGRESS_EMPTY.repeat(3));
  });

  it('renders reusable flat panel chrome rows with exact dimensions', () => {
    const rows = renderRendererPanelChromeRows({
      width: 16,
      title: ' Title',
      titleSuffix: ' suffix',
      hint: ' hint text',
      body: [' body line', ' body line that is too wide'],
      footer: [' footer'],
      dividerStyle: (text) => `\u001B[36m${text}\u001B[0m`,
      titleStyle: (text) => `\u001B[1m${text}\u001B[0m`,
      hintStyle: (text) => `\u001B[2m${text}\u001B[0m`,
      ellipsis: '…',
    });

    expect(rows).toEqual([
      '\u001B[36m────────────────\u001B[0m',
      '\u001B[1m Title\u001B[0m suffix',
      '\u001B[2m hint text\u001B[0m',
      '',
      ' body line',
      ' body line that…',
      '',
      ' footer',
      '\u001B[36m────────────────\u001B[0m',
    ]);
    expect(rows.map((line) => measureAnsiDisplayWidth(line))).toEqual([
      16,
      13,
      10,
      0,
      10,
      16,
      0,
      7,
      16,
    ]);

    expect(
      renderRendererPanelChromeRows({
        width: 8,
        title: 'Title',
        hint: 'busy',
        body: ['wait'],
        bodyTopGap: false,
        footerTopGap: false,
      }),
    ).toEqual(['────────', 'Title', 'busy', 'wait', '────────']);
  });

  it('renders scrollable panel chrome with a clamped body viewport', () => {
    const projection = renderRendererScrollablePanelChromeRows({
      width: 18,
      title: ' Help',
      hint: ' scroll',
      body: [' one', ' two', ' three', ' four'],
      viewportRows: 2,
      scrollTop: 1,
      footerTopGap: false,
      scrollFooter: (window) =>
        window.hasOverflow
          ? ` showing ${String(window.lineFrom)}-${String(window.lineTo)} of ${String(window.contentRows)}`
          : undefined,
      scrollFooterStyle: (text) => `\u001B[2m${text}\u001B[0m`,
    });

    expect(projection).toMatchObject({
      contentRows: 4,
      viewportRows: 2,
      start: 1,
      end: 3,
      scrollTop: 1,
      lineFrom: 2,
      lineTo: 3,
      hasOverflow: true,
    });
    expect(projection.rows).toEqual([
      '──────────────────',
      ' Help',
      ' scroll',
      '',
      ' two',
      ' three',
      '\u001B[2m showing 2-3 of 4\u001B[0m',
      '──────────────────',
    ]);
    expect(projection.rows.map((line) => measureAnsiDisplayWidth(line))).toEqual([
      18,
      5,
      7,
      0,
      4,
      6,
      17,
      18,
    ]);
  });

  it('renders reusable framed rows with title and exact dimensions', () => {
    const frame = renderRendererFrameRows({
      title: 'Panel',
      content: ['alpha', 'beta beta beta'],
      width: 12,
      height: 4,
      borderStyle: (text) => `\u001B[31m${text}\u001B[0m`,
      titleStyle: (text) => `\u001B[1m${text}\u001B[0m`,
      ellipsis: '…',
    });

    expect(frame).toHaveLength(4);
    expect(frame.map((line) => measureAnsiDisplayWidth(line))).toEqual([12, 12, 12, 12]);
    expect(frame[0]).toContain('\u001B[1mPanel\u001B[0m');
    expect(frame[1]).toContain('alpha');
    expect(frame[2]).toContain('beta beta…');
    expect(frame[3]).toContain('└──────────┘');
  });

  it('renders rounded framed rows with internal padding', () => {
    const frame = renderRendererFrameRows({
      content: ['alpha', 'beta beta beta'],
      width: 14,
      height: 4,
      borderKind: 'rounded',
      paddingX: 2,
      borderStyle: (text) => `\u001B[34m${text}\u001B[0m`,
      ellipsis: '…',
    });

    expect(frame).toHaveLength(4);
    expect(frame.map((line) => measureAnsiDisplayWidth(line))).toEqual([14, 14, 14, 14]);
    const plain = frame.map((line) => line.replaceAll(/\u001B\[[0-9;]*m/g, ''));
    expect(plain[0]).toBe('╭────────────╮');
    expect(plain[1]).toContain('│  alpha');
    expect(plain[2]).toContain('│  beta be…');
    expect(plain[3]).toBe('╰────────────╯');
  });

  it('renders framed rows with asymmetric internal padding', () => {
    const frame = renderRendererFrameRows({
      content: ['alpha', 'beta beta beta'],
      width: 14,
      height: 4,
      borderKind: 'rounded',
      paddingLeft: 2,
      paddingRight: 0,
      ellipsis: '…',
    });

    expect(frame).toEqual([
      '╭────────────╮',
      '│  alpha     │',
      '│  beta beta…│',
      '╰────────────╯',
    ]);
    expect(frame.map((line) => measureAnsiDisplayWidth(line))).toEqual([14, 14, 14, 14]);
  });

  it('renders flush frame titles without adding a leading rule', () => {
    const frame = renderRendererFrameRows({
      title: ' Usage ',
      titlePlacement: 'flush',
      borderKind: 'rounded',
      content: ['tokens'],
      width: 12,
      height: 3,
      paddingX: 1,
      borderStyle: (text) => `\u001B[35m${text}\u001B[0m`,
      ellipsis: '…',
    });

    const plain = frame.map((line) => line.replaceAll(/\u001B\[[0-9;]*m/g, ''));
    expect(plain).toEqual(['╭ Usage ───╮', '│ tokens   │', '╰──────────╯']);
    expect(frame.map((line) => measureAnsiDisplayWidth(line))).toEqual([12, 12, 12]);
  });

  it('renders open-bottom frames for panels attached to another surface', () => {
    const frame = renderRendererFrameRows({
      title: ' BTW ',
      titlePlacement: 'flush',
      borderKind: 'rounded',
      bottomBorder: false,
      content: ['answer'],
      width: 12,
      height: 2,
      paddingX: 1,
      ellipsis: '…',
    });

    expect(frame).toEqual(['╭ BTW ─────╮', '│ answer   │']);
    expect(frame.map((line) => measureAnsiDisplayWidth(line))).toEqual([12, 12]);
  });

  it('fits frame titles without counting ANSI escapes as display width', () => {
    const fitted = fitRendererFrameTitle('\u001B[31mabcdef\u001B[0m', 4, '');

    expect(measureAnsiDisplayWidth(fitted)).toBe(4);
    expect(fitted).toContain('\u001B[31m');
  });

  it('exposes frame title dimensions to stable scrollable frame titles', () => {
    const viewport = new RendererStableScrollableLineViewport();
    let titleWidth = -1;
    let frameWidth = -1;
    let projectionOverflow: boolean | undefined;
    const frame = renderRendererStableScrollableFrameRows({
      viewport,
      title: (context) => {
        titleWidth = context.titleWidth;
        frameWidth = context.frameWidth;
        projectionOverflow = context.projection.hasOverflow;
        return fitRendererFrameTitle('1234567890', context.titleWidth, '');
      },
      titlePlacement: 'flush',
      borderKind: 'rounded',
      bottomBorder: false,
      body: ['body'],
      width: 10,
      ellipsis: '…',
    });

    expect({ titleWidth, frameWidth, projectionOverflow }).toEqual({
      titleWidth: 8,
      frameWidth: 10,
      projectionOverflow: false,
    });
    expect(frame.rows).toEqual(['╭12345678╮', '│body    │']);
    expect(frame.rows.map((line) => measureAnsiDisplayWidth(line))).toEqual([10, 10]);
  });

  it('fits generic renderer lines to exact display width', () => {
    const fitted = fitRendererLineToWidth('\u001B[32mabcdef\u001B[0m', 5, '…');

    expect(measureAnsiDisplayWidth(fitted)).toBe(5);
    expect(fitted).toContain('\u001B[32m');
  });

  it('renders aligned footer rows with optional right-side position text', () => {
    expect(renderRendererFooterRow({
      width: 22,
      left: ' keys',
      right: ' 1-2 / 4 (50%) ',
    })).toBe(' keys   1-2 / 4 (50%) ');

    expect(renderRendererFooterRow({
      width: 6,
      left: ' abcdefgh',
      right: ' 1-2 ',
      ellipsis: '…',
    })).toBe(' abcd…');
  });

  it('formats scroll position metadata for viewer footers', () => {
    expect(formatRendererScrollPosition({
      lineFrom: 3,
      lineTo: 4,
      contentRows: 9,
      scrollPercent: 25,
    })).toBe(' 3-4 / 9 (25%) ');
  });

  it('renders scrollable frame rows with reusable viewport projection', () => {
    const viewport = new RendererScrollableLineViewport({
      contentRows: 4,
      viewportRows: 2,
    });
    const first = renderRendererScrollableFrameRows({
      viewport,
      body: ['one', 'two', 'three', 'four'],
      height: 4,
      width: 12,
      paddingX: 1,
      fill: '',
      formatLine: ({ line, contentWidth, sourceIndex }) =>
        fitRendererLineToWidth(`${String(sourceIndex + 1)}:${line}`, contentWidth, '…'),
      ellipsis: '…',
    });

    expect(first).toMatchObject({
      contentRows: 4,
      viewportRows: 2,
      start: 0,
      end: 2,
      lineFrom: 1,
      lineTo: 2,
      hasOverflow: true,
      contentWidth: 8,
    });
    expect(first.rows).toEqual([
      '┌──────────┐',
      '│ 1:one    │',
      '│ 2:two    │',
      '└──────────┘',
    ]);
    expect(first.rows.map((line) => measureAnsiDisplayWidth(line))).toEqual([12, 12, 12, 12]);

    viewport.scroll('end');
    const second = renderRendererScrollableFrameRows({
      viewport,
      body: ['one', 'two', 'three', 'four'],
      height: 4,
      width: 12,
      paddingX: 1,
      fill: '',
      ellipsis: '…',
    });

    expect(second.lines).toEqual(['three', 'four']);
    expect(second.lineFrom).toBe(3);
    expect(second.lineTo).toBe(4);
  });

  it('renders stable scrollable body rows inside a reusable frame', () => {
    const viewport = new RendererStableScrollableLineViewport();
    const first = renderRendererStableScrollableFrameRows({
      viewport,
      title: (projection) => ` BTW ${projection.hasOverflow ? 'scroll ' : ''}`,
      titlePlacement: 'flush',
      borderKind: 'rounded',
      bottomBorder: false,
      body: ['question', 'thinking 1', 'thinking 2'],
      maxViewportRows: 4,
      fill: '',
      width: 16,
      paddingX: 1,
      ellipsis: '…',
    });

    expect(first.lines).toEqual(['question', 'thinking 1', 'thinking 2']);
    expect(first.rows).toEqual([
      '╭ BTW ─────────╮',
      '│ question     │',
      '│ thinking 1   │',
      '│ thinking 2   │',
    ]);

    const second = renderRendererStableScrollableFrameRows({
      viewport,
      title: (projection) => ` BTW ${projection.hasOverflow ? 'scroll ' : ''}`,
      titlePlacement: 'flush',
      borderKind: 'rounded',
      bottomBorder: false,
      body: ['question', 'final'],
      maxViewportRows: 4,
      fill: '',
      width: 16,
      paddingX: 1,
      ellipsis: '…',
    });

    expect(second.lines).toEqual(['question', 'final', '']);
    expect(second.rows).toEqual([
      '╭ BTW ─────────╮',
      '│ question     │',
      '│ final        │',
      '│              │',
    ]);

    const capped = renderRendererStableScrollableFrameRows({
      viewport,
      title: (projection) => ` BTW ${projection.hasOverflow ? 'scroll ' : ''}`,
      titlePlacement: 'flush',
      borderKind: 'rounded',
      bottomBorder: false,
      body: ['a', 'b', 'c', 'd', 'e'],
      maxViewportRows: 2,
      fill: '',
      width: 16,
      paddingX: 1,
      ellipsis: '…',
    });

    expect(capped.hasOverflow).toBe(true);
    expect(capped.rows).toEqual([
      '╭ BTW scroll ──╮',
      '│ d            │',
      '│ e            │',
    ]);
  });

  it('exposes renderer-owned focus and cursor marker contracts', () => {
    const focusable = {
      focused: false,
      invalidate: () => {},
      render: () => [CURSOR_MARKER],
    };

    expect(CURSOR_MARKER).toBe('\u001B_pi:c\u0007');
    expect(isFocusable(focusable)).toBe(true);
    expect(isFocusable(new Text('plain', 0, 0))).toBe(false);
    expect(isFocusable(null)).toBe(false);
  });

  it('projects cursor markers into terminal cursor state and cleans inverse cells', () => {
    const line = `ab${CURSOR_MARKER}\u001B[7mc\u001B[0md`;
    const projection = projectRendererCursorMarkerLine({
      line,
      x: 3,
      y: 4,
      viewport: { x: 0, y: 0, width: 10, height: 10 },
    });

    expect(projection.cursor).toEqual({ x: 5, y: 4, visible: true });
    expect(projection.cells.map((cell) => cell.char).join('')).toBe('abcd');
    expect(projection.cells[2]?.style?.inverse).toBeUndefined();

    const region = projectRendererCursorMarkerLines({
      lines: ['top', line],
      rect: { x: 1, y: 2, width: 8, height: 2 },
      viewport: { x: 0, y: 0, width: 10, height: 10 },
    });

    expect(region.cursor).toEqual({ x: 3, y: 3, visible: true });
    expect(region.lines[0]).toBe('top');
    expect((region.lines[1] as RendererCell[]).map((cell) => cell.char).join('')).toBe('abcd');

    expect(projectRendererCursorMarkerLines({
      lines: [line],
      rect: { x: 20, y: 0, width: 8, height: 1 },
      viewport: { x: 0, y: 0, width: 10, height: 10 },
    }).cursor).toBeUndefined();
  });

  it('renders and navigates reusable SelectList rows', () => {
    const selected: string[] = [];
    const cancelled: string[] = [];
    const changed: string[] = [];
    const list = new SelectList(
      [
        { value: 'alpha', label: 'alpha', description: 'first item' },
        { value: 'beta', label: 'beta', description: 'second item' },
        { value: 'gamma', label: 'gamma', description: 'third item' },
      ],
      2,
      {
        selectedPrefix: (text) => text,
        selectedText: (text) => `S:${text}`,
        description: (text) => `D:${text}`,
        scrollInfo: (text) => `I:${text}`,
        noMatch: (text) => `N:${text}`,
      },
      { minPrimaryColumnWidth: 8, maxPrimaryColumnWidth: 8 },
    );

    list.onSelect = (item) => selected.push(item.value);
    list.onCancel = () => cancelled.push('cancel');
    list.onSelectionChange = (item) => changed.push(item.value);

    expect(list.render(48)).toEqual([
      'S:❯ alpha   first item',
      '  betaD:    second item',
      'I:  (1/3)',
    ]);
    list.handleInput('\u001B[B');
    expect(list.getSelectedItem()?.value).toBe('beta');
    expect(changed).toEqual(['beta']);
    list.handleInput('\r');
    expect(selected).toEqual(['beta']);
    list.setFilter('g');
    expect(list.getSelectedItem()?.value).toBe('gamma');
    list.handleInput('\u001B');
    expect(cancelled).toEqual(['cancel']);
  });
});

describe('renderer layout constraints', () => {
  it('splits rects with fixed, flex, gap, and margin constraints', () => {
    expect(splitRendererRect({
      rect: { x: 0, y: 0, width: 20, height: 5 },
      direction: 'horizontal',
      margin: { left: 1, right: 1 },
      gap: 1,
      constraints: [layoutLength(4), layoutFlex(), layoutFlex(2)],
    })).toEqual([
      { x: 1, y: 0, width: 4, height: 5 },
      { x: 6, y: 0, width: 4, height: 5 },
      { x: 11, y: 0, width: 8, height: 5 },
    ]);
  });

  it('supports percent, ratio, min, and max constraints', () => {
    expect(splitRendererRect({
      rect: { x: 0, y: 0, width: 12, height: 12 },
      direction: 'vertical',
      gap: 1,
      constraints: [layoutPercent(25), layoutRatio(1, 3), layoutMin(2), layoutMax(3)],
    })).toEqual([
      { x: 0, y: 0, width: 12, height: 2 },
      { x: 0, y: 3, width: 12, height: 3 },
      { x: 0, y: 7, width: 12, height: 2 },
      { x: 0, y: 10, width: 12, height: 2 },
    ]);
  });

  it('resolves nested layout trees for reusable renderer regions', () => {
    const layout = resolveRendererLayoutTree(
      {
        id: 'root',
        direction: 'vertical',
        gap: 1,
        children: [
          { id: 'transcript', constraint: layoutFlex() },
          {
            id: 'footer-area',
            constraint: layoutLength(3),
            direction: 'horizontal',
            gap: 1,
            children: [
              { id: 'editor', constraint: layoutFlex(3) },
              { id: 'status', constraint: layoutLength(5) },
            ],
          },
        ],
      },
      { x: 0, y: 0, width: 20, height: 10 },
    );

    expect(layout.children[0]).toMatchObject({
      id: 'transcript',
      rect: { x: 0, y: 0, width: 20, height: 6 },
    });
    expect(layout.children[1]?.children).toEqual([
      {
        id: 'editor',
        rect: { x: 0, y: 7, width: 14, height: 3 },
        children: [],
      },
      {
        id: 'status',
        rect: { x: 15, y: 7, width: 5, height: 3 },
        children: [],
      },
    ]);
  });
});

describe('RendererCellBuffer', () => {
  it('writes text into bounded cells and tracks damage', () => {
    const buffer = new RendererCellBuffer(6, 3);

    buffer.writeText(1, 1, 'abc', { fg: '#ffffff', bold: true });

    expect(buffer.getCell(0, 1).char).toBe(' ');
    expect(buffer.getCell(1, 1)).toEqual({
      char: 'a',
      style: { fg: '#ffffff', bold: true },
    });
    expect(buffer.getCell(3, 1)).toEqual({
      char: 'c',
      style: { fg: '#ffffff', bold: true },
    });
    expect(buffer.damage).toEqual({ x: 1, y: 1, width: 3, height: 1 });
    expect(buffer.dirtyRowCount).toBe(1);
    expect(buffer.dirtyRowSpans).toEqual([{ y: 1, x: 1, width: 3 }]);
  });

  it('writeAnsiText parses SGR instead of leaking escape bodies as glyphs', () => {
    // Dock panels / status bar emit chalk strings. writeText used to split
    // `\u001B[38;2;…m` into cells, dropping ESC (width 0) and leaving `38;2…`.
    const ansi =
      '\u001B[38;2;90;90;90m\u001B[2m│\u001B[22m\u001B[39m \u001B[38;2;61;155;255mmain\u001B[39m';
    const buffer = new RendererCellBuffer(16, 1);
    buffer.writeAnsiText(0, 0, ansi);

    const chars = Array.from({ length: 16 }, (_, x) => buffer.getCell(x, 0).char).join('');
    expect(chars.startsWith('│ main')).toBe(true);
    expect(chars).not.toContain('38;2');
    expect(chars).not.toContain('[2m');
    expect(chars).not.toContain('22m');
    expect(chars).not.toContain('39m');
    expect(buffer.getCell(0, 0).style?.fg?.toLowerCase()).toBe('#5a5a5a');
    expect(buffer.getCell(0, 0).style?.dim).toBe(true);
    expect(buffer.getCell(2, 0).char).toBe('m');
    expect(buffer.getCell(2, 0).style?.fg?.toLowerCase()).toBe('#3d9bff');
  });

  it('tracks sparse dirty row spans separately from bounding damage', () => {
    const buffer = new RendererCellBuffer(10, 10);

    buffer.writeText(1, 1, 'a');
    buffer.writeText(8, 7, 'b');

    expect(buffer.damage).toEqual({ x: 1, y: 1, width: 8, height: 7 });
    expect(buffer.dirtyRowCount).toBe(2);
    expect(buffer.dirtyRowSpans).toEqual([
      { y: 1, x: 1, width: 1 },
      { y: 7, x: 8, width: 1 },
    ]);
  });

  it('keeps disjoint same-row dirty spans from bridging a clean gap', () => {
    const buffer = new RendererCellBuffer(20, 4);
    buffer.writeText(1, 2, 'L');
    buffer.writeText(18, 2, 'R');

    expect(buffer.damage).toEqual({ x: 1, y: 2, width: 18, height: 1 });
    expect(buffer.dirtyRowCount).toBe(1);
    expect(buffer.dirtyRowSpans).toEqual([
      { y: 2, x: 1, width: 1 },
      { y: 2, x: 18, width: 1 },
    ]);
  });

  it('fillRect damage covers only cells that actually changed', () => {
    const fill = { char: ' ', style: { bg: '#111' } };
    const buffer = new RendererCellBuffer(8, 3, fill);
    buffer.writeText(2, 1, 'ab', { fg: '#fff', bg: '#111' });
    buffer.resetDamage();

    buffer.fillRect({ x: 0, y: 0, width: 8, height: 3 }, fill);

    // Only the two overwritten glyphs — not the whole 8×3 fill rect.
    expect(buffer.damage).toEqual({ x: 2, y: 1, width: 2, height: 1 });
  });

  it('clips writes outside the buffer', () => {
    const buffer = new RendererCellBuffer(4, 2);

    buffer.writeText(-2, 0, 'abcd');
    buffer.writeText(2, 1, 'wxyz');

    expect(rowText(buffer, 0)).toBe('cd  ');
    expect(rowText(buffer, 1)).toBe('  wx');
    expect(buffer.damage).toEqual({ x: 0, y: 0, width: 4, height: 2 });
  });

  it('writes CJK and emoji clusters as wide cells with continuation markers', () => {
    const buffer = new RendererCellBuffer(6, 1);

    buffer.writeText(0, 0, '한a👩‍💻');

    expect(buffer.getCell(0, 0)).toEqual({ char: '한', width: 2 });
    expect(buffer.getCell(1, 0)).toEqual({ char: '', width: 0, continuation: true });
    expect(buffer.getCell(2, 0)).toEqual({ char: 'a' });
    expect(buffer.getCell(3, 0)).toEqual({ char: '👩‍💻', width: 2 });
    expect(buffer.getCell(4, 0)).toEqual({ char: '', width: 0, continuation: true });
    expect(buffer.getCell(5, 0)).toEqual({ char: ' ' });
    expect(buffer.damage).toEqual({ x: 0, y: 0, width: 5, height: 1 });
  });

  it('drops wide clusters that would cross the right edge', () => {
    const buffer = new RendererCellBuffer(3, 1);

    buffer.writeText(0, 0, 'ab한');

    expect(rowText(buffer, 0)).toBe('ab ');
    expect(buffer.getCell(2, 0)).toEqual({ char: ' ' });
  });

  it('writes a wide cluster flush against the right buffer edge', () => {
    const buffer = new RendererCellBuffer(4, 1);

    buffer.writeText(0, 0, 'a한');

    expect(rowText(buffer, 0)).toBe('a한 ');
    expect(buffer.getCell(1, 0)).toEqual({ char: '한', width: 2 });
    expect(buffer.getCell(2, 0)).toEqual({ char: '', width: 0, continuation: true });
    expect(buffer.getCell(3, 0)).toEqual({ char: ' ' });
  });

  it('creates human-readable visual snapshots with style and link runs', () => {
    const buffer = new RendererCellBuffer(6, 2);

    buffer.writeText(0, 0, '한a', { fg: '#ff0000', bold: true });
    buffer.setCell(4, 0, { char: 'z', link: 'https://example.test' });
    buffer.writeText(0, 1, 'plain');

    const snapshot = snapshotRendererCellBuffer(buffer);

    expect(snapshot).toEqual({
      width: 6,
      height: 2,
      lines: ['한a z ', 'plain '],
      styles: [
        { y: 0, x: 0, width: 3, style: { fg: '#ff0000', bold: true } },
        { y: 0, x: 4, width: 1, link: 'https://example.test' },
      ],
    });
    expect(formatRendererCellSnapshot(snapshot)).toBe([
      'RendererCellSnapshot 6x2',
      '|한a z |',
      '|plain |',
      'styles:',
      '  y0 x0..2 fg=#ff0000 bold',
      '  y0 x4..4 link=https://example.test',
    ].join('\n'));
  });

  it('diffs visual snapshots by text lines and style runs', () => {
    const expected = new RendererCellBuffer(5, 1);
    const actual = new RendererCellBuffer(5, 1);

    expected.writeText(0, 0, 'hello');
    actual.writeText(0, 0, 'hallo', { fg: '#00ff00' });

    const diff = diffRendererCellSnapshots(
      snapshotRendererCellBuffer(expected),
      snapshotRendererCellBuffer(actual),
    );

    expect(diff.equal).toBe(false);
    expect(diff.changes).toEqual([
      { kind: 'line', y: 0, expected: 'hello', actual: 'hallo' },
      { kind: 'style', expected: '', actual: 'y0 x0..4 fg=#00ff00' },
    ]);
    expect(formatRendererCellSnapshotDiff(diff, { maxChanges: 1 })).toBe([
      'Renderer cell snapshot mismatch: 2 changes.',
      'line y0:',
      '  - hello',
      '  + hallo',
      '... 1 more',
    ].join('\n'));
  });
});

describe('diffCellBuffers', () => {
  it('plans sparse dirty-row damage with scan and damage ratios', () => {
    const plan = planRendererDamage({
      width: 10,
      height: 10,
      damage: { x: 0, y: 0, width: 10, height: 10 },
      dirtyRows: [
        { y: 9, x: 9, width: 1 },
        { y: 0, x: 0, width: 1 },
        { y: 0, x: 1, width: 1 },
      ],
    });

    expect(plan).toMatchObject({
      strategy: 'dirty-rows',
      damage: { x: 0, y: 0, width: 10, height: 10 },
      dirtyRows: 2,
      scannedCells: 3,
      scannedRows: 2,
      totalCells: 100,
      scanRatio: 0.03,
      damageCells: 100,
      damageRatio: 1,
    });
    expect(plan.spans).toEqual([
      { y: 0, x: 0, width: 2 },
      { y: 9, x: 9, width: 1 },
    ]);
  });

  it('keeps disjoint same-row dirty spans split (no pierce-through merge)', () => {
    const plan = planRendererDamage({
      width: 200,
      height: 10,
      damage: { x: 0, y: 0, width: 200, height: 10 },
      dirtyRows: [
        { y: 4, x: 0, width: 20 },
        { y: 4, x: 180, width: 20 },
      ],
    });

    expect(plan.spans).toEqual([
      { y: 4, x: 0, width: 20 },
      { y: 4, x: 180, width: 20 },
    ]);
    expect(plan.scannedCells).toBe(40);
    expect(plan.dirtyRows).toBe(2);
  });

  it('clips damage plans to the renderer bounds', () => {
    const plan = planRendererDamage({
      width: 4,
      height: 3,
      damage: { x: 1, y: 1, width: 10, height: 10 },
    });

    expect(plan).toMatchObject({
      strategy: 'damage-rect',
      damage: { x: 1, y: 1, width: 3, height: 2 },
      scannedCells: 6,
      scannedRows: 2,
      scanRatio: 0.5,
      damageCells: 6,
      damageRatio: 0.5,
    });
  });

  it('scans only the supplied damage rectangle and emits changed cells', () => {
    const previous = new RendererCellBuffer(10, 4);
    const next = new RendererCellBuffer(10, 4);
    previous.writeText(8, 3, 'z');
    next.copyFrom(previous);
    next.resetDamage();
    next.writeText(2, 1, 'h');

    const diff = diffCellBuffers(previous, next, { damage: next.damage });

    expect(diff.damage).toEqual({ x: 2, y: 1, width: 1, height: 1 });
    expect(diff.scanStrategy).toBe('damage-rect');
    expect(diff.scannedCells).toBe(1);
    expect(diff.scannedRows).toBe(1);
    expect(diff.dirtyRows).toBe(0);
    expect(diff.scanRatio).toBe(1 / 40);
    expect(diff.damageCells).toBe(1);
    expect(diff.damageRatio).toBe(1 / 40);
    expect(diff.patches).toEqual([{ x: 2, y: 1, cell: { char: 'h' } }]);
  });

  it('uses dirty row spans to skip clean rows inside large damage bounds', () => {
    const previous = new RendererCellBuffer(10, 10);
    const next = new RendererCellBuffer(10, 10);
    next.writeText(0, 0, 'a');
    next.writeText(9, 9, 'b');

    const diff = diffCellBuffers(previous, next, {
      damage: next.damage,
      dirtyRows: next.dirtyRowSpans,
    });
    const fallback = diffCellBuffers(previous, next, { damage: next.damage });

    expect(diff.damage).toEqual({ x: 0, y: 0, width: 10, height: 10 });
    expect(diff.scanStrategy).toBe('dirty-rows');
    expect(diff.scannedCells).toBe(2);
    expect(diff.scannedRows).toBe(2);
    expect(diff.dirtyRows).toBe(2);
    expect(diff.scanRatio).toBe(0.02);
    // damageCells tracks rewrite coverage (not the bounding damage rect).
    expect(diff.damageCells).toBe(2);
    expect(diff.damageRatio).toBe(0.02);
    expect(diff.patches.map((patch) => [patch.x, patch.y, patch.cell.char])).toEqual([
      [0, 0, 'a'],
      [9, 9, 'b'],
    ]);
    expect(fallback.scanStrategy).toBe('damage-rect');
    // Checksum skip: only 2 changed rows are scanned (20 cells), not all 100.
    expect(fallback.scannedCells).toBe(20);
    expect(fallback.scannedRows).toBe(10);
    expect(fallback.dirtyRows).toBe(0);
    expect(fallback.damageCells).toBe(2);
    expect(fallback.damageRatio).toBe(0.02);
  });

  it('force scans the full frame but only patches cells that actually changed', () => {
    const previous = new RendererCellBuffer(2, 2);
    const next = new RendererCellBuffer(2, 2);
    next.writeText(0, 0, 'A');

    const diff = diffCellBuffers(previous, next, { force: true, damage: next.damage });

    expect(diff.force).toBe(true);
    expect(diff.scanStrategy).toBe('full-frame');
    expect(diff.scannedCells).toBe(4);
    expect(diff.scannedRows).toBe(2);
    expect(diff.dirtyRows).toBe(0);
    // Equal empty cells must not be re-emitted — that was whole-screen flicker.
    expect(diff.patches).toEqual([{ x: 0, y: 0, cell: { char: 'A' } }]);
  });

  it('rewriteUnchanged re-emits equal cells for terminal resync', () => {
    const previous = new RendererCellBuffer(2, 1);
    const next = new RendererCellBuffer(2, 1);
    previous.writeText(0, 0, 'AB');
    next.writeText(0, 0, 'AB');

    const soft = diffCellBuffers(previous, next, { force: true });
    expect(soft.scannedCells).toBe(2);
    expect(soft.patches).toHaveLength(0);

    const hard = diffCellBuffers(previous, next, { force: true, rewriteUnchanged: true });
    expect(hard.patches).toHaveLength(2);
  });

  it('keeps soft-force damage ratio on rewrite coverage, not full-frame scan size', () => {
    const previous = new RendererCellBuffer(80, 24);
    const next = new RendererCellBuffer(80, 24);
    previous.writeText(0, 0, 'idle');
    next.writeText(0, 0, 'idle');
    next.writeText(10, 5, '*');

    const diff = diffCellBuffers(previous, next, { force: true });

    expect(diff.scanStrategy).toBe('full-frame');
    expect(diff.scannedCells).toBe(80 * 24);
    expect(diff.changedCells).toBe(1);
    expect(diff.damageCells).toBe(1);
    expect(diff.damageRatio).toBeCloseTo(1 / (80 * 24));
    expect(diff.patches).toEqual([{ x: 10, y: 5, cell: { char: '*' } }]);
  });

  it('treats hyperlink metadata changes as changed cells', () => {
    const previous = new RendererCellBuffer(1, 1);
    const next = new RendererCellBuffer(1, 1);
    previous.setCell(0, 0, { char: 'x' });
    next.setCell(0, 0, { char: 'x', link: 'https://example.com' });

    const diff = diffCellBuffers(previous, next, { damage: next.damage });

    expect(diff.changedCells).toBe(1);
    expect(diff.patches).toEqual([
      { x: 0, y: 0, cell: { char: 'x', link: 'https://example.com' } },
    ]);
  });

  it('coalesces adjacent row patches into render runs', () => {
    const previous = new RendererCellBuffer(8, 2);
    const next = new RendererCellBuffer(8, 2);
    next.writeText(1, 0, 'abc');
    next.writeText(5, 0, 'de');
    next.writeText(0, 1, 'z');

    const diff = diffCellBuffers(previous, next, { damage: next.damage });
    const runs = coalesceCellPatches(diff.patches);

    expect(runs.map((run) => [run.x, run.y, run.cells.map((cell) => cell.char).join('')])).toEqual(
      [
        [1, 0, 'abc'],
        [5, 0, 'de'],
        [0, 1, 'z'],
      ],
    );
  });

  it('bridges short same-row gaps into optimized render runs without changing patch counts', () => {
    const previous = new RendererCellBuffer(6, 1);
    const next = new RendererCellBuffer(6, 1);
    previous.writeText(0, 0, 'a12d');
    next.writeText(0, 0, 'b12e');

    const diff = diffCellBuffers(previous, next, {
      damage: next.damage,
      runOptimization: { maxGapCells: 2 },
    });

    expect(diff.changedCells).toBe(2);
    expect(diff.patches.map((patch) => [patch.x, patch.cell.char])).toEqual([
      [0, 'b'],
      [3, 'e'],
    ]);
    expect(diff.bridgedCells).toBe(2);
    expect(diff.outputCells).toBe(4);
    expect(diff.renderRuns).toBe(1);
    expect(diff.runs?.map((run) => [run.x, run.cells.map((cell) => cell.char).join('')])).toEqual([
      [0, 'b12e'],
    ]);
  });

  it('keeps optimized render runs split when same-row gaps exceed the bridge budget', () => {
    const previous = new RendererCellBuffer(8, 1);
    const next = new RendererCellBuffer(8, 1);
    previous.writeText(0, 0, 'a123d');
    next.writeText(0, 0, 'b123e');

    const diff = diffCellBuffers(previous, next, {
      damage: next.damage,
      runOptimization: { maxGapCells: 2 },
    });

    expect(diff.changedCells).toBe(2);
    expect(diff.bridgedCells).toBe(0);
    expect(diff.renderRuns).toBe(2);
    expect(diff.runs?.map((run) => [run.x, run.cells.map((cell) => cell.char).join('')])).toEqual([
      [0, 'b'],
      [4, 'e'],
    ]);
  });

  it('bridges complete wide-character gaps without splitting continuation cells', () => {
    const previous = new RendererCellBuffer(6, 1);
    const next = new RendererCellBuffer(6, 1);
    previous.writeText(0, 0, 'a한d');
    next.writeText(0, 0, 'b한e');

    const diff = diffCellBuffers(previous, next, {
      damage: next.damage,
      runOptimization: { maxGapCells: 2 },
    });

    expect(diff.bridgedCells).toBe(2);
    expect(diff.renderRuns).toBe(1);
    expect(diff.runs?.[0]?.cells).toEqual([
      { char: 'b' },
      { char: '한', width: 2 },
      { char: '', width: 0, continuation: true },
      { char: 'e' },
    ]);
    expect(encodeTerminalFrame(diff)).toBe('\u001B[1;1Hb한e');
  });

  it('encodes wide clusters anchored at the right edge without continuation desync', () => {
    const previous = new RendererCellBuffer(4, 1);
    const next = new RendererCellBuffer(4, 1);
    next.writeText(0, 0, 'a한');
    const diff = diffCellBuffers(previous, next);

    expect(encodeTerminalFrame(diff)).toBe('\u001B[1;1Ha한');
  });

  it('does not bridge styled gaps that would add extra style transitions', () => {
    const frame = new RendererCellBuffer(6, 1);
    frame.writeText(0, 0, 'b12e');
    frame.setCell(1, 0, { char: '1', style: { fg: '#ff0000' } });
    const plan = coalesceCellPatchesWithFrameGaps(
      [
        { x: 0, y: 0, cell: { char: 'b' } },
        { x: 3, y: 0, cell: { char: 'e' } },
      ],
      frame,
      { maxGapCells: 2 },
    );

    expect(plan.bridgedCells).toBe(0);
    expect(plan.runs.map((run) => [run.x, run.cells.map((cell) => cell.char).join('')])).toEqual([
      [0, 'b'],
      [3, 'e'],
    ]);
  });

  it('exposes the gap-bridging run planner for callers that already own a frame buffer', () => {
    const frame = new RendererCellBuffer(6, 1);
    frame.writeText(0, 0, 'b12e');
    const plan = coalesceCellPatchesWithFrameGaps(
      [
        { x: 0, y: 0, cell: { char: 'b' } },
        { x: 3, y: 0, cell: { char: 'e' } },
      ],
      frame,
      { maxGapCells: 2 },
    );

    expect(plan).toEqual({
      runs: [{ x: 0, y: 0, cells: [{ char: 'b' }, { char: '1' }, { char: '2' }, { char: 'e' }] }],
      outputCells: 4,
      bridgedCells: 2,
    });
  });
});

describe('RendererDoubleBuffer', () => {
  it('presents sparse row changes without scanning clean rows between them', () => {
    const buffers = new RendererDoubleBuffer(10, 10);

    buffers.beginFrame({ clear: false });
    buffers.next.writeText(0, 0, 'a');
    buffers.next.writeText(9, 9, 'b');
    const diff = buffers.present();

    expect(diff.damage).toEqual({ x: 0, y: 0, width: 10, height: 10 });
    expect(diff.scannedCells).toBe(2);
    expect(diff.scannedRows).toBe(2);
    expect(diff.dirtyRows).toBe(2);
  });

  it('presents changed cells once and keeps the current frame in sync', () => {
    const buffers = new RendererDoubleBuffer(5, 2);

    buffers.beginFrame({ clear: false });
    buffers.next.writeText(1, 0, 'go');
    const first = buffers.present();
    const second = buffers.present();

    expect(first.patches.map((patch) => [patch.x, patch.y, patch.cell.char])).toEqual([
      [1, 0, 'g'],
      [2, 0, 'o'],
    ]);
    expect(second.patches).toHaveLength(0);
    expect(rowText(buffers.current, 0)).toBe(' go  ');
  });

  it('keeps next buffer aligned after present so clear:false compares against the last frame', () => {
    const buffers = new RendererDoubleBuffer(4, 1);
    buffers.beginFrame({ clear: false });
    buffers.next.writeText(0, 0, 'ab');
    buffers.present();

    buffers.beginFrame({ clear: false });
    // Idempotent rewrite of the same glyphs must not dirt or patch.
    buffers.next.writeText(0, 0, 'ab');
    const quiet = buffers.present();
    expect(quiet.patches).toHaveLength(0);
    expect(rowText(buffers.current, 0)).toBe('ab  ');
    expect(rowText(buffers.next, 0)).toBe('ab  ');
  });

  it('copy-on-writes shared present buffers only on the first mutating write', () => {
    const buffers = new RendererDoubleBuffer(4, 1);
    buffers.beginFrame({ clear: false });
    buffers.next.writeText(0, 0, 'ab');
    buffers.present();

    buffers.beginFrame({ clear: false });
    // Shared until mutation — quiet present must stay zero-patch.
    expect(buffers.present().patches).toHaveLength(0);

    buffers.beginFrame({ clear: false });
    buffers.next.writeText(0, 0, 'xy');
    const changed = buffers.present();
    expect(changed.patches.map((p) => p.cell.char)).toEqual(['x', 'y']);
    expect(rowText(buffers.current, 0)).toBe('xy  ');
    expect(rowText(buffers.next, 0)).toBe('xy  ');
  });
});

describe('terminal output encoder', () => {
  it('encodes changed cells as cursor-addressed synchronized terminal output', () => {
    const previous = new RendererCellBuffer(6, 2);
    const next = new RendererCellBuffer(6, 2);
    next.writeText(1, 0, 'ab', { fg: '#0f0', bold: true });
    const diff = diffCellBuffers(previous, next, { damage: next.damage });

    expect(
      encodeTerminalFrame(diff, {
        synchronized: true,
        hideCursor: true,
        showCursor: true,
      }),
    ).toBe(
      [
        ANSI_BEGIN_SYNCHRONIZED_UPDATE,
        ANSI_HIDE_CURSOR,
        '\u001B[1;2H',
        '\u001B[0;1;38;2;0;255;0m',
        'ab',
        ANSI_RESET_STYLE,
        ANSI_SHOW_CURSOR,
        ANSI_END_SYNCHRONIZED_UPDATE,
      ].join(''),
    );
  });

  it('uses optimized render runs to avoid extra cursor-addressed jumps', () => {
    const previous = new RendererCellBuffer(6, 1);
    const next = new RendererCellBuffer(6, 1);
    previous.writeText(0, 0, 'a12d');
    next.writeText(0, 0, 'b12e');
    const diff = diffCellBuffers(previous, next, {
      damage: next.damage,
      runOptimization: { maxGapCells: 2 },
    });

    expect(encodeTerminalFrame(diff)).toBe('\u001B[1;1Hb12e');
    expect(encodeTerminalRuns(coalesceCellPatches(diff.patches))).toBe('\u001B[1;1Hb\u001B[1;4He');
  });

  it('can use relative cursor motion between same-row render runs', () => {
    const runs = [
      { x: 0, y: 0, cells: [{ char: 'a' }] },
      { x: 3, y: 0, cells: [{ char: 'b' }] },
      { x: 8, y: 0, cells: [{ char: 'c' }] },
      { x: 1, y: 1, cells: [{ char: 'd' }] },
    ];

    expect(encodeTerminalRuns(runs, { cursorMotion: 'relative' })).toBe(
      '\u001B[1;1Ha\u001B[2Cb\u001B[4Cc\u001B[2;2Hd',
    );
    expect(encodeTerminalRuns(runs, { cursorMotion: 'auto' })).toBe(
      '\u001B[1;1Ha\u001B[2Cb\u001B[4Cc\u001B[2;2Hd',
    );
    expect(cursorForward(1)).toBe('\u001B[C');
    expect(cursorForward(3)).toBe('\u001B[3C');
  });

  it('reports cursor-motion metrics and saved cursor bytes', () => {
    const encoded = encodeTerminalRunsWithMetrics([
      { x: 0, y: 0, cells: [{ char: 'a' }] },
      { x: 3, y: 0, cells: [{ char: 'b' }] },
      { x: 8, y: 0, cells: [{ char: 'c' }] },
    ], { cursorMotion: 'auto' });

    expect(encoded.output).toBe('\u001B[1;1Ha\u001B[2Cb\u001B[4Cc');
    expect(encoded.cursorMotion).toEqual({
      absoluteMoves: 1,
      relativeMoves: 2,
      horizontalAbsoluteMoves: 0,
      moveBytes: '\u001B[1;1H\u001B[2C\u001B[4C'.length,
      absoluteMoveBytes: '\u001B[1;1H\u001B[1;4H\u001B[1;9H'.length,
      savedBytes: '\u001B[1;4H'.length - '\u001B[2C'.length +
        '\u001B[1;9H'.length - '\u001B[4C'.length,
    });
  });

  it('keeps absolute cursor motion when relative motion would not be shorter', () => {
    expect(encodeTerminalRuns([
      { x: 0, y: 0, cells: [{ char: 'a' }] },
      { x: 1, y: 0, cells: [{ char: 'b' }] },
    ], { cursorMotion: 'auto' })).toBe('\u001B[1;1Hab');
    expect(encodeTerminalRuns([
      { x: 0, y: 0, cells: [{ char: 'a' }] },
      { x: 1, y: 0, cells: [{ char: 'b' }] },
    ], { cursorMotion: 'absolute' })).toBe('\u001B[1;1Ha\u001B[1;2Hb');
  });

  it('uses cursor-motion planning for final managed cursor placement', () => {
    expect(encodeTerminalRuns([
      { x: 0, y: 0, cells: [{ char: 'o' }, { char: 'k' }] },
    ], {
      cursor: { x: 1, y: 0, visible: true, shape: 'bar', blinking: false },
      cursorMotion: 'auto',
    })).toBe('\u001B[1;1Hok\u001B[6 q\u001B[D\u001B[?25h');

    expect(encodeTerminalRuns([], {
      cursor: { x: 5, y: 0, visible: true },
      previousCursor: { x: 2, y: 0, visible: true },
      cursorMotion: 'auto',
    })).toBe('\u001B[3C\u001B[?25h');
  });

  it('plans backward, vertical, and horizontal-absolute cursor moves when cheaper', () => {
    expect(encodeTerminalRuns([
      { x: 5, y: 0, cells: [{ char: 'a' }] },
      { x: 2, y: 0, cells: [{ char: 'b' }] },
      { x: 3, y: 3, cells: [{ char: 'c' }] },
      { x: 4, y: 1, cells: [{ char: 'd' }] },
    ], { cursorMotion: 'relative' })).toBe(
      '\u001B[1;6Ha\u001B[4Db\u001B[3Bc\u001B[2Ad',
    );

    expect(encodeTerminalRuns([
      { x: 100, y: 0, cells: [{ char: 'a' }] },
      { x: 0, y: 0, cells: [{ char: 'b' }] },
    ], { cursorMotion: 'auto' })).toBe('\u001B[1;101Ha\u001B[Gb');
    expect(cursorBackward(2)).toBe('\u001B[2D');
    expect(cursorDown(2)).toBe('\u001B[2B');
    expect(cursorUp(2)).toBe('\u001B[2A');
    expect(cursorHorizontalAbsolute(0)).toBe('\u001B[G');
    expect(cursorHorizontalAbsolute(23)).toBe('\u001B[24G');
  });

  it('emits style changes only when adjacent cells require them', () => {
    const output = encodeTerminalRuns([
      {
        x: 0,
        y: 0,
        cells: [
          { char: 'a', style: { fg: '#ff0000' } },
          { char: 'b', style: { fg: '#ff0000' } },
          { char: 'c' },
        ],
      },
    ]);

    expect(output).toBe('\u001B[1;1H\u001B[0;38;2;255;0;0mab\u001B[0mc');
  });

  it('can erase plain trailing row blanks instead of writing every space', () => {
    expect(encodeTerminalRuns([
      {
        x: 0,
        y: 0,
        cells: [
          { char: 'o' },
          { char: 'k' },
          { char: ' ' },
          { char: ' ' },
          { char: ' ' },
          { char: ' ' },
          { char: ' ' },
          { char: ' ' },
        ],
      },
    ], {
      eraseLine: true,
      frameWidth: 8,
    })).toBe(`\u001B[1;1Hok${ANSI_ERASE_IN_LINE}`);
  });

  it('does not erase styled trailing blanks or partial runs with unknown row tails', () => {
    expect(encodeTerminalRuns([
      {
        x: 0,
        y: 0,
        cells: [
          { char: 'x' },
          { char: ' ', style: { bg: '#101010' } },
          { char: ' ', style: { bg: '#101010' } },
          { char: ' ', style: { bg: '#101010' } },
          { char: ' ', style: { bg: '#101010' } },
        ],
      },
    ], {
      eraseLine: true,
      frameWidth: 5,
    })).toBe('\u001B[1;1Hx\u001B[0;48;2;16;16;16m    \u001B[0m');
    expect(encodeTerminalRuns([
      {
        x: 0,
        y: 0,
        cells: [
          { char: 'x' },
          { char: ' ' },
          { char: ' ' },
          { char: ' ' },
          { char: ' ' },
        ],
      },
    ], {
      eraseLine: true,
      frameWidth: 8,
    })).toBe('\u001B[1;1Hx    ');
  });

  it('supports origin offsets for nested renderer regions', () => {
    const output = encodeTerminalRuns(
      [{ x: 2, y: 3, cells: [{ char: 'x' }] }],
      { originX: 10, originY: 4 },
    );

    expect(output).toBe('\u001B[8;13Hx');
  });

  it('sanitizes terminal control characters before writing text cells', () => {
    const output = encodeTerminalRuns([{ x: 0, y: 0, cells: [{ char: '\u001B' }] }]);

    expect(output).toBe('\u001B[1;1H ');
  });

  it('preserves wide grapheme clusters and skips continuation cells while encoding', () => {
    const output = encodeTerminalRuns([
      {
        x: 0,
        y: 0,
        cells: [
          { char: '한', width: 2 },
          { char: '', width: 0, continuation: true },
          { char: '👩‍💻', width: 2 },
          { char: '', width: 0, continuation: true },
        ],
      },
    ]);

    expect(output).toBe('\u001B[1;1H한👩‍💻');
    expect(escapeTerminalText('👩‍💻\u001B')).toBe('👩‍💻 ');
    // Full SGR/OSC must be stripped as sequences — never leave `[0;1;38;2…` bodies.
    expect(escapeTerminalText('\u001B[0;1;38;2;230;57;70mhi\u001B[0m')).toBe('hi');
    expect(escapeTerminalText('\u001B[0;1;38;2;230;57;70m')).toBe('');
    expect(escapeTerminalText('\u001B[0;1;38;2;230;57;70m')).not.toContain('38;2');
    expect(escapeTerminalText('\u001B[0;1;38;2;230;57;70m')).not.toContain('[');
  });

  it('encodes short and long hex truecolor styles', () => {
    expect(styleToAnsi({ fg: '#abc', bg: '001122', underline: true })).toBe(
      '\u001B[0;4;38;2;170;187;204;48;2;0;17;34m',
    );
  });

  it('adapts style colors to terminal color modes', () => {
    expect(styleToAnsi({ fg: '#ff0000', bg: '#0000ff' }, { colorMode: 'ansi256' })).toBe(
      '\u001B[0;38;5;196;48;5;21m',
    );
    expect(styleToAnsi({ fg: '#ff0000', bg: '#0000ff' }, { colorMode: 'ansi16' })).toBe(
      '\u001B[0;91;104m',
    );
    expect(styleToAnsi({ fg: '#ff0000', bg: '#0000ff', bold: true }, { colorMode: 'none' })).toBe(
      '\u001B[0;1m',
    );
  });

  it('passes terminal color mode through render-run encoding', () => {
    expect(encodeTerminalRuns([
      {
        x: 0,
        y: 0,
        cells: [
          { char: 'r', style: { fg: '#ff0000' } },
          { char: 'b', style: { bg: '#0000ff' } },
        ],
      },
    ], { colorMode: 'ansi256' })).toBe(
      '\u001B[1;1H\u001B[0;38;5;196mr\u001B[0;48;5;21mb\u001B[0m',
    );
  });

  it('encodes Kitty inline image graphics in protocol-sized chunks', () => {
    const image = encodeKittyInlineImage({
      data: Uint8Array.from([0, 1, 2, 3, 4, 5]),
      format: 'png',
      widthCells: 4,
      heightCells: 2,
      imageId: 7,
      placementId: 3,
      doNotMoveCursor: true,
      chunkSize: 4,
    });

    expect(image).toEqual({
      protocol: 'kitty',
      output: [
        '\u001B_Ga=T,f=100,q=2,i=7,p=3,c=4,r=2,C=1,m=1;AAEC\u001B\\',
        '\u001B_Gm=0;AwQF\u001B\\',
      ].join(''),
      chunks: 2,
      bytes: 6,
    });
    expect(encodeKittyGraphicsCommand({ a: 'd', i: 7 }, '')).toBe('\u001B_Ga=d,i=7;\u001B\\');
    expect(encodeKittyDeleteImages()).toBe('\u001B_Ga=d,d=A,q=2;\u001B\\');
    expect(encodeKittyDeleteImages({ imageId: 7 })).toBe('\u001B_Ga=d,d=I,i=7,q=2;\u001B\\');
    expect(encodeRendererClearInlineImages('iterm2')).toBe('');
  });

  it('encodes iTerm2 inline image payloads and multipart output', () => {
    expect(encodeIterm2InlineImage({
      data: Uint8Array.from([1, 2, 3]),
      widthCells: 5,
      heightPx: 24,
      filename: 'shot.png',
      doNotMoveCursor: true,
    })).toEqual({
      protocol: 'iterm2',
      output: '\u001B]1337;File=inline=1;name=c2hvdC5wbmc=;size=3;width=5;height=24px;doNotMoveCursor=1:AQID\u0007',
      chunks: 1,
      bytes: 3,
    });

    const multipart = encodeRendererInlineImage('iterm2', {
      data: 'QUJDREVG',
      widthCells: 2,
      chunkSize: 4,
    });
    expect(multipart.output).toBe([
      '\u001B]1337;MultipartFile=inline=1;size=6;width=2\u0007',
      '\u001B]1337;FilePart=QUJD\u0007',
      '\u001B]1337;FilePart=REVG\u0007',
      '\u001B]1337;FileEnd\u0007',
    ].join(''));
    expect(multipart.chunks).toBe(2);
  });

  it('calculates bounded inline image row reservations', () => {
    expect(calculateRendererInlineImageRows(
      { widthPx: 800, heightPx: 600 },
      40,
      { widthPx: 9, heightPx: 18 },
    )).toBe(15);
    expect(calculateRendererInlineImageRows(
      { widthPx: 800, heightPx: 600 },
      40,
      { widthPx: 9, heightPx: 18 },
      12,
    )).toBe(12);
  });

  it('encodes cursor shape, position, and visibility without cell patches', () => {
    expect(cursorShapeToAnsi('bar', false)).toBe('\u001B[6 q');
    expect(cursorStateToAnsi({ x: 2, y: 3, visible: true, shape: 'bar', blinking: false })).toBe(
      '\u001B[6 q\u001B[4;3H\u001B[?25h',
    );
    expect(encodeTerminalRuns([], {
      cursor: { x: 1, y: 2, visible: true, shape: 'underline' },
    })).toBe('\u001B[3 q\u001B[3;2H\u001B[?25h');
    expect(encodeTerminalRuns([], {
      cursor: { x: 0, y: 0, visible: false },
    })).toBe(ANSI_HIDE_CURSOR);
  });

  it('encodes OSC 8 hyperlinks and closes them before plain cells', () => {
    const output = encodeTerminalRuns([
      {
        x: 0,
        y: 0,
        cells: [
          { char: 'a', link: 'https://example.com' },
          { char: 'b', link: 'https://example.com' },
          { char: 'c' },
        ],
      },
    ]);

    expect(output).toBe(
      '\u001B[1;1H' +
        hyperlinkToAnsi('https://example.com') +
        'ab' +
        ANSI_END_HYPERLINK +
        'c',
    );
  });

  it('sanitizes OSC 8 hyperlink URIs before encoding', () => {
    expect(hyperlinkToAnsi('https://example.com/\u001B[31m')).toBe(
      '\u001B]8;;https://example.com/[31m\u001B\\',
    );
  });
});

describe('renderer frame output policy', () => {
  it('keeps default synchronized output behavior unless a policy is selected', () => {
    expect(resolveRendererFrameOutputPolicy({
      diff: frameDiff({ changedCells: 0 }),
      cursor: { x: 0, y: 0, visible: true },
      outputOptions: { synchronized: true },
    })).toMatchObject({
      mode: 'cursor-only',
      synchronized: true,
      reason: 'inherited',
    });
  });

  it('maps premium, balanced, and compat profiles to synchronized output decisions', () => {
    const small = frameDiff({ changedCells: 1, damageRatio: 0.01 });
    const large = frameDiff({ changedCells: 40, damageRatio: 0.2 });
    const full = frameDiff({ changedCells: 100, force: true, scanStrategy: 'full-frame' });

    expect(resolveRendererFrameOutputPolicy({
      diff: small,
      outputOptions: { synchronized: true },
      policy: 'premium',
    })).toMatchObject({
      mode: 'partial',
      synchronized: true,
      largeFrame: true,
      reason: 'changed-cells',
      eraseLine: true,
    });
    expect(resolveRendererFrameOutputPolicy({
      diff: small,
      outputOptions: { synchronized: true },
      policy: 'balanced',
    })).toMatchObject({
      mode: 'partial',
      synchronized: false,
      largeFrame: false,
      reason: 'below-threshold',
      eraseLine: true,
    });
    expect(resolveRendererFrameOutputPolicy({
      diff: large,
      outputOptions: { synchronized: true },
      policy: 'balanced',
    })).toMatchObject({
      synchronized: true,
      largeFrame: true,
      reason: 'changed-cells',
    });
    expect(resolveRendererFrameOutputPolicy({
      diff: full,
      outputOptions: { synchronized: true },
      policy: 'balanced',
    })).toMatchObject({
      mode: 'full',
      synchronized: true,
      reason: 'full-frame',
    });
    expect(resolveRendererFrameOutputPolicy({
      diff: large,
      outputOptions: { synchronized: true },
      policy: 'compat',
    })).toMatchObject({
      synchronized: false,
      reason: 'disabled',
      eraseLine: false,
    });
  });

  it('uses optimized output run metrics for auto synchronized output decisions', () => {
    const manyRuns = frameDiff({
      changedCells: 4,
      outputCells: 4,
      renderRuns: 8,
      damageRatio: 0.01,
    });
    const manyOutputCells = frameDiff({
      changedCells: 4,
      outputCells: 64,
      renderRuns: 1,
      bridgedCells: 60,
      damageRatio: 0.01,
    });

    expect(resolveRendererFrameOutputPolicy({
      diff: manyRuns,
      outputOptions: { synchronized: true },
      policy: 'balanced',
    })).toMatchObject({
      mode: 'partial',
      synchronized: true,
      largeFrame: true,
      reason: 'output-runs',
    });
    expect(resolveRendererFrameOutputPolicy({
      diff: manyOutputCells,
      outputOptions: { synchronized: true },
      policy: 'balanced',
    })).toMatchObject({
      mode: 'partial',
      synchronized: true,
      largeFrame: true,
      reason: 'output-cells',
    });
    expect(resolveRendererFrameOutputPolicy({
      diff: manyRuns,
      outputOptions: { synchronized: true },
      policy: {
        profile: 'balanced',
        syncMinOutputRuns: Number.POSITIVE_INFINITY,
        syncMinOutputCells: Number.POSITIVE_INFINITY,
      },
    })).toMatchObject({
      synchronized: false,
      largeFrame: false,
      reason: 'below-threshold',
    });
  });

  it('includes cursor-only frames in auto synchronized output policies', () => {
    expect(resolveRendererFrameOutputPolicy({
      diff: frameDiff({ changedCells: 0 }),
      cursor: { x: 2, y: 0, visible: true },
      outputOptions: { synchronized: true },
      policy: 'premium',
    })).toMatchObject({
      mode: 'cursor-only',
      synchronized: true,
      largeFrame: false,
      reason: 'cursor-only',
    });
  });
});

describe('NativeFrameRenderer', () => {
  it('presents the first frame to an output target as a full redraw', () => {
    const writes: string[] = [];
    const renderer = new NativeFrameRenderer({
      width: 4,
      height: 1,
      output: { write: (chunk) => writes.push(chunk) },
    });

    renderer.beginFrame({ clear: false });
    renderer.writeText(0, 0, 'hi');
    const result = renderer.present();

    expect(result.diff.force).toBe(true);
    expect(result.diff.scannedCells).toBe(4);
    // Trailing empties match the previous buffer — soft-force skips them.
    expect(result.output).toBe('\u001B[1;1Hhi');
    expect(result.bytes).toBe(Buffer.byteLength(result.output));
    expect(writes).toEqual([result.output]);
  });

  it('captures output stream backpressure from write results', () => {
    const renderer = new NativeFrameRenderer({
      width: 4,
      height: 1,
      output: { write: () => false },
    });

    renderer.beginFrame({ clear: false });
    renderer.writeText(0, 0, 'busy');
    const result = renderer.present();

    expect(result.output).toBe('\u001B[1;1Hbusy');
    expect(result.backpressure).toBe(true);
  });

  it('records deterministic diff, encode, write, and present timings', () => {
    const writes: string[] = [];
    let now = 0;
    const renderer = new NativeFrameRenderer({
      width: 2,
      height: 1,
      now: () => now,
      output: {
        write: (chunk) => {
          writes.push(chunk);
          now += 4;
        },
      },
    });

    renderer.beginFrame({ clear: false });
    renderer.writeText(0, 0, 'x');
    now += 1;
    const result = renderer.present();

    expect(result.timing).toEqual({
      diffDurationMs: 0,
      encodeDurationMs: 0,
      writeDurationMs: 4,
      totalDurationMs: 4,
    });
    expect(writes).toEqual([result.output]);
  });

  it('does not write when a subsequent frame has no damage', () => {
    const writes: string[] = [];
    const renderer = new NativeFrameRenderer({
      width: 3,
      height: 1,
      output: { write: (chunk) => writes.push(chunk) },
    });

    renderer.beginFrame({ clear: false });
    renderer.writeText(0, 0, 'ok');
    renderer.present();
    const second = renderer.present();

    expect(second.output).toBe('');
    expect(writes).toHaveLength(1);
  });

  it('writes cursor-only frames and suppresses unchanged cursor frames', () => {
    const writes: string[] = [];
    const renderer = new NativeFrameRenderer({
      width: 4,
      height: 1,
      output: { write: (chunk) => writes.push(chunk) },
    });

    renderer.beginFrame({ clear: false });
    renderer.writeText(0, 0, 'ok');
    renderer.setCursor({ x: 1, y: 0, visible: true, shape: 'bar', blinking: false });
    const first = renderer.present();

    renderer.beginFrame({ clear: false });
    renderer.setCursor({ x: 2, y: 0, visible: true, shape: 'bar', blinking: false });
    const moved = renderer.present();

    renderer.beginFrame({ clear: false });
    renderer.setCursor({ x: 2, y: 0, visible: true, shape: 'bar', blinking: false });
    const same = renderer.present();

    // Soft-force only emits "ok" (not trailing empties), so relative cursor
    // motion is 1 cell back from the run end, not 3.
    expect(first.output).toContain('\u001B[6 q\u001B[D\u001B[?25h');
    expect(moved.output).toBe('\u001B[6 q\u001B[C\u001B[?25h');
    expect(same.output).toBe('');
    expect(writes).toHaveLength(2);
  });

  it('hides a previously managed cursor when a frame omits cursor state', () => {
    const writes: string[] = [];
    const renderer = new NativeFrameRenderer({
      width: 1,
      height: 1,
      output: { write: (chunk) => writes.push(chunk) },
    });

    renderer.beginFrame({ clear: false });
    renderer.setCursor({ x: 0, y: 0, visible: true });
    renderer.present();
    renderer.beginFrame({ clear: false });
    const hidden = renderer.present();

    expect(hidden.output).toBe(ANSI_HIDE_CURSOR);
    expect(writes.at(-1)).toBe(ANSI_HIDE_CURSOR);
  });

  it('clears stale cells through an immediate-mode frame', () => {
    const writes: string[] = [];
    const renderer = new NativeFrameRenderer({
      width: 4,
      height: 1,
      output: { write: (chunk) => writes.push(chunk) },
    });
    renderer.beginFrame({ clear: false });
    renderer.writeText(0, 0, 'old');
    renderer.present();

    renderer.beginFrame();
    renderer.writeText(0, 0, 'n');
    const result = renderer.present();

    expect(result.output).toBe('\u001B[1;1Hn  ');
    expect(writes.at(-1)).toBe(result.output);
  });

  it('bridges short dirty-row gaps by default in native frame output', () => {
    const writes: string[] = [];
    const renderer = new NativeFrameRenderer({
      width: 6,
      height: 1,
      output: { write: (chunk) => writes.push(chunk) },
    });
    renderer.beginFrame({ clear: false });
    renderer.writeText(0, 0, 'a12d');
    renderer.present();

    renderer.beginFrame({ clear: false });
    renderer.writeText(0, 0, 'b');
    renderer.writeText(3, 0, 'e');
    const result = renderer.present();

    expect(result.diff.changedCells).toBe(2);
    expect(result.diff.bridgedCells).toBe(2);
    expect(result.diff.renderRuns).toBe(1);
    expect(result.output).toBe('\u001B[1;1Hb12e');
    expect(writes.at(-1)).toBe(result.output);
  });

  it('can disable native frame run optimization for compatibility debugging', () => {
    const writes: string[] = [];
    const renderer = new NativeFrameRenderer({
      width: 6,
      height: 1,
      output: { write: (chunk) => writes.push(chunk) },
      runOptimization: false,
      cursorMotion: 'absolute',
    });
    renderer.beginFrame({ clear: false });
    renderer.writeText(0, 0, 'a12d');
    renderer.present();

    renderer.beginFrame({ clear: false });
    renderer.writeText(0, 0, 'b');
    renderer.writeText(3, 0, 'e');
    const result = renderer.present();

    expect(result.diff.runs).toBeUndefined();
    expect(result.output).toBe('\u001B[1;1Hb\u001B[1;4He');
    expect(writes.at(-1)).toBe(result.output);
  });

  it('uses auto relative cursor motion in native frame output', () => {
    const writes: string[] = [];
    const renderer = new NativeFrameRenderer({
      width: 8,
      height: 1,
      output: { write: (chunk) => writes.push(chunk) },
      runOptimization: false,
    });
    renderer.beginFrame({ clear: false });
    renderer.writeText(0, 0, 'a');
    renderer.writeText(3, 0, 'b');
    renderer.present();

    renderer.beginFrame({ clear: false });
    renderer.writeText(0, 0, 'x');
    renderer.writeText(3, 0, 'y');
    const result = renderer.present();

    expect(result.diff.renderRuns).toBeUndefined();
    expect(result.output).toBe('\u001B[1;1Hx\u001B[2Cy');
    expect(writes.at(-1)).toBe(result.output);
  });

  it('forces the next present after resize', () => {
    const writes: string[] = [];
    const renderer = new NativeFrameRenderer({
      width: 5,
      height: 1,
      output: { write: (chunk) => writes.push(chunk) },
    });
    renderer.resize(2, 1);
    renderer.beginFrame({ clear: false });
    renderer.writeText(0, 0, 'z');
    const result = renderer.present();

    expect(renderer.width).toBe(2);
    expect(result.diff.force).toBe(true);
    expect(result.diff.totalCells).toBe(2);
    expect(result.output).toBe('\u001B[1;1Hz');
  });

  it('honors terminal output options when presenting', () => {
    const writes: string[] = [];
    const renderer = new NativeFrameRenderer({
      width: 1,
      height: 1,
      output: { write: (chunk) => writes.push(chunk) },
      synchronized: true,
      hideCursor: true,
      showCursor: true,
      originX: 2,
      originY: 3,
    });

    renderer.beginFrame({ clear: false });
    renderer.writeText(0, 0, 'x');
    const result = renderer.present();

    expect(result.output).toBe(
      [
        ANSI_BEGIN_SYNCHRONIZED_UPDATE,
        ANSI_HIDE_CURSOR,
        '\u001B[4;3H',
        'x',
        ANSI_SHOW_CURSOR,
        ANSI_END_SYNCHRONIZED_UPDATE,
      ].join(''),
    );
  });

  it('applies frame output policies before terminal encoding', () => {
    const writes: string[] = [];
    const renderer = new NativeFrameRenderer({
      width: 80,
      height: 1,
      output: { write: (chunk) => writes.push(chunk) },
      synchronized: true,
      outputPolicy: 'balanced',
    });

    renderer.beginFrame({ clear: false });
    renderer.writeText(0, 0, 'abcd');
    const full = renderer.present();

    renderer.beginFrame({ clear: false });
    renderer.writeText(0, 0, 'z');
    const small = renderer.present();

    renderer.beginFrame({ clear: false });
    renderer.setCursor({ x: 2, y: 0, visible: true });
    const cursorOnly = renderer.present();

    // Soft-force scans the whole row but only patches "abcd"; mode and sync
    // follow rewrite coverage (4 cells ≪ balanced thresholds → no sync).
    expect(full.outputPolicy).toMatchObject({
      mode: 'partial',
      synchronized: false,
      reason: 'below-threshold',
      eraseLine: true,
    });
    // Without trailing blank patches, erase-line has no known row tail to clear.
    expect(full.output).toBe('\u001B[1;1Habcd');
    expect(small.outputPolicy).toMatchObject({
      mode: 'partial',
      synchronized: false,
      reason: 'below-threshold',
    });
    expect(small.output.startsWith(ANSI_BEGIN_SYNCHRONIZED_UPDATE)).toBe(false);
    expect(cursorOnly.outputPolicy).toMatchObject({
      mode: 'cursor-only',
      synchronized: true,
      reason: 'cursor-only',
    });
    expect(cursorOnly.output).toBe(
      `${ANSI_BEGIN_SYNCHRONIZED_UPDATE}\u001B[1;3H\u001B[?25h${ANSI_END_SYNCHRONIZED_UPDATE}`,
    );
  });

  it('synchronizes sparse native frame updates when output run count is high', () => {
    const writes: string[] = [];
    const renderer = new NativeFrameRenderer({
      width: 80,
      height: 1,
      output: { write: (chunk) => writes.push(chunk) },
      synchronized: true,
      outputPolicy: 'balanced',
    });
    renderer.beginFrame({ clear: false });
    for (let x = 0; x < 40; x += 5) {
      renderer.writeText(x, 0, 'a');
    }
    renderer.present();

    renderer.beginFrame({ clear: false });
    for (let x = 0; x < 40; x += 5) {
      renderer.writeText(x, 0, 'b');
    }
    const result = renderer.present();

    expect(result.diff.changedCells).toBe(8);
    expect(result.diff.renderRuns).toBe(8);
    expect(result.outputPolicy).toMatchObject({
      mode: 'partial',
      synchronized: true,
      largeFrame: true,
      reason: 'output-runs',
    });
    expect(result.output.startsWith(ANSI_BEGIN_SYNCHRONIZED_UPDATE)).toBe(true);
    expect(result.output.endsWith(ANSI_END_SYNCHRONIZED_UPDATE)).toBe(true);
    expect(writes.at(-1)).toBe(result.output);
  });

  it('prepends a kitty inline-image clear sequence when inlineImageProtocol is kitty', () => {
    const renderer = new NativeFrameRenderer({
      width: 4,
      height: 1,
      output: { write: () => {} },
      inlineImageProtocol: 'kitty',
      synchronized: false,
    });

    renderer.beginFrame({ clear: false });
    renderer.writeText(0, 0, 'hi');
    const result = renderer.present();

    expect(result.output).toBe(`${encodeRendererClearInlineImages('kitty')}\u001B[1;1Hhi`);
  });

  it('does not prepend an inline-image clear sequence when inlineImageProtocol is none', () => {
    const renderer = new NativeFrameRenderer({
      width: 4,
      height: 1,
      output: { write: () => {} },
      inlineImageProtocol: 'none',
      synchronized: false,
    });

    renderer.beginFrame({ clear: false });
    renderer.writeText(0, 0, 'hi');
    const result = renderer.present();

    expect(result.output).toBe('\u001B[1;1Hhi');
  });
});

describe('renderNativeLayoutFrame', () => {
  it('renders component-like line sources into a native frame', () => {
    const writes: string[] = [];
    const source = {
      render: (width: number) => [`${String(width)}:\u001B[32mok`],
    };
    const renderer = new NativeFrameRenderer({
      width: 8,
      height: 2,
      output: { write: (chunk) => writes.push(chunk) },
    });

    const result = renderNativeLayoutFrame(renderer, [
      {
        rect: { x: 1, y: 0, width: 5, height: 1 },
        content: source,
      },
    ]);

    expect(result.composition.regions).toBe(1);
    expect(result.regions[0]!.lines).toEqual(['5:\u001B[32mok']);
    // Soft-force skips blank padding cells that still match the empty buffer.
    expect(result.output).toBe('\u001B[1;2H5:\u001B[0;38;2;0;128;0mok\u001B[0m');
    expect(writes).toEqual([result.output]);
  });

  it('supports lazy region content and z-order overlays', () => {
    const writes: string[] = [];
    const renderer = new NativeFrameRenderer({
      width: 5,
      height: 1,
      output: { write: (chunk) => writes.push(chunk) },
    });

    const result = renderNativeLayoutFrame(renderer, [
      {
        rect: { x: 0, y: 0, width: 5, height: 1 },
        content: ['aaaaa'],
      },
      {
        rect: { x: 2, y: 0, width: 2, height: 1 },
        zIndex: 10,
        content: (width) => ['B'.repeat(width)],
      },
    ]);

    expect(result.output).toBe('\u001B[1;1HaaBBa');
  });

  it('omits output when a following native layout frame has no changes', () => {
    const writes: string[] = [];
    const renderer = new NativeFrameRenderer({
      width: 3,
      height: 1,
      output: { write: (chunk) => writes.push(chunk) },
    });
    const regions = [{ rect: { x: 0, y: 0, width: 3, height: 1 }, content: ['hey'] }];

    renderNativeLayoutFrame(renderer, regions);
    const second = renderNativeLayoutFrame(renderer, regions);

    expect(second.output).toBe('');
    expect(writes).toHaveLength(1);
  });

  it('forwards cursor state into cursor-only native layout frame output', () => {
    const writes: string[] = [];
    const renderer = new NativeFrameRenderer({
      width: 3,
      height: 1,
      output: { write: (chunk) => writes.push(chunk) },
    });
    const regions = [{ rect: { x: 0, y: 0, width: 3, height: 1 }, content: ['hey'] }];

    renderNativeLayoutFrame(renderer, regions);
    const second = renderNativeLayoutFrame(renderer, regions, {
      cursor: { x: 1, y: 0, visible: true },
    });

    expect(second.diff.changedCells).toBe(0);
    expect(second.output).toBe(`\u001B[1;2H${ANSI_SHOW_CURSOR}`);
    expect(writes.at(-1)).toBe(second.output);
  });
});

describe('ansiTextToCells wide text', () => {
  it('preserves ANSI styles across wide text cells', () => {
    expect(ansiTextToCells('\u001B[32m한🙂').map((cell) => ({
      char: cell.char,
      width: cell.width,
      continuation: cell.continuation,
      fg: cell.style?.fg,
    }))).toEqual([
      { char: '한', width: 2, continuation: undefined, fg: '#008000' },
      { char: '', width: 0, continuation: true, fg: '#008000' },
      { char: '🙂', width: 2, continuation: undefined, fg: '#008000' },
      { char: '', width: 0, continuation: true, fg: '#008000' },
    ]);
  });

  it('preserves OSC 8 hyperlink metadata across styled text', () => {
    const cells = ansiTextToCells(
      '\u001B]8;;https://example.com\u001B\\\u001B[31ma\u001B[0mb\u001B]8;;\u001B\\c',
    );

    expect(cells.map((cell) => ({
      char: cell.char,
      fg: cell.style?.fg,
      link: cell.link,
    }))).toEqual([
      { char: 'a', fg: '#800000', link: 'https://example.com' },
      { char: 'b', fg: undefined, link: 'https://example.com' },
      { char: 'c', fg: undefined, link: undefined },
    ]);
  });
});

describe('NativeTerminalSession', () => {
  it('defines reusable root UI and terminal host contracts for app adapters', () => {
    const writes: string[] = [];
    const terminal = {
      columns: 100,
      rows: 32,
      write: (chunk: string) => {
        writes.push(chunk);
      },
      drainInput: async () => {},
      setTitle: () => {},
      setProgress: () => {},
    } satisfies RendererTerminalHost;

    const children: Text[] = [];
    const listeners = new Set<(data: string) => unknown>();
    const ui = {
      terminal,
      children,
      start: () => {},
      stop: () => {},
      requestRender: () => {},
      addChild: (component: Text) => {
        children.push(component);
      },
      clear: () => {
        children.splice(0);
      },
      setFocus: () => {},
      addInputListener: (listener) => {
        listeners.add(listener);
        return () => listeners.delete(listener);
      },
    } satisfies RendererRootUI<Text>;

    ui.addChild(new Text('hello'));
    terminal.write('frame');
    const dispose = ui.addInputListener(() => undefined);
    dispose();

    expect(ui.children).toHaveLength(1);
    expect(writes).toEqual(['frame']);
    expect(listeners.size).toBe(0);
  });

  it('exposes reusable terminal feature profiles for app runtimes', () => {
    expect(nativeTerminalFeatureProfile('minimal')).toEqual({});
    expect(nativeTerminalFeatureProfile('inline-app')).toEqual({
      rawMode: true,
      bracketedPaste: true,
      focusEvents: true,
      keyboardProtocol: 'kitty',
      mouseTracking: 'sgr',
      synchronized: true,
      hideCursor: true,
      showCursor: true,
      autoWrap: false,
    });
    expect(nativeTerminalFeatureProfile('fullscreen-app')).toMatchObject({
      screenMode: 'alternate',
      clearOnStart: true,
      autoWrap: false,
      rawMode: true,
      bracketedPaste: true,
      focusEvents: true,
      keyboardProtocol: 'kitty',
      mouseTracking: 'sgr',
      synchronized: true,
    });
  });

  it('merges feature profiles without letting undefined erase profile defaults', () => {
    const merged = mergeNativeTerminalFeatureOptions('inline-app', {
      rawMode: false,
      keyboardProtocol: undefined,
      mouseTracking: undefined,
    });

    expect(merged.rawMode).toBe(false);
    expect(merged.keyboardProtocol).toBe('kitty');
    expect(merged.mouseTracking).toBe('sgr');
    expect(merged.bracketedPaste).toBe(true);

    const outputMerged = mergeNativeTerminalFeatureOptions(
      { colorMode: 'ansi256', eraseLine: true },
      { colorMode: undefined, eraseLine: undefined },
    );
    expect(outputMerged.colorMode).toBe('ansi256');
    expect(outputMerged.eraseLine).toBe(true);
  });

  it('detects terminal capabilities for adaptive native feature profiles', () => {
    expect(detectNativeTerminalCapabilities({
      TERM: 'xterm-kitty',
      KITTY_WINDOW_ID: '1',
    })).toMatchObject({
      interactive: true,
      keyboardProtocol: true,
      mouseTracking: true,
      bracketedPaste: true,
      synchronized: true,
      colorMode: 'truecolor',
      imageProtocol: 'kitty',
    });

    expect(detectNativeTerminalCapabilities({
      TERM: 'screen-256color',
      TMUX: '/tmp/tmux-501/default,1,0',
    })).toMatchObject({
      interactive: true,
      keyboardProtocol: false,
      mouseTracking: true,
      bracketedPaste: true,
      colorMode: 'ansi256',
      imageProtocol: 'none',
    });

    expect(detectNativeTerminalCapabilities({
      TERM: 'xterm-256color',
      TERM_PROGRAM: 'waveterm',
      WAVETERM: '1',
    })).toMatchObject({
      interactive: true,
      mouseTracking: true,
      bracketedPaste: true,
      focusEvents: true,
      synchronized: false,
    });

    expect(detectNativeTerminalCapabilities({
      TERM: 'xterm-256color',
      TERM_PROGRAM: 'waveterm',
      WAVETERM: '1',
      HARNESS_TUI_SYNCHRONIZED_OUTPUT: '1',
    }).synchronized).toBe(true);

    expect(detectNativeTerminalCapabilities({
      TERM: 'xterm-kitty',
      KITTY_WINDOW_ID: '1',
      TUI_RENDERER_SYNCHRONIZED_OUTPUT: '0',
    }).synchronized).toBe(false);

    expect(detectNativeTerminalCapabilities({ TERM: 'dumb' })).toEqual({
      interactive: false,
      keyboardProtocol: false,
      mouseTracking: false,
      bracketedPaste: false,
      focusEvents: false,
      synchronized: false,
      colorMode: 'none',
      imageProtocol: 'none',
    });
  });

  it('parses DEC mode reports for query-based synchronized-output detection', () => {
    expect(ANSI_QUERY_SYNCHRONIZED_OUTPUT_SUPPORT).toBe('\u001B[?2026$p');
    expect(parseNativeTerminalDecModeReport('\u001B[?2026;2$y')).toEqual({
      raw: '\u001B[?2026;2$y',
      privateMode: true,
      mode: 2026,
      stateCode: 2,
      state: 'reset',
      supported: true,
    });
    expect(parseNativeSynchronizedOutputSupport('\u001B[?2026;1$y')).toBe('supported');
    expect(parseNativeSynchronizedOutputSupport('\u001B[?2026;2$y')).toBe('supported');
    expect(parseNativeSynchronizedOutputSupport('\u001B[?2026;0$y')).toBe('unsupported');
    expect(parseNativeSynchronizedOutputSupport('\u001B[?2026;4$y')).toBe('unsupported');
    expect(parseNativeSynchronizedOutputSupport('\u001B[?2026;3$y')).toBe('unknown');
    expect(parseNativeSynchronizedOutputSupport('\u001B[2026;2$y')).toBe('unknown');
    expect(parseNativeSynchronizedOutputSupport('no response')).toBe('unknown');
    expect(parseNativeSynchronizedOutputSupport(
      Buffer.from('x\u001B[?1004;2$y\u001B[?2026;2$yy'),
    )).toBe('supported');
    const reports = parseNativeTerminalDecModeReports('\u001B[?1004;2$y\u001B[?2026;4$y');
    expect(reports.map((report) => [report.mode, report.state])).toEqual([
      [1004, 'reset'],
      [2026, 'permanently-reset'],
    ]);
    expect(resolveNativeSynchronizedOutputSupport(parseNativeTerminalDecModeReport(
      '\u001B[?1004;2$y',
    ))).toBe('unknown');
  });

  it('queries synchronized-output support over terminal input and output', async () => {
    const input = new FakeInput();
    const output = new FakeOutput();
    const scheduler = new FakeProbeScheduler();
    const probe = probeNativeSynchronizedOutputSupport({
      input,
      output,
      scheduler,
    });

    expect(output.writes).toEqual([ANSI_QUERY_SYNCHRONIZED_OUTPUT_SUPPORT]);
    expect(input.listenerCount('data')).toBe(1);

    input.emit('data', '\u001B[?2026;2$y');

    await expect(probe).resolves.toEqual({
      support: 'supported',
      report: {
        raw: '\u001B[?2026;2$y',
        privateMode: true,
        mode: 2026,
        stateCode: 2,
        state: 'reset',
        supported: true,
      },
      timedOut: false,
    });
    expect(input.listenerCount('data')).toBe(0);
    expect(scheduler.pendingTimers).toBe(0);
  });

  it('times out synchronized-output probing without leaving input listeners attached', async () => {
    const input = new FakeInput();
    const output = new FakeOutput();
    const scheduler = new FakeProbeScheduler();
    const probe = probeNativeSynchronizedOutputSupport({
      input,
      output,
      scheduler,
      timeoutMs: 25,
    });

    expect(output.writes).toEqual([ANSI_QUERY_SYNCHRONIZED_OUTPUT_SUPPORT]);
    scheduler.advance(24);
    expect(input.listenerCount('data')).toBe(1);
    scheduler.advance(1);

    await expect(probe).resolves.toEqual({
      support: 'unknown',
      timedOut: true,
    });
    expect(input.listenerCount('data')).toBe(0);

    input.emit('data', '\u001B[?2026;2$y');
    expect(output.writes).toHaveLength(1);
  });

  it('can abort synchronized-output probing without waiting for the timeout', async () => {
    const input = new FakeInput();
    const output = new FakeOutput();
    const scheduler = new FakeProbeScheduler();
    const abort = new AbortController();
    const probe = probeNativeSynchronizedOutputSupport({
      input,
      output,
      scheduler,
      signal: abort.signal,
    });

    expect(input.listenerCount('data')).toBe(1);
    abort.abort();

    await expect(probe).resolves.toEqual({
      support: 'unknown',
      timedOut: false,
      aborted: true,
    });
    expect(input.listenerCount('data')).toBe(0);
    expect(scheduler.pendingTimers).toBe(0);
  });

  it('caches and coalesces synchronized-output capability probes', async () => {
    const input = new FakeInput();
    const output = new FakeOutput();
    const scheduler = new FakeProbeScheduler();
    const probe = new NativeTerminalCapabilityProbe({
      input,
      output,
      scheduler,
    });

    const first = probe.probeSynchronizedOutput();
    const second = probe.probeSynchronizedOutput();
    expect(output.writes).toEqual([ANSI_QUERY_SYNCHRONIZED_OUTPUT_SUPPORT]);

    input.emit('data', '\u001B[?2026;1$y');
    await expect(Promise.all([first, second])).resolves.toEqual([
      {
        support: 'supported',
        report: {
          raw: '\u001B[?2026;1$y',
          privateMode: true,
          mode: 2026,
          stateCode: 1,
          state: 'set',
          supported: true,
        },
        timedOut: false,
      },
      {
        support: 'supported',
        report: {
          raw: '\u001B[?2026;1$y',
          privateMode: true,
          mode: 2026,
          stateCode: 1,
          state: 'set',
          supported: true,
        },
        timedOut: false,
      },
    ]);

    await expect(probe.probeSynchronizedOutput()).resolves.toMatchObject({
      support: 'supported',
      timedOut: false,
    });
    expect(output.writes).toHaveLength(1);

    const forced = probe.probeSynchronizedOutput({ force: true });
    expect(output.writes).toEqual([
      ANSI_QUERY_SYNCHRONIZED_OUTPUT_SUPPORT,
      ANSI_QUERY_SYNCHRONIZED_OUTPUT_SUPPORT,
    ]);
    input.emit('data', '\u001B[?2026;0$y');
    await expect(forced).resolves.toMatchObject({
      support: 'unsupported',
      timedOut: false,
    });
    expect(input.listenerCount('data')).toBe(0);
  });

  it('applies runtime synchronized-output probe results to native renderer output', async () => {
    const input = new FakeInput();
    const output = new FakeOutput();
    const scheduler = new FakeProbeScheduler();
    let text = 'a';
    const renderer = new NativeTerminalRenderer({
      input,
      output,
      scheduler,
      renderOnStart: true,
      synchronized: true,
      synchronizedOutputProbe: true,
      outputPolicy: 'premium',
      render: ({ renderer: frameRenderer }) => {
        frameRenderer.writeText(0, 0, text);
        return frameRenderer.present();
      },
    });

    renderer.start();
    scheduler.advance(0);

    expect(output.writes[0]).toBe(ANSI_QUERY_SYNCHRONIZED_OUTPUT_SUPPORT);
    expect(renderer.lastFrame?.metrics.outputSynchronized).toBe(true);
    expect(output.writes.at(-1)).toContain(ANSI_BEGIN_SYNCHRONIZED_UPDATE);

    text = 'b';
    input.emit('data', '\u001B[?2026;0$y');
    await Promise.resolve();
    scheduler.advance(17);

    expect(renderer.synchronizedOutputProbeResult).toMatchObject({
      support: 'unsupported',
      timedOut: false,
    });
    expect(renderer.synchronizedOutputEnabled).toBe(false);
    expect(renderer.lastFrame?.metrics.outputSynchronized).toBe(false);
    expect(renderer.lastFrame?.metrics.outputPolicyReason).toBe('disabled');
    expect(renderer.diagnostics).toMatchObject({
      severity: 'watch',
      synchronizedOutputSupport: 'unsupported',
      synchronizedOutputEnabled: false,
    });
    expect(renderer.traceSnapshot.events).toEqual(expect.arrayContaining([
      expect.objectContaining({
        kind: 'marker',
        name: 'terminal.synchronized_output_probe',
        args: {
          support: 'unsupported',
          timedOut: false,
          enabled: false,
        },
      }),
    ]));
    expect(output.writes.at(-1)).not.toContain(ANSI_BEGIN_SYNCHRONIZED_UPDATE);
    renderer.stop();
  });

  it('keeps synchronized output enabled when the probe times out as unknown', async () => {
    const input = new FakeInput();
    const output = new FakeOutput();
    const scheduler = new FakeProbeScheduler();
    let text = 'a';
    const renderer = new NativeTerminalRenderer({
      input,
      output,
      scheduler,
      renderOnStart: true,
      synchronized: true,
      synchronizedOutputProbe: true,
      synchronizedOutputProbeTimeoutMs: 25,
      outputPolicy: 'premium',
      render: ({ renderer: frameRenderer }) => {
        frameRenderer.writeText(0, 0, text);
        return frameRenderer.present();
      },
    });

    renderer.start();
    scheduler.advance(0);
    expect(renderer.lastFrame?.metrics.outputSynchronized).toBe(true);

    scheduler.advance(25);
    await Promise.resolve();
    text = 'b';
    scheduler.advance(17);

    expect(renderer.synchronizedOutputProbeResult).toMatchObject({
      support: 'unknown',
      timedOut: true,
    });
    expect(renderer.synchronizedOutputEnabled).toBe(true);
    expect(renderer.lastFrame?.metrics.outputSynchronized).toBe(true);
    expect(output.writes.at(-1)).toContain(ANSI_BEGIN_SYNCHRONIZED_UPDATE);
    expect(renderer.traceSnapshot.events).toEqual(expect.arrayContaining([
      expect.objectContaining({
        kind: 'marker',
        name: 'terminal.synchronized_output_probe',
        args: {
          support: 'unknown',
          timedOut: true,
          enabled: true,
        },
      }),
    ]));
    renderer.stop();
  });

  it('detects terminal color capability from common environment variables', () => {
    expect(detectNativeTerminalColorMode({ TERM: 'xterm-256color' })).toBe('ansi256');
    expect(detectNativeTerminalColorMode({ TERM: 'xterm-256color', NO_COLOR: '1' })).toBe(
      'none',
    );
    expect(detectNativeTerminalColorMode({ TERM: 'xterm-256color', CLICOLOR: '0' })).toBe(
      'none',
    );
    expect(detectNativeTerminalColorMode({ TERM: 'xterm', CI: 'true' })).toBe('none');
    expect(detectNativeTerminalColorMode({ TERM: 'dumb', FORCE_COLOR: '3' })).toBe('truecolor');
    expect(detectNativeTerminalColorMode({ TERM: 'xterm', CLICOLOR_FORCE: '1' })).toBe('ansi16');
    expect(detectNativeTerminalColorMode({ TERM: 'xterm', COLORTERM: 'truecolor' })).toBe(
      'truecolor',
    );
    expect(detectNativeTerminalColorMode({
      TERM: 'xterm-kitty',
      COLORTERM: 'truecolor',
      FORCE_COLOR: '2',
    })).toBe('ansi256');
  });

  it('detects terminal inline image protocol capability conservatively', () => {
    expect(detectNativeTerminalImageProtocol({ TERM: 'xterm-kitty', KITTY_WINDOW_ID: '1' })).toBe(
      'kitty',
    );
    expect(detectNativeTerminalImageProtocol({ TERM: 'xterm-ghostty' })).toBe('kitty');
    expect(detectNativeTerminalImageProtocol({ TERM_PROGRAM: 'WezTerm', WEZTERM_PANE: '1' })).toBe(
      'iterm2',
    );
    expect(detectNativeTerminalImageProtocol({ TERM_PROGRAM: 'iTerm.app' })).toBe('iterm2');
    expect(detectNativeTerminalImageProtocol({
      TERM: 'xterm-kitty',
      KITTY_WINDOW_ID: '1',
      TMUX: '/tmp/tmux/default,1,0',
    })).toBe('none');
    expect(detectNativeTerminalImageProtocol({ TERM: 'xterm', CI: 'true' })).toBe('none');
  });

  it('builds adaptive feature profiles from detected terminal capabilities', () => {
    expect(nativeTerminalAdaptiveFeatureProfile('inline-app', {
      TERM: 'xterm-kitty',
      KITTY_WINDOW_ID: '1',
    })).toMatchObject({
      rawMode: true,
      keyboardProtocol: 'kitty',
      mouseTracking: 'sgr',
      bracketedPaste: true,
      synchronized: true,
      autoWrap: false,
      colorMode: 'truecolor',
      imageProtocol: 'kitty',
    });

    const tmux = nativeTerminalAdaptiveFeatureProfile('inline-app', {
      TERM: 'screen-256color',
      TMUX: '/tmp/tmux-501/default,1,0',
    });
    expect(tmux.keyboardProtocol).toBeUndefined();
    expect(tmux.mouseTracking).toBe('sgr');
    expect(tmux.bracketedPaste).toBe(true);
    expect(tmux.colorMode).toBe('ansi256');
    expect(tmux.imageProtocol).toBe('none');

    const wave = nativeTerminalAdaptiveFeatureProfile('inline-app', {
      TERM: 'xterm-256color',
      TERM_PROGRAM: 'waveterm',
      WAVETERM: '1',
    });
    expect(wave.mouseTracking).toBe('sgr');
    expect(wave.synchronized).toBeUndefined();

    expect(nativeTerminalAdaptiveFeatureProfile('fullscreen-app', { TERM: 'dumb' })).toEqual({
      screenMode: undefined,
      clearOnStart: undefined,
      autoWrap: undefined,
      rawMode: undefined,
      bracketedPaste: undefined,
      focusEvents: undefined,
      keyboardProtocol: undefined,
      mouseTracking: undefined,
      synchronized: undefined,
      hideCursor: undefined,
      showCursor: undefined,
      colorMode: 'none',
      imageProtocol: 'none',
    });
  });

  it('resolves premium renderer defaults from synchronized terminal capabilities', () => {
    expect(resolveNativePremiumRendererDefaults({
      features: 'inline-app',
      environment: { TERM: 'xterm-kitty', KITTY_WINDOW_ID: '1' },
    })).toEqual({
      outputPolicy: 'premium',
      regionVfxFrames: 'auto',
    });

    expect(resolveNativePremiumRendererDefaults({
      features: 'inline-app',
      environment: { TERM: 'dumb' },
    })).toEqual({
      outputPolicy: 'balanced',
      regionVfxFrames: 'auto',
    });

    expect(resolveNativePremiumRendererDefaults({
      synchronized: true,
      environment: { TERM: 'dumb' },
    })).toEqual({
      outputPolicy: 'premium',
      regionVfxFrames: 'auto',
    });
  });

  it('starts and stops terminal screen features in a reversible order', () => {
    const input = new FakeInput();
    const output = new FakeOutput();
    const session = new NativeTerminalSession({
      input,
      output,
      screenMode: 'alternate',
      rawMode: true,
      hideCursor: true,
      bracketedPaste: true,
      focusEvents: true,
      keyboardProtocol: 'kitty',
      clearOnStart: true,
    });

    session.start();
    session.start();

    expect(output.writes).toEqual([
      ANSI_ENTER_ALTERNATE_SCREEN,
      ANSI_CLEAR_SCREEN,
      ANSI_HIDE_CURSOR,
      ANSI_ENABLE_BRACKETED_PASTE,
      ANSI_ENABLE_FOCUS_EVENTS,
      ANSI_PUSH_KITTY_KEYBOARD_PROTOCOL,
    ]);
    expect(input.rawModeCalls).toEqual([true]);
    expect(input.resumed).toBe(1);

    session.stop();
    session.stop();

    expect(output.writes.slice(6)).toEqual([
      ANSI_POP_KITTY_KEYBOARD_PROTOCOL,
      ANSI_DISABLE_FOCUS_EVENTS,
      ANSI_DISABLE_BRACKETED_PASTE,
      ANSI_SHOW_CURSOR,
      ANSI_EXIT_ALTERNATE_SCREEN,
    ]);
    expect(input.rawModeCalls).toEqual([true, false]);
    expect(input.paused).toBe(1);
  });

  it('clears inline images on start when imageProtocol is kitty', () => {
    const input = new FakeInput();
    const output = new FakeOutput();
    const session = new NativeTerminalSession({
      input,
      output,
      screenMode: 'alternate',
      imageProtocol: 'kitty',
    });

    session.start();

    const clearIndex = output.writes.indexOf(encodeRendererClearInlineImages('kitty'));
    expect(clearIndex).toBeGreaterThan(-1);
    expect(clearIndex).toBeGreaterThan(output.writes.indexOf(ANSI_ENTER_ALTERNATE_SCREEN));
  });

  it('does not clear inline images on start when imageProtocol is none', () => {
    const input = new FakeInput();
    const output = new FakeOutput();
    const session = new NativeTerminalSession({
      input,
      output,
      screenMode: 'alternate',
      imageProtocol: 'none',
    });

    session.start();

    expect(output.writes).not.toContain(encodeRendererClearInlineImages('kitty'));
  });

  it('can start terminal features from a fullscreen app profile', () => {
    const input = new FakeInput();
    const output = new FakeOutput();
    const session = new NativeTerminalSession({
      input,
      output,
      features: 'fullscreen-app',
      rawMode: false,
      keyboardProtocol: undefined,
    });

    session.start();

    expect(output.writes).toEqual([
      ANSI_ENTER_ALTERNATE_SCREEN,
      ANSI_CLEAR_SCREEN,
      ANSI_DISABLE_AUTO_WRAP,
      ANSI_HIDE_CURSOR,
      ANSI_ENABLE_BRACKETED_PASTE,
      ANSI_ENABLE_FOCUS_EVENTS,
      ANSI_ENABLE_MOUSE_TRACKING,
      ANSI_ENABLE_MOUSE_BUTTON_EVENT_TRACKING,
      ANSI_ENABLE_SGR_MOUSE_MODE,
      ANSI_PUSH_KITTY_KEYBOARD_PROTOCOL,
    ]);
    expect(input.rawModeCalls).toEqual([]);
    expect(input.resumed).toBe(1);

    session.stop();

    expect(output.writes.slice(10)).toEqual([
      ANSI_POP_KITTY_KEYBOARD_PROTOCOL,
      ANSI_DISABLE_SGR_MOUSE_MODE,
      ANSI_DISABLE_MOUSE_BUTTON_EVENT_TRACKING,
      ANSI_DISABLE_MOUSE_TRACKING,
      ANSI_DISABLE_FOCUS_EVENTS,
      ANSI_DISABLE_BRACKETED_PASTE,
      ANSI_SHOW_CURSOR,
      ANSI_ENABLE_AUTO_WRAP,
      ANSI_EXIT_ALTERNATE_SCREEN,
    ]);
    expect(input.paused).toBe(1);
  });

  it('disables terminal autowrap for inline-app profiles and restores it on stop', () => {
    const input = new FakeInput();
    const output = new FakeOutput();
    const session = new NativeTerminalSession({
      input,
      output,
      features: 'inline-app',
      rawMode: false,
      keyboardProtocol: undefined,
    });

    session.start();

    expect(output.writes).toEqual([
      ANSI_DISABLE_AUTO_WRAP,
      ANSI_HIDE_CURSOR,
      ANSI_ENABLE_BRACKETED_PASTE,
      ANSI_ENABLE_FOCUS_EVENTS,
      ANSI_ENABLE_MOUSE_TRACKING,
      ANSI_ENABLE_MOUSE_BUTTON_EVENT_TRACKING,
      ANSI_ENABLE_SGR_MOUSE_MODE,
      ANSI_PUSH_KITTY_KEYBOARD_PROTOCOL,
    ]);

    session.stop();

    expect(output.writes.slice(8)).toEqual([
      ANSI_POP_KITTY_KEYBOARD_PROTOCOL,
      ANSI_DISABLE_SGR_MOUSE_MODE,
      ANSI_DISABLE_MOUSE_BUTTON_EVENT_TRACKING,
      ANSI_DISABLE_MOUSE_TRACKING,
      ANSI_DISABLE_FOCUS_EVENTS,
      ANSI_DISABLE_BRACKETED_PASTE,
      ANSI_SHOW_CURSOR,
      ANSI_ENABLE_AUTO_WRAP,
    ]);
  });

  it('leaves terminal autowrap untouched when autoWrap is undefined', () => {
    const output = new FakeOutput();
    const session = new NativeTerminalSession({
      output,
      screenMode: 'alternate',
    });

    session.start();
    session.stop();

    expect(output.writes).not.toContain(ANSI_DISABLE_AUTO_WRAP);
    expect(output.writes).not.toContain(ANSI_ENABLE_AUTO_WRAP);
  });

  it('forwards input and resize events while started, then detaches listeners', () => {
    const input = new FakeInput();
    const output = new FakeOutput();
    const inputs: Array<string | Buffer> = [];
    const sizes: Array<{ columns: number; rows: number }> = [];
    const session = new NativeTerminalSession({
      input,
      output,
      onInput: (data) => inputs.push(data),
      onResize: (size) => sizes.push(size),
    });

    session.start();
    input.emit('data', 'a');
    output.columns = 132;
    output.rows = 40;
    output.emit('resize');
    session.stop();
    input.emit('data', 'b');
    output.emit('resize');

    expect(inputs).toEqual(['a']);
    expect(sizes).toEqual([{ columns: 132, rows: 40 }]);
  });

  it('skips raw mode when input is not a TTY', () => {
    const input = new FakeInput();
    input.isTTY = false;
    const session = new NativeTerminalSession({
      input,
      output: new FakeOutput(),
      rawMode: true,
    });

    session.start();
    session.stop();

    expect(input.rawModeCalls).toEqual([]);
  });

  it('restores a previously raw terminal to raw mode', () => {
    const input = new FakeInput();
    input.isRaw = true;
    const session = new NativeTerminalSession({
      input,
      output: new FakeOutput(),
    });

    session.start();
    session.stop();

    expect(input.rawModeCalls).toEqual([true, true]);
  });
});

describe('composeRendererRegions', () => {
  it('clips region content to its rectangle', () => {
    const buffer = new RendererCellBuffer(6, 2);

    composeRendererRegions(buffer, [
      {
        rect: { x: 1, y: 0, width: 3, height: 2 },
        lines: ['abcd', 'efgh'],
      },
    ]);

    expect(rowText(buffer, 0)).toBe(' abc  ');
    expect(rowText(buffer, 1)).toBe(' efg  ');
  });

  it('maps scrollY to a region viewport', () => {
    const buffer = new RendererCellBuffer(5, 2);

    composeRendererRegions(buffer, [
      {
        rect: { x: 0, y: 0, width: 5, height: 2 },
        scrollY: 1,
        lines: ['zero', 'one', 'two'],
      },
    ]);

    expect(rowText(buffer, 0)).toBe('one  ');
    expect(rowText(buffer, 1)).toBe('two  ');
  });

  it('renders higher z-index regions over lower regions', () => {
    const buffer = new RendererCellBuffer(5, 1);

    composeRendererRegions(buffer, [
      {
        rect: { x: 0, y: 0, width: 5, height: 1 },
        zIndex: 0,
        lines: ['aaaaa'],
      },
      {
        rect: { x: 2, y: 0, width: 2, height: 1 },
        zIndex: 10,
        lines: ['BB'],
      },
    ]);

    expect(rowText(buffer, 0)).toBe('aaBBa');
  });

  it('keeps declaration order stable for equal z-index regions', () => {
    const buffer = new RendererCellBuffer(4, 1);

    composeRendererRegions(buffer, [
      { rect: { x: 0, y: 0, width: 4, height: 1 }, lines: ['1111'] },
      { rect: { x: 1, y: 0, width: 2, height: 1 }, lines: ['22'] },
    ]);

    expect(rowText(buffer, 0)).toBe('1221');
  });

  it('clears overlay regions before drawing sparse content', () => {
    const buffer = new RendererCellBuffer(5, 1);

    composeRendererRegions(buffer, [
      { rect: { x: 0, y: 0, width: 5, height: 1 }, lines: ['hello'] },
      { rect: { x: 1, y: 0, width: 3, height: 1 }, clear: true, lines: ['x'] },
    ]);

    expect(rowText(buffer, 0)).toBe('hx  o');
  });

  it('preserves per-cell styles in region content', () => {
    const buffer = new RendererCellBuffer(2, 1);

    composeRendererRegions(buffer, [
      {
        rect: { x: 0, y: 0, width: 2, height: 1 },
        lines: [[{ char: 'a', style: { fg: '#ff0000' } }, { char: 'b' }]],
      },
    ]);

    expect(buffer.getCell(0, 0)).toEqual({ char: 'a', style: { fg: '#ff0000' } });
    expect(buffer.getCell(1, 0)).toEqual({ char: 'b' });
  });

  it('inherits region background into foreground-only cells', () => {
    const buffer = new RendererCellBuffer(5, 1);

    composeRendererRegions(buffer, [
      {
        rect: { x: 0, y: 0, width: 5, height: 1 },
        background: { char: ' ', style: { bg: '#0B0F14' } },
        lines: [[
          { char: 'a', style: { fg: '#ff0000' } },
          { char: ' ', style: { fg: '#00ff00' } },
          { char: 'b' },
        ]],
      },
    ]);

    expect(buffer.getCell(0, 0)).toEqual({
      char: 'a',
      style: { fg: '#ff0000', bg: '#0B0F14' },
    });
    expect(buffer.getCell(1, 0)).toEqual({
      char: ' ',
      style: { fg: '#00ff00', bg: '#0B0F14' },
    });
    expect(buffer.getCell(2, 0)).toEqual({ char: 'b', style: { bg: '#0B0F14' } });
  });

  it('does not wipe prior cells when background is set without clear', () => {
    const buffer = new RendererCellBuffer(5, 1);
    buffer.writeText(0, 0, 'hello');

    composeRendererRegions(buffer, [
      {
        rect: { x: 0, y: 0, width: 5, height: 1 },
        background: { char: ' ', style: { bg: '#0B0F14' } },
        lines: [[{ char: 'X', style: { fg: '#ffffff' } }]],
      },
    ]);

    expect(buffer.getCell(0, 0)).toEqual({
      char: 'X',
      style: { fg: '#ffffff', bg: '#0B0F14' },
    });
    expect(rowText(buffer, 0)).toBe('Xello');
  });

  it('parses ANSI styled strings before composing regions', () => {
    const buffer = new RendererCellBuffer(3, 1);

    composeRendererRegions(buffer, [
      {
        rect: { x: 0, y: 0, width: 3, height: 1 },
        lines: ['a\u001B[31;1mb\u001B[0mc'],
      },
    ]);

    expect(buffer.getCell(0, 0)).toEqual({ char: 'a' });
    expect(buffer.getCell(1, 0)).toEqual({
      char: 'b',
      style: { fg: '#800000', bold: true },
    });
    expect(buffer.getCell(2, 0)).toEqual({ char: 'c' });
  });

  it('merges region style with inline ANSI style, letting inline style win', () => {
    const buffer = new RendererCellBuffer(2, 1);

    composeRendererRegions(buffer, [
      {
        rect: { x: 0, y: 0, width: 2, height: 1 },
        style: { fg: '#111111', underline: true },
        lines: ['a\u001B[32mb'],
      },
    ]);

    expect(buffer.getCell(0, 0)).toEqual({
      char: 'a',
      style: { fg: '#111111', underline: true },
    });
    expect(buffer.getCell(1, 0)).toEqual({
      char: 'b',
      style: { fg: '#008000', underline: true },
    });
  });

  it('applies region-local VFX while composing renderer regions', () => {
    const buffer = new RendererCellBuffer(5, 2);

    composeRendererRegions(buffer, [
      {
        rect: { x: 0, y: 0, width: 5, height: 2 },
        lines: ['abcde', 'vwxyz'],
        style: { fg: '#000000' },
        vfx: {
          rect: { x: 1, y: 0, width: 3, height: 1 },
          effect: {
            kind: 'pulse',
            progress: 0.25,
            color: '#ffffff',
            minIntensity: 0,
            maxIntensity: 1,
          },
        },
      },
    ]);

    expect(rowText(buffer, 0)).toBe('abcde');
    expect(rowText(buffer, 1)).toBe('vwxyz');
    expect(Array.from({ length: 5 }, (_, x) => buffer.getCell(x, 0).style?.fg)).toEqual([
      '#000000',
      '#808080',
      '#808080',
      '#808080',
      '#000000',
    ]);
    expect(Array.from({ length: 5 }, (_, x) => buffer.getCell(x, 1).style?.fg)).toEqual([
      '#000000',
      '#000000',
      '#000000',
      '#000000',
      '#000000',
    ]);
  });

  it('treats VFX progress as part of retained composition row cache keys', () => {
    const buffer = new RendererCellBuffer(3, 1);
    const cache = new RendererCompositionCache();
    const baseRegion = {
      id: 'loading',
      rect: { x: 0, y: 0, width: 3, height: 1 },
      clear: true,
      background: { char: ' ' },
      lines: ['abc'],
      style: { fg: '#000000' },
    } as const;

    cache.beginFrame({ bufferWidth: 3, bufferHeight: 1, layers: [{
      ...baseRegion,
      vfx: {
        effect: { kind: 'shimmer', progress: 0, color: '#ffffff' },
      },
    }] });
    const first = composeRendererRegions(buffer, [{
      ...baseRegion,
      vfx: {
        effect: { kind: 'shimmer', progress: 0, color: '#ffffff' },
      },
    }], { cache, reuseCachedRows: true });

    cache.beginFrame({ bufferWidth: 3, bufferHeight: 1, layers: [{
      ...baseRegion,
      vfx: {
        effect: { kind: 'shimmer', progress: 0, color: '#ffffff' },
      },
    }] });
    const second = composeRendererRegions(buffer, [{
      ...baseRegion,
      vfx: {
        effect: { kind: 'shimmer', progress: 0, color: '#ffffff' },
      },
    }], { cache, reuseCachedRows: true });

    cache.beginFrame({ bufferWidth: 3, bufferHeight: 1, layers: [{
      ...baseRegion,
      vfx: {
        effect: { kind: 'shimmer', progress: 0.5, color: '#ffffff' },
      },
    }] });
    const third = composeRendererRegions(buffer, [{
      ...baseRegion,
      vfx: {
        effect: { kind: 'shimmer', progress: 0.5, color: '#ffffff' },
      },
    }], { cache, reuseCachedRows: true });

    expect(first.rowsComposed).toBe(1);
    expect(second.rowsReused).toBe(1);
    expect(second.rowsComposed).toBe(0);
    expect(third.rowsReused).toBe(0);
    expect(third.rowsComposed).toBe(1);
  });
});

describe('ansiTextToCells', () => {
  it('parses reset and basic SGR styles into cells', () => {
    expect(ansiTextToCells('x\u001B[1;2;3;4;7my\u001B[22;23;24;27mz')).toEqual([
      { char: 'x' },
      { char: 'y', style: { bold: true, dim: true, italic: true, underline: true, inverse: true } },
      { char: 'z' },
    ]);
  });

  it('parses truecolor foreground/background sequences', () => {
    expect(ansiTextToCells('\u001B[38;2;1;2;3;48;2;4;5;6mx')).toEqual([
      { char: 'x', style: { fg: '#010203', bg: '#040506' } },
    ]);
  });

  it('parses 256-color and bright color SGR sequences', () => {
    expect(ansiTextToCells('\u001B[38;5;196;48;5;236mA\u001B[96mB')).toEqual([
      { char: 'A', style: { fg: '#ff0000', bg: '#303030' } },
      { char: 'B', style: { fg: '#00ffff', bg: '#303030' } },
    ]);
  });

  it('drops SGR escape bytes from measured cells', () => {
    expect(ansiTextToCells('a\u001B[31mb')).toHaveLength(2);
  });

  it('converts line arrays without carrying style across lines', () => {
    expect(ansiTextToCellLines(['\u001B[31ma', 'b'])).toEqual([
      [{ char: 'a', style: { fg: '#800000' } }],
      [{ char: 'b' }],
    ]);
  });
});

function rowText(buffer: RendererCellBuffer, y: number): string {
  return Array.from({ length: buffer.width }, (_, x) => buffer.getCell(x, y).char).join('');
}

function regionLineText(line: string | readonly RendererCell[]): string {
  if (typeof line === 'string') return line;
  return line.map((cell) => cell.char).join('');
}

function regionLineDisplayWidth(line: string | readonly RendererCell[]): number {
  return measureDisplayWidth(regionLineText(line));
}

function frameMetrics(
  metrics: Partial<NativeTerminalRendererFrameMetrics>,
): NativeTerminalRendererFrameMetrics {
  const targetFrameMs = metrics.targetFrameMs ?? 16;
  const durationMs = metrics.durationMs ?? 0;
  const totalCells = metrics.totalCells ?? 100;
  const scannedCells = metrics.scannedCells ?? totalCells;
  const scanRatio = metrics.scanRatio ?? (totalCells === 0 ? 0 : scannedCells / totalCells);
  const damageCells = metrics.damageCells ?? scannedCells;
  const damageRatio = metrics.damageRatio ?? (totalCells === 0 ? 0 : damageCells / totalCells);
  return {
    startedAt: metrics.startedAt ?? 0,
    endedAt: metrics.endedAt ?? durationMs,
    durationMs,
    targetFrameMs,
    overBudget: metrics.overBudget ?? durationMs > targetFrameMs,
    renderCallbackDurationMs: metrics.renderCallbackDurationMs ?? durationMs,
    presentDurationMs: metrics.presentDurationMs ?? 0,
    diffDurationMs: metrics.diffDurationMs ?? 0,
    encodeDurationMs: metrics.encodeDurationMs ?? 0,
    writeDurationMs: metrics.writeDurationMs ?? 0,
    qualityDurationMs: metrics.qualityDurationMs ?? 0,
    outputBytes: metrics.outputBytes ?? 0,
    outputBackpressure: metrics.outputBackpressure ?? false,
    outputCells: metrics.outputCells ?? 0,
    outputRuns: metrics.outputRuns ?? 0,
    outputBridgedCells: metrics.outputBridgedCells ?? 0,
    outputBridgedCellRatio: metrics.outputBridgedCellRatio ?? 0,
    cursorAbsoluteMoves: metrics.cursorAbsoluteMoves ?? 0,
    cursorRelativeMoves: metrics.cursorRelativeMoves ?? 0,
    cursorHorizontalAbsoluteMoves: metrics.cursorHorizontalAbsoluteMoves ?? 0,
    cursorMoveBytes: metrics.cursorMoveBytes ?? 0,
    cursorMoveAbsoluteBytes: metrics.cursorMoveAbsoluteBytes ?? 0,
    cursorMoveSavedBytes: metrics.cursorMoveSavedBytes ?? 0,
    outputMode: metrics.outputMode ?? 'full',
    outputSynchronized: metrics.outputSynchronized ?? false,
    outputLargeFrame: metrics.outputLargeFrame ?? true,
    outputPolicyReason: metrics.outputPolicyReason ?? 'full-frame',
    outputEraseLine: metrics.outputEraseLine ?? false,
    changedCells: metrics.changedCells ?? 0,
    scannedCells,
    scannedRows: metrics.scannedRows ?? 10,
    dirtyRows: metrics.dirtyRows ?? 0,
    totalCells,
    scanStrategy: metrics.scanStrategy ?? (scannedCells === 0 ? 'none' : 'full-frame'),
    scanRatio,
    damageCells,
    damageRatio,
    compositionRowsVisited: metrics.compositionRowsVisited ?? 0,
    compositionRowsComposed: metrics.compositionRowsComposed ?? 0,
    compositionRowsReused: metrics.compositionRowsReused ?? 0,
    compositionReuseRatio: metrics.compositionReuseRatio ?? 0,
    lineCacheHits: metrics.lineCacheHits ?? 0,
    lineCacheMisses: metrics.lineCacheMisses ?? 0,
    lineCacheHitRatio: metrics.lineCacheHitRatio ?? 0,
    lineCacheEvictions: metrics.lineCacheEvictions ?? 0,
  };
}

function frameDiff(diff: Partial<RendererFrameDiff>): RendererFrameDiff {
  const totalCells = diff.totalCells ?? 100;
  const changedCells = diff.changedCells ?? 0;
  const damageCells = diff.damageCells ?? changedCells;
  return {
    patches: diff.patches ?? [],
    runs: diff.runs,
    damage: diff.damage ?? (damageCells > 0 ? { x: 0, y: 0, width: damageCells, height: 1 } : null),
    force: diff.force ?? false,
    scanStrategy: diff.scanStrategy ?? (changedCells > 0 ? 'damage-rect' : 'none'),
    changedCells,
    outputCells: diff.outputCells,
    bridgedCells: diff.bridgedCells,
    renderRuns: diff.renderRuns,
    scannedCells: diff.scannedCells ?? changedCells,
    scannedRows: diff.scannedRows ?? (changedCells > 0 ? 1 : 0),
    dirtyRows: diff.dirtyRows ?? (changedCells > 0 ? 1 : 0),
    totalCells,
    scanRatio: diff.scanRatio ?? (totalCells === 0 ? 0 : changedCells / totalCells),
    damageCells,
    damageRatio: diff.damageRatio ?? (totalCells === 0 ? 0 : damageCells / totalCells),
  };
}

class FakeAnimationClock implements RendererAnimationClock {
  private nextAnimationFrameId = 1;
  private callbacks = new Map<number, RendererAnimationFrameCallback>();

  get pendingFrames(): number {
    return this.callbacks.size;
  }

  requestAnimationFrame(callback: RendererAnimationFrameCallback): number {
    const id = this.nextAnimationFrameId++;
    this.callbacks.set(id, callback);
    return id;
  }

  cancelAnimationFrame(id: number): void {
    this.callbacks.delete(id);
  }

  tick(frame: RendererAnimationFrame): void {
    const callbacks = Array.from(this.callbacks.values());
    this.callbacks.clear();
    for (const callback of callbacks) callback(frame);
  }
}

class FakeProbeTimer {
  unrefCalls = 0;

  constructor(
    readonly id: number,
    readonly callback: () => void,
    readonly dueAtMs: number,
  ) {}

  unref(): void {
    this.unrefCalls++;
  }
}

class FakeProbeScheduler {
  private nextTimerId = 1;
  private nowMs = 0;
  private readonly timers = new Map<number, FakeProbeTimer>();

  get pendingTimers(): number {
    return this.timers.size;
  }

  now(): number {
    return this.nowMs;
  }

  setTimeout(callback: () => void, delayMs: number): FakeProbeTimer {
    const timer = new FakeProbeTimer(
      this.nextTimerId++,
      callback,
      this.nowMs + delayMs,
    );
    this.timers.set(timer.id, timer);
    return timer;
  }

  clearTimeout(timer: FakeProbeTimer): void {
    this.timers.delete(timer.id);
  }

  advance(ms: number): void {
    this.nowMs += ms;
    const dueTimers = Array.from(this.timers.values())
      .filter((timer) => timer.dueAtMs <= this.nowMs)
      .toSorted((left, right) => left.dueAtMs - right.dueAtMs || left.id - right.id);
    for (const timer of dueTimers) {
      if (!this.timers.delete(timer.id)) continue;
      timer.callback();
    }
  }
}

class FakeInput extends EventEmitter {
  isTTY = true;
  isRaw = false;
  rawModeCalls: boolean[] = [];
  encoding: BufferEncoding | undefined;
  resumed = 0;
  paused = 0;

  setRawMode(raw: boolean): void {
    this.rawModeCalls.push(raw);
    this.isRaw = raw;
  }

  setEncoding(encoding: BufferEncoding): void {
    this.encoding = encoding;
  }

  resume(): void {
    this.resumed++;
  }

  pause(): void {
    this.paused++;
  }
}

class FakeOutput extends EventEmitter {
  columns = 80;
  rows = 24;
  writes: string[] = [];

  write(chunk: string): void {
    this.writes.push(chunk);
  }
}
