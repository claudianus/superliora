/**
 * UI-facing context reclaim ladder.
 *
 * Values come from `@superliora/sdk` (agent-core DEFAULT_COMPACTION_*), so TUI
 * severity /compact hints cannot densify away from the engine/docs contract.
 */
import {
  DEFAULT_ASYNC_COMPACTION_TRIGGER_RATIO,
  DEFAULT_COMPACTION_BLOCK_RATIO,
  DEFAULT_COMPACTION_TRIGGER_RATIO,
} from '@superliora/sdk';

import { safeUsageRatio } from './usage-format';

/** Async pre-rot band — surface as early info, not panic. */
export const CONTEXT_ASYNC_RATIO = DEFAULT_ASYNC_COMPACTION_TRIGGER_RATIO;
/** Soft reclaim / handoff — prefer /compact before long work. */
export const CONTEXT_SOFT_RATIO = DEFAULT_COMPACTION_TRIGGER_RATIO;
/** Hard block ratio from engine defaults (for docs/status copy). */
export const CONTEXT_HARD_RATIO = DEFAULT_COMPACTION_BLOCK_RATIO;
/**
 * Near-hard UI danger band. Slightly under hard so operators see danger before
 * the engine hard-blocks the turn.
 */
export const CONTEXT_DANGER_RATIO = 0.9;

export type ContextUsageSeverity = 'muted' | 'info' | 'warning' | 'danger';

export function contextUsageSeverity(usage: number): ContextUsageSeverity {
  const ratio = safeUsageRatio(usage);
  if (ratio >= CONTEXT_DANGER_RATIO) return 'danger';
  if (ratio >= CONTEXT_SOFT_RATIO) return 'warning';
  if (ratio >= CONTEXT_ASYNC_RATIO) return 'info';
  return 'muted';
}

export function contextNeedsCompact(usage: number): boolean {
  return safeUsageRatio(usage) >= CONTEXT_SOFT_RATIO;
}

export function contextIsHigh(usage: number, maxTokens: number): boolean {
  return maxTokens > 0 && contextNeedsCompact(usage);
}
