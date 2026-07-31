/**
 * Prompt-cache prefix stability + miss-reason histogram — Ops + Settings formatting.
 * Reads optional UsageStatus.cacheDiagnostics from getStatus / events.
 */

/** Provider-reported miss buckets (W1 stub — wired when agent-core emits counts). */
export const CACHE_MISS_REASON_KEYS = [
  'schema_change',
  'prefix_drift',
  'model_switch',
] as const;

export type CacheMissReason = (typeof CACHE_MISS_REASON_KEYS)[number];

export type CacheMissReasonHistogram = Partial<Record<CacheMissReason, number>>;

export const CACHE_MISS_REASON_STUB_TIP =
  'Miss reasons: schema_change · prefix_drift · model_switch (when provider reports)';

export interface CacheDiagnosticsLike {
  readonly toolBlockChanged?: boolean;
  /** Future: per-reason miss counts from provider / harness telemetry. */
  readonly missReasons?: CacheMissReasonHistogram;
}

export interface CacheDiagnosticsLine {
  readonly line: string;
  readonly warn: boolean;
}

export interface UsageCacheMissLike {
  readonly cacheDiagnostics?: CacheDiagnosticsLike;
  readonly cacheMissReasons?: CacheMissReasonHistogram;
}

/** One-liner when cacheDiagnostics is present; null before first step. */
export function formatCacheDiagnosticsLine(
  diagnostics: CacheDiagnosticsLike | undefined | null,
): CacheDiagnosticsLine | null {
  if (diagnostics == null || typeof diagnostics.toolBlockChanged !== 'boolean') {
    return null;
  }
  return diagnostics.toolBlockChanged
    ? { line: 'Prefix: tool block changed', warn: true }
    : { line: 'Prefix: stable', warn: false };
}

/** Resolve histogram from usage-level or nested cacheDiagnostics missReasons. */
export function resolveCacheMissReasonHistogram(
  usage: UsageCacheMissLike | undefined | null,
): CacheMissReasonHistogram | undefined {
  if (usage == null) return undefined;
  const top = usage.cacheMissReasons;
  const nested = usage.cacheDiagnostics?.missReasons;
  if (top == null && nested == null) return undefined;
  return { ...nested, ...top };
}

/** Compact histogram line when any bucket has counts; null when empty or missing. */
export function formatCacheMissReasonHistogram(
  histogram: CacheMissReasonHistogram | undefined | null,
): CacheDiagnosticsLine | null {
  if (histogram == null) return null;
  const entries = CACHE_MISS_REASON_KEYS.flatMap((key) => {
    const count = histogram[key];
    return typeof count === 'number' && count > 0 ? [{ key, count }] : [];
  });
  if (entries.length === 0) return null;
  const total = entries.reduce((sum, entry) => sum + entry.count, 0);
  const parts = entries.map((entry) => {
    const pct = total > 0 ? Math.round((entry.count / total) * 100) : 0;
    return `${entry.key} ${String(pct)}%`;
  });
  return {
    line: `Miss reasons: ${parts.join(' · ')}`,
    warn: entries.some((entry) => entry.key !== 'model_switch'),
  };
}

/** Settings/Ops helper: live histogram or null (caller adds stub tip in Settings). */
export function formatCacheMissReasonGlance(
  usage: UsageCacheMissLike | undefined | null,
): CacheDiagnosticsLine | null {
  return formatCacheMissReasonHistogram(resolveCacheMissReasonHistogram(usage));
}

/** Ops Runtime Health line from usage.cacheDiagnostics.missReasons; null when empty. */
export function formatCacheMissReasonOpsHealthLine(
  usage: UsageCacheMissLike | undefined | null,
): string | null {
  return formatCacheMissReasonGlance(usage)?.line ?? null;
}
