/**
 * Pure helpers for the Context / working-set Settings picker.
 *
 * The agent engine keeps a soft working-set ceiling so 1M-class model windows
 * do not fill the full advertised context before auto-compaction. Operators
 * pick a named preset here; the values map to `loopControl.maxWorkingSetTokens`
 * and `asyncWorkingSetTokens` (and optional soft ratio overrides).
 *
 * Grok / xAI sessions also clamp under the 200k long-context price band
 * (whole-request 2× rates at ≥200k prompt tokens).
 */

import { applyXaiPricingSafeWorkingSet } from '@superliora/oauth';

export type ContextWorkingSetPresetId =
  | 'balanced'
  | 'economy'
  | 'deep'
  | 'full_window';

export interface ContextWorkingSetLoopPatch {
  readonly maxWorkingSetTokens: number;
  readonly asyncWorkingSetTokens: number;
  /** Soft full-compact ratio; omitted when the preset leaves ratio defaults alone. */
  readonly compactionTriggerRatio?: number;
  readonly compactionAsyncTriggerRatio?: number;
}

export interface ContextWorkingSetPreset {
  readonly id: ContextWorkingSetPresetId;
  readonly label: string;
  readonly description: string;
  /** Short cost/quality tag shown in the list. */
  readonly badge: string;
  readonly loop: ContextWorkingSetLoopPatch;
}

export interface ContextWorkingSetPreview {
  readonly softTokens: number | null;
  readonly asyncTokens: number | null;
  readonly softLabel: string;
  readonly asyncLabel: string;
  readonly windowLabel: string;
}

/** Default engine soft working-set (~256k). */
export const BALANCED_MAX_WORKING_SET_TOKENS = 262_144;
export const BALANCED_ASYNC_WORKING_SET_TOKENS = 220_000;

/** Cheaper sessions: compact earlier, clear tool dumps sooner. */
export const ECONOMY_MAX_WORKING_SET_TOKENS = 196_608;
export const ECONOMY_ASYNC_WORKING_SET_TOKENS = 160_000;

/** Longer live history for deep refactors / multi-file reasoning. */
export const DEEP_MAX_WORKING_SET_TOKENS = 393_216;
export const DEEP_ASYNC_WORKING_SET_TOKENS = 320_000;

/**
 * Named presets for the Settings UI. Order is intentional: recommended first.
 * `full_window` sets caps to 0 (disabled) so ratio-only thresholds apply.
 */
export const CONTEXT_WORKING_SET_PRESETS: readonly ContextWorkingSetPreset[] = [
  {
    id: 'balanced',
    label: 'Balanced (Recommended)',
    badge: 'cost + quality',
    description:
      'Keep live history near ~256k even on 1M models. Best default for most agent work.',
    loop: {
      maxWorkingSetTokens: BALANCED_MAX_WORKING_SET_TOKENS,
      asyncWorkingSetTokens: BALANCED_ASYNC_WORKING_SET_TOKENS,
    },
  },
  {
    id: 'economy',
    label: 'Economy',
    badge: 'lower cost',
    description:
      'Compact earlier (~192k). Cheaper long sessions; slightly more summary loss.',
    loop: {
      maxWorkingSetTokens: ECONOMY_MAX_WORKING_SET_TOKENS,
      asyncWorkingSetTokens: ECONOMY_ASYNC_WORKING_SET_TOKENS,
    },
  },
  {
    id: 'deep',
    label: 'Deep context',
    badge: 'more memory',
    description:
      'Hold more live history (~384k) before full summarize. Use for long refactors.',
    loop: {
      maxWorkingSetTokens: DEEP_MAX_WORKING_SET_TOKENS,
      asyncWorkingSetTokens: DEEP_ASYNC_WORKING_SET_TOKENS,
    },
  },
  {
    id: 'full_window',
    label: 'Full model window',
    badge: 'highest cost',
    description:
      'Disable the working-set cap. Auto-compact follows ratio only (can wait until most of a 1M window is full).',
    loop: {
      maxWorkingSetTokens: 0,
      asyncWorkingSetTokens: 0,
    },
  },
] as const;

export function contextWorkingSetPresetById(
  id: string,
): ContextWorkingSetPreset | undefined {
  return CONTEXT_WORKING_SET_PRESETS.find((preset) => preset.id === id);
}

/**
 * Infer which preset best matches the current loopControl values.
 * Returns undefined when the config is custom / unrecognized.
 */
export function matchContextWorkingSetPreset(input: {
  readonly maxWorkingSetTokens?: number | undefined;
  readonly asyncWorkingSetTokens?: number | undefined;
}): ContextWorkingSetPresetId | undefined {
  const max =
    input.maxWorkingSetTokens ?? BALANCED_MAX_WORKING_SET_TOKENS;
  const async =
    input.asyncWorkingSetTokens ?? BALANCED_ASYNC_WORKING_SET_TOKENS;

  for (const preset of CONTEXT_WORKING_SET_PRESETS) {
    if (
      preset.loop.maxWorkingSetTokens === max &&
      preset.loop.asyncWorkingSetTokens === async
    ) {
      return preset.id;
    }
  }
  return undefined;
}

export function formatTokenCount(tokens: number): string {
  if (tokens <= 0) return 'off';
  if (tokens >= 1_000_000) {
    const m = tokens / 1_000_000;
    return Number.isInteger(m) ? `${String(m)}M` : `${m.toFixed(1)}M`;
  }
  if (tokens >= 1_000) {
    const k = tokens / 1_000;
    return Number.isInteger(k) ? `${String(k)}k` : `${k.toFixed(0)}k`;
  }
  return String(tokens);
}

/**
 * Preview soft/async thresholds for a preset against the active model window.
 * When the window is unknown, shows the raw cap values.
 */
export function previewContextWorkingSet(input: {
  readonly preset: ContextWorkingSetPreset;
  readonly maxContextTokens?: number | undefined;
  readonly softRatio?: number;
  readonly asyncRatio?: number;
}): ContextWorkingSetPreview {
  const softRatio = input.softRatio ?? 0.8;
  const asyncRatio = input.asyncRatio ?? 0.7;
  const window = input.maxContextTokens;
  const windowLabel =
    window !== undefined && window > 0 ? formatTokenCount(window) : 'unknown';

  const softCap = input.preset.loop.maxWorkingSetTokens;
  const asyncCap = input.preset.loop.asyncWorkingSetTokens;

  if (window === undefined || window <= 0) {
    return {
      softTokens: softCap > 0 ? softCap : null,
      asyncTokens: asyncCap > 0 ? asyncCap : null,
      softLabel: softCap > 0 ? `~${formatTokenCount(softCap)} soft` : 'ratio only',
      asyncLabel: asyncCap > 0 ? `~${formatTokenCount(asyncCap)} async` : 'ratio only',
      windowLabel,
    };
  }

  const ratioSoft = Math.floor(window * softRatio);
  const ratioAsync = Math.floor(window * asyncRatio);
  const softTokens =
    softCap > 0 && softCap < window ? Math.min(ratioSoft, softCap) : ratioSoft;
  const asyncTokens =
    asyncCap > 0 && asyncCap < window
      ? Math.min(ratioAsync, asyncCap, Math.max(0, softTokens - 1))
      : Math.min(ratioAsync, Math.max(0, softTokens - 1));

  return {
    softTokens,
    asyncTokens,
    softLabel: `soft @ ${formatTokenCount(softTokens)}`,
    asyncLabel: `async @ ${formatTokenCount(asyncTokens)}`,
    windowLabel,
  };
}

/** Build a loopControl patch for setConfig from a preset. */
export function loopControlPatchForPreset(
  preset: ContextWorkingSetPreset,
): ContextWorkingSetLoopPatch {
  return { ...preset.loop };
}

/** Snapshot stored on AppState for footer / usage rendering. */
export interface ContextWorkingSetSnapshot {
  readonly maxWorkingSetTokens: number;
  readonly asyncWorkingSetTokens: number;
  readonly presetId?: ContextWorkingSetPresetId;
}

/**
 * Build a UI snapshot from loopControl (+ optional known preset).
 * Missing values fall back to balanced defaults so the badge stays stable.
 */
export function contextWorkingSetSnapshotFromLoopControl(input: {
  readonly maxWorkingSetTokens?: number | undefined;
  readonly asyncWorkingSetTokens?: number | undefined;
  readonly model?: string | undefined;
  readonly provider?: string | undefined;
}): ContextWorkingSetSnapshot {
  const applied = applyXaiPricingSafeWorkingSet({
    model: input.model,
    provider: input.provider,
    maxWorkingSetTokens: input.maxWorkingSetTokens ?? BALANCED_MAX_WORKING_SET_TOKENS,
    asyncWorkingSetTokens: input.asyncWorkingSetTokens ?? BALANCED_ASYNC_WORKING_SET_TOKENS,
  });
  const { maxWorkingSetTokens, asyncWorkingSetTokens } = applied;
  const presetId = matchContextWorkingSetPreset({
    maxWorkingSetTokens,
    asyncWorkingSetTokens,
  });
  return {
    maxWorkingSetTokens,
    asyncWorkingSetTokens,
    ...(presetId !== undefined ? { presetId } : {}),
  };
}

/**
 * Effective soft full-compact threshold for the active model window.
 * Mirrors engine policy: min(ratio * window, cap) when cap is active.
 */
export function effectiveSoftWorkingSetTokens(input: {
  readonly maxContextTokens: number;
  readonly maxWorkingSetTokens: number;
  readonly softRatio?: number;
}): number {
  if (input.maxContextTokens <= 0) {
    return input.maxWorkingSetTokens > 0 ? input.maxWorkingSetTokens : 0;
  }
  const softRatio = input.softRatio ?? 0.8;
  const ratioThreshold = Math.floor(input.maxContextTokens * softRatio);
  if (input.maxWorkingSetTokens <= 0 || input.maxWorkingSetTokens >= input.maxContextTokens) {
    return ratioThreshold;
  }
  return Math.min(ratioThreshold, input.maxWorkingSetTokens);
}

/**
 * Usage against the soft working-set (not the full model window).
 * Returns null when the threshold cannot be resolved.
 */
export function workingSetUsageRatio(input: {
  readonly contextTokens: number;
  readonly maxContextTokens: number;
  readonly maxWorkingSetTokens: number;
  readonly softRatio?: number;
}): number | null {
  const soft = effectiveSoftWorkingSetTokens({
    maxContextTokens: input.maxContextTokens,
    maxWorkingSetTokens: input.maxWorkingSetTokens,
    softRatio: input.softRatio,
  });
  if (soft <= 0) return null;
  return Math.max(0, Math.min(1, input.contextTokens / soft));
}

/**
 * Compact footer badge label, e.g. `ws:256k` or `ws:full`.
 * Returns null only when we have no snapshot at all (should not happen once synced).
 */
export function formatWorkingSetFooterBadgeText(
  snapshot: ContextWorkingSetSnapshot | null | undefined,
): string | null {
  if (snapshot === undefined || snapshot === null) return null;
  if (snapshot.maxWorkingSetTokens <= 0) {
    return snapshot.presetId === 'full_window' ? 'ws:full' : 'ws:off';
  }
  return `ws:${formatTokenCount(snapshot.maxWorkingSetTokens)}`;
}

export type WorkingSetPressure = 'ok' | 'warn' | 'danger';

/** Pressure of live tokens against the soft working-set threshold. */
export function workingSetPressure(input: {
  readonly contextTokens: number;
  readonly maxContextTokens: number;
  readonly maxWorkingSetTokens: number;
  readonly softRatio?: number;
}): WorkingSetPressure {
  const ratio = workingSetUsageRatio(input);
  if (ratio === null) return 'ok';
  if (ratio >= 0.95) return 'danger';
  if (ratio >= 0.8) return 'warn';
  return 'ok';
}
