import { readFileSync, statSync, type Stats } from 'node:fs';

export function readJson(path: string): unknown {
  try {
    return JSON.parse(readFileSync(path, 'utf8')) as unknown;
  } catch {
    return null;
  }
}

export function safeStat(path: string): Stats | null {
  try {
    return statSync(path);
  } catch {
    return null;
  }
}

export function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

export function asString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim().length > 0 ? value : undefined;
}

export function asNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

export function asBoolean(value: unknown): boolean | undefined {
  return typeof value === 'boolean' ? value : undefined;
}

export function stringList(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];
}

export function timestampOf(record: Record<string, unknown>, path: string): number {
  const value = asString(record['completedAt']) ?? asString(record['createdAt']) ?? asString(record['startedAt']);
  const parsed = value === undefined ? Number.NaN : Date.parse(value);
  if (Number.isFinite(parsed)) return parsed;
  return safeStat(path)?.mtimeMs ?? 0;
}
