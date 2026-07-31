import type { BenchStatus } from './bench-types';
import { asNumber, asString } from './bench-parse';

export function formatScore(score: number | undefined): string {
  return score === undefined ? 'unavailable' : score.toFixed(2);
}

export function formatPassRate(passRate: number | undefined): string {
  if (passRate === undefined) return 'unavailable';
  return `${Math.round(passRate * 100)}%`;
}

export function formatDelta(delta: number | undefined): string {
  if (delta === undefined) return 'unavailable';
  return `${delta >= 0 ? '+' : ''}${delta.toFixed(2)}`;
}

export function formatDurationMs(durationMs: number | undefined): string {
  if (durationMs === undefined) return 'unavailable';
  if (durationMs < 1000) return `${Math.round(durationMs)}ms`;
  const seconds = durationMs / 1000;
  if (seconds < 60) return `${seconds.toFixed(seconds < 10 ? 1 : 0)}s`;
  const minutes = seconds / 60;
  return `${minutes.toFixed(minutes < 10 ? 1 : 0)}m`;
}

export function formatMetric(value: number | undefined): string {
  return value === undefined ? 'unknown' : String(value);
}

export function formatBoolean(value: boolean | undefined): string {
  return value === undefined ? 'unknown' : String(value);
}

export function formatHoldout(holdout: Record<string, unknown> | null): string | undefined {
  if (holdout === null) return undefined;
  const status = asString(holdout['status']) ?? 'not recorded';
  const selected = asNumber(holdout['selected']);
  const available = asNumber(holdout['available']);
  if (selected !== undefined && available !== undefined) return `${status} (${selected}/${available})`;
  return status;
}

export function providerBlockLine(
  preflight: string | undefined,
  missingEnv: readonly string[],
  providerCallStarted: boolean | undefined,
): string {
  if (preflight === undefined || preflight === 'not_applicable') return 'not blocked';
  const missing = missingEnv.length > 0 ? `: ${missingEnv.join(', ')}` : '';
  const callState = providerCallStarted === undefined ? '' : `; providerCallStarted=${providerCallStarted}`;
  return `${preflight}${missing}${callState}`;
}

export function nextActionFor(preflight: string | undefined, missingEnv: readonly string[]): string {
  if (preflight === 'blocked_missing_env' || missingEnv.length > 0) {
    return `Set ${missingEnv.join('/')} and rerun node scripts/liora-agent-bench.mjs --suite holdout --runner provider.`;
  }
  return 'Run the next bounded Mission loop only after recording fresh benchmark evidence.';
}

export function budgetLine(status: BenchStatus): string {
  if (status.budget === undefined) return 'not recorded';
  const exceeded = status.budgetExceeded === undefined ? 'unknown' : String(status.budgetExceeded);
  return `${status.budget}; exceeded ${exceeded}`;
}

export function budgetActionLines(status: BenchStatus): string[] {
  if (status.budget !== 'FAIL' || status.budgetTasks === undefined || status.budgetTasks.length === 0) return [];
  const topTask = status.budgetTasks[0];
  if (topTask === undefined) return [];
  const lines = [`top  ${topTask.id}`];
  if (topTask.violations.length > 0) lines.push(`detail  ${topTask.violations.slice(0, 3).join('; ')}`);
  if (status.budgetInspect !== undefined) lines.push(`inspect  ${status.budgetInspect}`);
  if (status.budgetRerun !== undefined) lines.push(`rerun  ${status.budgetRerun}`);
  return lines;
}
