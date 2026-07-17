/**
 * Formatting helpers for the `/usage` slash command.
 *
 * Kept pure + ANSI-free so they're trivial to unit-test; the slash
 * command itself chalks the colour afterwards.
 */

import {
  CONTEXT_ASYNC_RATIO,
  CONTEXT_DANGER_RATIO,
  CONTEXT_SOFT_RATIO,
} from './context-ladder';

export function formatTokenCount(n: number): string {
  if (!Number.isFinite(n) || n < 0) return '0';
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(Math.round(n));
}

export function safeUsageRatio(ratio: number): number {
  return Number.isFinite(ratio) ? Math.max(0, Math.min(ratio, 1)) : 0;
}

/**
 * Map a usage ratio to a semantic colour token — the `/usage` renderer
 * translates these into palette hex values.
 *
 * Bands match the research-aligned compaction ladder (async / soft / near-hard).
 */
export function ratioSeverity(ratio: number): 'ok' | 'warn' | 'danger' {
  const value = safeUsageRatio(ratio);
  if (value >= CONTEXT_DANGER_RATIO) return 'danger';
  if (value >= CONTEXT_SOFT_RATIO) return 'warn';
  if (value >= CONTEXT_ASYNC_RATIO) return 'warn';
  return 'ok';
}
