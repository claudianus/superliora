import type { UsageRow } from '../kimi/managed-usage';
import { isRecord } from '../utils';
import type { ProviderUsageRow } from './provider-usage-types';

export function toProviderUsageRow(row: UsageRow): ProviderUsageRow {
  return { label: row.label, used: row.used, limit: row.limit, resetHint: row.resetHint };
}

export function numField(obj: Record<string, unknown>, key: string): number | null {
  const v = obj[key];
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

export function formatResetHint(resetAtMs: number | null): string | undefined {
  if (resetAtMs === null) return undefined;
  const deltaMs = resetAtMs - Date.now();
  if (deltaMs <= 0) return 'resetting…';
  const mins = Math.ceil(deltaMs / 60_000);
  if (mins < 60) return `resets in ${String(mins)}m`;
  const hours = Math.floor(mins / 60);
  const remMins = mins % 60;
  if (hours < 24) return `resets in ${String(hours)}h${remMins > 0 ? ` ${String(remMins)}m` : ''}`;
  const days = Math.floor(hours / 24);
  return `resets in ${String(days)}d ${String(hours % 24)}h`;
}

export function firstRecord(obj: Record<string, unknown>, ...keys: string[]): Record<string, unknown> | null {
  for (const key of keys) {
    const v = obj[key];
    if (isRecord(v)) return v;
  }
  return null;
}

export function headerNum(res: Response, name: string): number | null {
  const raw = res.headers.get(name);
  if (raw === null) return null;
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
}

export function headerResetHint(res: Response, name: string): string | undefined {
  const raw = res.headers.get(name);
  if (raw === null) return undefined;
  // Anthropic uses RFC 3339 timestamps; OpenAI/xAI use durations like "6m0s".
  const asDate = Date.parse(raw);
  if (!Number.isNaN(asDate)) {
    return formatResetHint(asDate);
  }
  // Duration format (e.g. "1s", "6m0s", "1h30m").
  return `resets in ${raw}`;
}
