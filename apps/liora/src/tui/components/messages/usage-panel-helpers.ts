import { ratioSeverity } from '#/utils/usage/usage-format';

import type { ManagedUsageRow } from './usage-panel-types';

export type Colorize = (text: string) => string;

/** Align with soft compaction trigger (0.70) and async pre-rot wrap-up (0.55). */
export const CONTEXT_COMPACT_RATIO = 0.70;
export const CONTEXT_WRAP_UP_RATIO = 0.55;
export const CACHE_READY_RATIO = 0.5;

export function usageNumber(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : 0;
}

export function usedRatio(row: ManagedUsageRow): number {
  return row.limit > 0 ? Math.max(0, Math.min(row.used / row.limit, 1)) : 0;
}

export function severityColorToken(sev: 'ok' | 'warn' | 'danger'): 'success' | 'warning' | 'error' {
  return sev === 'danger' ? 'error' : sev === 'warn' ? 'warning' : 'success';
}

export function severityColor(sev: 'ok' | 'warn' | 'danger'): 'success' | 'warning' | 'error' {
  return severityColorToken(sev);
}

export function quotaRowRatio(row: { readonly used: number; readonly limit: number }): number {
  return row.limit > 0 ? Math.max(0, Math.min(row.used / row.limit, 1)) : 0;
}

export function shortAccountKey(accountKey: string): string {
  const trimmed = accountKey.trim();
  if (trimmed.length === 0) return 'account';
  const slash = trimmed.lastIndexOf('/');
  return slash >= 0 ? trimmed.slice(slash + 1) : trimmed;
}

export { ratioSeverity };
