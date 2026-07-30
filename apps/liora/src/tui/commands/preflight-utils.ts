import { readFileSync, statSync } from 'node:fs';

export function displayPath(workDir: string, path: string): string {
  const prefix = `${workDir}/`;
  return path.startsWith(prefix) ? path.slice(prefix.length) : path;
}

export function readJsonRecord(path: string): Record<string, unknown> | undefined {
  try {
    return asRecord(JSON.parse(readFileSync(path, 'utf8')));
  } catch {
    return undefined;
  }
}

export function readText(path: string): string | undefined {
  try {
    return readFileSync(path, 'utf8');
  } catch {
    return undefined;
  }
}

export function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

export function numberField(record: Record<string, unknown> | undefined, key: string): number | undefined {
  const value = record?.[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

export function timestampField(record: Record<string, unknown>): string | undefined {
  for (const key of ['completedAt', 'finishedAt', 'endedAt', 'updatedAt']) {
    const value = record[key];
    if (typeof value === 'string' && value.length > 0) return value;
  }
  return undefined;
}

export function fileMtimeMs(path: string): number | undefined {
  try {
    return statSync(path).mtimeMs;
  } catch {
    return undefined;
  }
}

export function fileTimestamp(path: string): number {
  try {
    return statSync(path).mtimeMs;
  } catch {
    return 0;
  }
}

export function formatDuration(durationMs: number): string {
  const minuteMs = 60 * 1000;
  const hourMs = 60 * minuteMs;
  const dayMs = 24 * hourMs;
  if (durationMs < minuteMs) return '0m';
  if (durationMs < hourMs) return `${Math.floor(durationMs / minuteMs)}m`;
  if (durationMs <= dayMs) return `${Math.floor(durationMs / hourMs)}h`;
  return `${Math.floor(durationMs / dayMs)}d`;
}

export function formatMetric(value: number | undefined, suffix = ''): string {
  return value === undefined ? 'unknown' : `${String(Math.round(value))}${suffix}`;
}

export function formatElapsed(durationMs: number): string {
  if (durationMs < 1000) return `${Math.max(0, Math.round(durationMs))}ms`;
  if (durationMs < 60 * 1000) return `${(durationMs / 1000).toFixed(1)}s`;
  return formatDuration(durationMs);
}

export function formatScore(score: number | undefined): string {
  return score === undefined ? 'unavailable' : score.toFixed(2);
}

export function formatSignedDelta(delta: number): string {
  return `${delta >= 0 ? '+' : ''}${delta.toFixed(2)}`;
}

export function formatPassRate(passRate: number | undefined): string {
  if (passRate === undefined) return 'unavailable';
  return `${Math.round(passRate * 100)}%`;
}

export function formatPreflightError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function readyWord(ready: boolean): string {
  return ready ? 'ready' : 'blocked';
}

export function missingPhrases(text: string, phrases: readonly string[]): readonly string[] {
  return phrases.filter((phrase) => !text.includes(phrase));
}
