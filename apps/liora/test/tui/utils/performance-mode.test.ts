import { describe, expect, it } from 'vitest';

import { DEFAULT_APPEARANCE_PREFERENCES } from '#/tui/config';
import {
  isLowSpecHardware,
  PERFORMANCE_OVERLAY_KEEP_RECENT_STEPS,
  PERFORMANCE_OVERLAY_MAX_TURNS,
  resolvePerformanceOverlay,
  type HardwareProbe,
} from '#/tui/features/appearance/performance-mode';
import {
  TRANSCRIPT_KEEP_RECENT_STEPS,
  TRANSCRIPT_MAX_TURNS,
} from '#/tui/features/transcript/transcript-window';

const GIB = 1024 ** 3;

const LOW_SPEC: HardwareProbe = { logicalCpus: 4, totalMemoryBytes: 8 * GIB };
const HIGH_SPEC: HardwareProbe = { logicalCpus: 16, totalMemoryBytes: 32 * GIB };
const BOUNDARY_LOW: HardwareProbe = { logicalCpus: 8, totalMemoryBytes: 8 * GIB };
const JUST_OVER_RAM: HardwareProbe = { logicalCpus: 8, totalMemoryBytes: 8 * GIB + 1 };
const JUST_OVER_CPU: HardwareProbe = { logicalCpus: 9, totalMemoryBytes: 8 * GIB };

describe('isLowSpecHardware', () => {
  it('treats ≤8 logical CPUs and ≤8 GiB as low-spec', () => {
    expect(isLowSpecHardware(LOW_SPEC)).toBe(true);
    expect(isLowSpecHardware(BOUNDARY_LOW)).toBe(true);
  });

  it('excludes machines just over the CPU or RAM boundary', () => {
    expect(isLowSpecHardware(JUST_OVER_RAM)).toBe(false);
    expect(isLowSpecHardware(JUST_OVER_CPU)).toBe(false);
    expect(isLowSpecHardware(HIGH_SPEC)).toBe(false);
  });
});

describe('resolvePerformanceOverlay', () => {
  it('keeps module transcript caps at 50 / 30', () => {
    expect(TRANSCRIPT_MAX_TURNS).toBe(50);
    expect(TRANSCRIPT_KEEP_RECENT_STEPS).toBe(30);
    expect(PERFORMANCE_OVERLAY_MAX_TURNS).toBe(24);
    expect(PERFORMANCE_OVERLAY_KEEP_RECENT_STEPS).toBe(12);
  });

  it('off + injected low-spec → overlay inactive; effective === stored', () => {
    const stored = {
      ...DEFAULT_APPEARANCE_PREFERENCES,
      profile: 'premium' as const,
      particles: 'premium' as const,
      animationFps: 60,
      transcriptDetail: 'full' as const,
    };
    const result = resolvePerformanceOverlay('off', stored, LOW_SPEC);
    expect(result.active).toBe(false);
    expect(result.effectiveAppearance).toEqual(stored);
    expect(result.effectiveAppearance).toBe(stored);
    expect(result.maxTurns).toBe(TRANSCRIPT_MAX_TURNS);
    expect(result.keepRecentSteps).toBe(TRANSCRIPT_KEEP_RECENT_STEPS);
  });

  it('auto + 4 cores / 8 GiB → active Off pack; input appearance unchanged', () => {
    const stored = {
      ...DEFAULT_APPEARANCE_PREFERENCES,
      profile: 'premium' as const,
      particles: 'premium' as const,
      animationFps: 60,
      transcriptDetail: 'full' as const,
      density: 'spacious' as const,
    };
    const snapshot = { ...stored };
    const result = resolvePerformanceOverlay('auto', stored, LOW_SPEC);
    expect(result.active).toBe(true);
    expect(result.effectiveAppearance).toMatchObject({
      profile: 'off',
      particles: 'off',
      animationFps: 15,
      transcriptDetail: 'compact',
      // non-overlay fields stay from stored
      density: 'spacious',
    });
    expect(stored).toEqual(snapshot);
    expect(result.maxTurns).toBe(24);
    expect(result.keepRecentSteps).toBe(12);
  });

  it('auto + 16 cores / 32 GiB → inactive', () => {
    const stored = { ...DEFAULT_APPEARANCE_PREFERENCES };
    const result = resolvePerformanceOverlay('auto', stored, HIGH_SPEC);
    expect(result.active).toBe(false);
    expect(result.effectiveAppearance).toBe(stored);
  });

  it('on + high-spec → active', () => {
    const stored = {
      ...DEFAULT_APPEARANCE_PREFERENCES,
      profile: 'subtle' as const,
      particles: 'events' as const,
      animationFps: 30,
      transcriptDetail: 'standard' as const,
    };
    const result = resolvePerformanceOverlay('on', stored, HIGH_SPEC);
    expect(result.active).toBe(true);
    expect(result.effectiveAppearance.profile).toBe('off');
    expect(result.effectiveAppearance.particles).toBe('off');
    expect(result.effectiveAppearance.animationFps).toBe(15);
    expect(result.effectiveAppearance.transcriptDetail).toBe('compact');
    expect(result.maxTurns).toBe(24);
    expect(result.keepRecentSteps).toBe(12);
  });

  it('auto at 8 logical + 8 GiB is low-spec active', () => {
    const result = resolvePerformanceOverlay(
      'auto',
      DEFAULT_APPEARANCE_PREFERENCES,
      BOUNDARY_LOW,
    );
    expect(result.active).toBe(true);
  });

  it('auto at 8 GiB+1 or 9 logical + 8 GiB is not low-spec', () => {
    expect(
      resolvePerformanceOverlay('auto', DEFAULT_APPEARANCE_PREFERENCES, JUST_OVER_RAM).active,
    ).toBe(false);
    expect(
      resolvePerformanceOverlay('auto', DEFAULT_APPEARANCE_PREFERENCES, JUST_OVER_CPU).active,
    ).toBe(false);
  });
});
