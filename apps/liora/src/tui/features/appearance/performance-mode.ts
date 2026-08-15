/**
 * Performance mode overlay — low-spec CPU/RAM relief without rewriting
 * stored `[appearance]` prefs in tui.toml.
 *
 * When active, effective look matches the Appearance Off pack
 * (profile off, particles off, animationFps 15, transcriptDetail compact)
 * and tighter transcript RAM caps. Module constants TRANSCRIPT_MAX_TURNS /
 * TRANSCRIPT_KEEP_RECENT_STEPS stay at 50 / 30; callers pass the overlay
 * caps only while the overlay is active.
 */

import { cpus, totalmem } from 'node:os';

import type { AppearancePreferences, PerformanceMode } from '#/tui/config';
import {
  TRANSCRIPT_KEEP_RECENT_STEPS,
  TRANSCRIPT_MAX_TURNS,
} from '#/tui/features/transcript/transcript-window';

/** Off-pack motion fields applied while the overlay is active. */
export const PERFORMANCE_OFF_PACK = {
  profile: 'off',
  particles: 'off',
  animationFps: 15,
  transcriptDetail: 'compact',
} as const satisfies Pick<
  AppearancePreferences,
  'profile' | 'particles' | 'animationFps' | 'transcriptDetail'
>;

/** Live turn cap while performance overlay is active (module default stays 50). */
export const PERFORMANCE_OVERLAY_MAX_TURNS = 24;

/** Keep-recent-steps while performance overlay is active (module default stays 30). */
export const PERFORMANCE_OVERLAY_KEEP_RECENT_STEPS = 12;

/** Low-spec boundary: logical CPUs ≤ 8 AND total RAM ≤ 8 GiB. */
export const LOW_SPEC_MAX_LOGICAL_CPUS = 8;
export const LOW_SPEC_MAX_MEMORY_BYTES = 8 * 1024 ** 3;

export interface HardwareProbe {
  readonly logicalCpus: number;
  readonly totalMemoryBytes: number;
}

export interface PerformanceOverlayResult {
  readonly active: boolean;
  /** Effective prefs for render; same reference as `stored` when inactive. */
  readonly effectiveAppearance: AppearancePreferences;
  readonly maxTurns: number;
  readonly keepRecentSteps: number;
}

/** True when both CPU and RAM are at or below the low-spec ceiling. */
export function isLowSpecHardware(probe: HardwareProbe): boolean {
  return (
    probe.logicalCpus <= LOW_SPEC_MAX_LOGICAL_CPUS &&
    probe.totalMemoryBytes <= LOW_SPEC_MAX_MEMORY_BYTES
  );
}

/** Default probe — injectable in tests; never calls WMI. */
export function probeLocalHardware(): HardwareProbe {
  return {
    logicalCpus: cpus().length,
    totalMemoryBytes: totalmem(),
  };
}

/**
 * Resolve whether the performance overlay is active and what effective
 * appearance / transcript caps to use. Never mutates `stored`.
 */
export function resolvePerformanceOverlay(
  mode: PerformanceMode,
  stored: AppearancePreferences,
  probe: HardwareProbe = probeLocalHardware(),
): PerformanceOverlayResult {
  const active =
    mode === 'on' || (mode === 'auto' && isLowSpecHardware(probe));

  if (!active) {
    return {
      active: false,
      effectiveAppearance: stored,
      maxTurns: TRANSCRIPT_MAX_TURNS,
      keepRecentSteps: TRANSCRIPT_KEEP_RECENT_STEPS,
    };
  }

  return {
    active: true,
    effectiveAppearance: {
      ...stored,
      ...PERFORMANCE_OFF_PACK,
    },
    maxTurns: PERFORMANCE_OVERLAY_MAX_TURNS,
    keepRecentSteps: PERFORMANCE_OVERLAY_KEEP_RECENT_STEPS,
  };
}

/** Convenience: effective appearance for a mode + stored prefs. */
export function resolveEffectiveAppearance(
  mode: PerformanceMode,
  stored: AppearancePreferences,
  probe?: HardwareProbe,
): AppearancePreferences {
  return resolvePerformanceOverlay(mode, stored, probe).effectiveAppearance;
}
