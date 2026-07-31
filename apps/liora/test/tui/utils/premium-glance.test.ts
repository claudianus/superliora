import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { DEFAULT_APPEARANCE_PREFERENCES } from '#/tui/config';
import {
  getAppearanceRenderHealth,
  getAppearanceRenderQuality,
  setAppearanceRenderHealth,
  setAppearanceRenderQuality,
} from '#/tui/features/appearance/appearance-effects';
import type { RendererDiagnosticsSnapshot } from '#/tui/renderer';
import {
  buildPremiumSettingsLines,
  formatLiveRenderQualityLine,
  formatMotionBudgetLine,
  formatVisualQualityModeLine,
  loadPremiumVisualGlance,
} from '#/tui/utils/premium/premium-glance';

const ENV_KEYS = ['TERM', 'CI', 'NO_COLOR', 'SSH_TTY', 'SSH_CONNECTION', 'SSH_CLIENT'] as const;

function degradedDiagnostics(): RendererDiagnosticsSnapshot {
  return {
    severity: 'degraded',
    health: 'degraded',
    frames: 4,
    windowFrames: 4,
    quality: {
      level: 'balanced',
      consecutiveOverBudgetFrames: 2,
      consecutiveOutputPressureFrames: 0,
      consecutiveUnderBudgetFrames: 0,
      changes: 1,
      lastChangeReason: 'over-budget',
    },
    avgDurationMs: 14,
    p95DurationMs: 18,
    p99DurationMs: 18,
    maxDurationMs: 18,
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
    dominantPhaseRatio: 10 / 14,
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
    issues: [],
  };
}

describe('premium visual glance', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    for (const key of ENV_KEYS) delete process.env[key];
    process.env['TERM'] = 'xterm-256color';
    setAppearanceRenderQuality('full');
    setAppearanceRenderHealth('healthy');
  });

  afterEach(() => {
    process.env = { ...originalEnv };
    setAppearanceRenderQuality('full');
    setAppearanceRenderHealth('healthy');
  });

  it('formats harness Visual Quality mode from appState', () => {
    const on = loadPremiumVisualGlance({
      premiumQualityMode: true,
      appearance: DEFAULT_APPEARANCE_PREFERENCES,
      renderQuality: 'full',
      renderHealth: 'healthy',
    });
    expect(formatVisualQualityModeLine(on)).toContain('Visual Quality: ON');
    expect(formatVisualQualityModeLine({ ...on, sessionPremiumQuality: false })).toContain(
      'syncing',
    );
  });

  it('wires live render quality and frame health from appearance module', () => {
    setAppearanceRenderQuality('balanced');
    setAppearanceRenderHealth('watch');
    const glance = loadPremiumVisualGlance({
      premiumQualityMode: false,
      appearance: {
        ...DEFAULT_APPEARANCE_PREFERENCES,
        profile: 'premium',
        particles: 'premium',
        animationFps: 30,
      },
      renderQuality: getAppearanceRenderQuality(),
      renderHealth: getAppearanceRenderHealth(),
    });
    expect(formatLiveRenderQualityLine(glance)).toBe(
      'Render quality: balanced · frame health: watch',
    );
    expect(formatMotionBudgetLine(glance)).toContain('premium ambient');
    // watch health soft-degrades premium 33ms cadence to 66ms.
    expect(formatMotionBudgetLine(glance)).toContain('66ms');
  });

  it('includes native frame budget ratio when diagnostics are wired', () => {
    const glance = loadPremiumVisualGlance({
      premiumQualityMode: true,
      appearance: DEFAULT_APPEARANCE_PREFERENCES,
      renderQuality: 'high',
      renderHealth: 'degraded',
      diagnostics: degradedDiagnostics(),
    });
    expect(formatMotionBudgetLine(glance)).toContain('frame budget 120% avg');
    expect(formatLiveRenderQualityLine(glance)).toContain('adaptive balanced');
  });

  it('reports forced-off motion under CI', () => {
    process.env['CI'] = '1';
    const glance = loadPremiumVisualGlance({
      premiumQualityMode: false,
      appearance: DEFAULT_APPEARANCE_PREFERENCES,
      renderQuality: 'full',
      renderHealth: 'healthy',
    });
    expect(formatMotionBudgetLine(glance)).toContain('forced off');
  });

  it('builds settings panel lines with live session block', () => {
    const text = buildPremiumSettingsLines(
      loadPremiumVisualGlance({
        premiumQualityMode: true,
        appearance: DEFAULT_APPEARANCE_PREFERENCES,
        renderQuality: 'full',
        renderHealth: 'healthy',
        sessionPremiumQuality: true,
      }),
    ).join('\n');
    expect(text).toContain('── Session (live) ─');
    expect(text).toContain('Visual Quality: ON');
    expect(text).toContain('/premium on|off');
    expect(text).toContain('Settings → Appearance');
  });
});
