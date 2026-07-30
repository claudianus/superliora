import { realpath, stat } from 'node:fs/promises';
import path from 'node:path';

import type { PluginDiagnostic } from './types';

export async function isFile(p: string): Promise<boolean> {
  try {
    return (await stat(p)).isFile();
  } catch {
    return false;
  }
}

export async function isDir(p: string): Promise<boolean> {
  try {
    return (await stat(p)).isDirectory();
  } catch {
    return false;
  }
}

export function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function isWithin(child: string, parent: string): boolean {
  const relative = path.relative(parent, child);
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

export async function resolvePluginRootReal(pluginRoot: string): Promise<string> {
  return realpath(pluginRoot).catch(() => pluginRoot);
}

/**
 * Resolve a `./`-relative path under the plugin root after symlink resolution.
 * Returns undefined and records a diagnostic when the path escapes the root.
 */
export async function resolvePluginPath(input: {
  readonly pluginRoot: string;
  readonly field: string;
  readonly value: string;
  readonly diagnostics: PluginDiagnostic[];
  readonly severity?: 'error' | 'warn';
}): Promise<string | undefined> {
  const severity = input.severity ?? 'warn';
  if (!input.value.startsWith('./')) {
    input.diagnostics.push({
      severity,
      message: `"${input.field}" path must start with "./" (got "${input.value}")`,
    });
    return undefined;
  }
  const absolute = path.resolve(input.pluginRoot, input.value);
  let real: string;
  try {
    real = await realpath(absolute);
  } catch {
    real = absolute;
  }
  const rootReal = await resolvePluginRootReal(input.pluginRoot);
  if (!isWithin(real, rootReal)) {
    input.diagnostics.push({
      severity,
      message: `"${input.field}" path resolves outside the plugin (${input.value})`,
    });
    return undefined;
  }
  return real;
}

export function stringField(raw: Record<string, unknown>, key: string): string | undefined {
  const value = raw[key];
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed.length === 0 ? undefined : trimmed;
}

export function stringArrayField(
  raw: Record<string, unknown>,
  key: string,
): readonly string[] | undefined {
  const value = raw[key];
  if (!Array.isArray(value) || !value.every((entry) => typeof entry === 'string')) {
    return undefined;
  }
  return value as readonly string[];
}

export function pathEntries(raw: unknown): string[] | undefined {
  if (typeof raw === 'string') return [raw];
  if (Array.isArray(raw) && raw.every((entry) => typeof entry === 'string')) {
    return [...raw];
  }
  return undefined;
}
