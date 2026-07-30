import type { PluginDiagnostic, PluginRecord } from './types';
import { normalizePluginId } from './types';

export interface DependencyResolution {
  readonly id: string;
  readonly range: string;
  readonly status: 'satisfied' | 'missing' | 'mismatch';
  readonly installedVersion?: string;
  readonly message: string;
}

/**
 * Check declared Claude `dependencies` against currently loaded plugin records.
 * Supports exact versions and simple `^` / `~` / `*` / `latest` ranges.
 */
export function resolvePluginDependencies(input: {
  readonly dependencies: Readonly<Record<string, string>> | undefined;
  readonly installed: readonly PluginRecord[];
}): {
  readonly resolutions: readonly DependencyResolution[];
  readonly diagnostics: readonly PluginDiagnostic[];
  readonly missingIds: readonly string[];
} {
  if (input.dependencies === undefined || Object.keys(input.dependencies).length === 0) {
    return { resolutions: [], diagnostics: [], missingIds: [] };
  }

  const byId = new Map(
    input.installed.map((record) => [normalizePluginId(record.id), record] as const),
  );
  const resolutions: DependencyResolution[] = [];
  const diagnostics: PluginDiagnostic[] = [];
  const missingIds: string[] = [];

  for (const [rawId, range] of Object.entries(input.dependencies)) {
    const id = normalizePluginId(rawId);
    const rangeText = range.trim() || '*';
    const installed = byId.get(id);
    if (installed === undefined) {
      const message = `dependency "${id}@${rangeText}" is not installed`;
      resolutions.push({ id, range: rangeText, status: 'missing', message });
      diagnostics.push({ severity: 'warn', message });
      missingIds.push(id);
      continue;
    }
    const version = installed.manifest?.version;
    if (version === undefined || satisfiesRange(version, rangeText)) {
      resolutions.push({
        id,
        range: rangeText,
        status: 'satisfied',
        installedVersion: version,
        message: `dependency "${id}@${rangeText}" satisfied${version !== undefined ? ` by ${version}` : ''}`,
      });
      continue;
    }
    const message = `dependency "${id}@${rangeText}" not satisfied by installed ${version}`;
    resolutions.push({
      id,
      range: rangeText,
      status: 'mismatch',
      installedVersion: version,
      message,
    });
    diagnostics.push({ severity: 'warn', message });
  }

  return { resolutions, diagnostics, missingIds };
}

/** True when installed version satisfies a Claude-style plugin dependency range. */
export function satisfiesRange(installedVersion: string, range: string): boolean {
  const rangeText = range.trim() || '*';
  if (rangeText === '*' || rangeText === 'latest') return true;
  const installed = parseSemver(installedVersion);
  if (installed === undefined) {
    return normalizeVersion(installedVersion) === normalizeVersion(rangeText.replace(/^[~^]/, ''));
  }
  if (rangeText.startsWith('^')) {
    const base = parseSemver(rangeText.slice(1));
    if (base === undefined) return false;
    if (base.major === 0) {
      return (
        installed.major === 0 &&
        installed.minor === base.minor &&
        installed.patch >= base.patch
      );
    }
    return installed.major === base.major && cmp(installed, base) >= 0;
  }
  if (rangeText.startsWith('~')) {
    const base = parseSemver(rangeText.slice(1));
    if (base === undefined) return false;
    return (
      installed.major === base.major &&
      installed.minor === base.minor &&
      installed.patch >= base.patch
    );
  }
  const exact = parseSemver(rangeText);
  if (exact === undefined) {
    return normalizeVersion(installedVersion) === normalizeVersion(rangeText);
  }
  return cmp(installed, exact) === 0;
}

function parseSemver(value: string): { major: number; minor: number; patch: number } | undefined {
  const m = /^v?(\d+)\.(\d+)\.(\d+)/i.exec(value.trim());
  if (m === null) return undefined;
  return { major: Number(m[1]), minor: Number(m[2]), patch: Number(m[3]) };
}

function cmp(
  a: { major: number; minor: number; patch: number },
  b: { major: number; minor: number; patch: number },
): number {
  if (a.major !== b.major) return a.major - b.major;
  if (a.minor !== b.minor) return a.minor - b.minor;
  return a.patch - b.patch;
}

function normalizeVersion(value: string): string {
  return value.trim().replace(/^v/i, '');
}
