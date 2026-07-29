/**
 * Shared utilities for the `liora provider` CLI sub-command handlers.
 */

import {
  createLioraHarness,
  type LioraHarness,
} from '@superliora/sdk';

import { t, tln } from '#/cli/i18n';
import { createLioraHostIdentity } from '#/cli/version';

import type { ProviderDeps } from './types';

/* ------------------------------------------------------------------ */
/*  Output helpers                                                     */
/* ------------------------------------------------------------------ */

export function writeProviderErr(deps: ProviderDeps, key: string, params?: Record<string, string | number>): void {
  deps.stderr.write(tln(key, params));
}

export function writeProviderOut(deps: ProviderDeps, key: string, params?: Record<string, string | number>): void {
  deps.stdout.write(tln(key, params));
}

/* ------------------------------------------------------------------ */
/*  Unit word helpers                                                  */
/* ------------------------------------------------------------------ */

export function providerUnit(count: number): string {
  return t(count === 1 ? 'cli.runtime.provider.unit.provider' : 'cli.runtime.provider.unit.providers');
}

export function modelUnit(count: number): string {
  return t(count === 1 ? 'cli.runtime.provider.unit.model' : 'cli.runtime.provider.unit.models');
}

export function apiKeyWord(count: number): string {
  return t(count === 1 ? 'cli.runtime.provider.unit.apiKeyWord' : 'cli.runtime.provider.unit.apiKeysWord');
}

export function oauthRefWord(count: number): string {
  return t(count === 1 ? 'cli.runtime.provider.unit.oauthRef' : 'cli.runtime.provider.unit.oauthRefs');
}

export function aliasWord(count: number): string {
  return t(count === 1 ? 'cli.runtime.provider.unit.alias' : 'cli.runtime.provider.unit.aliases');
}

export function doctorErrorWord(count: number): string {
  return t(count === 1 ? 'cli.runtime.provider.unit.error' : 'cli.runtime.provider.unit.errors');
}

export function doctorWarningWord(count: number): string {
  return t(count === 1 ? 'cli.runtime.provider.unit.warning' : 'cli.runtime.provider.unit.warnings');
}

export function routeRole(index: number): string {
  return t(index === 0 ? 'cli.runtime.provider.rolePrimary' : 'cli.runtime.provider.roleFallback');
}

/* ------------------------------------------------------------------ */
/*  Dependency resolution                                              */
/* ------------------------------------------------------------------ */

export function resolveDeps(overrides: Partial<ProviderDeps> = {}): ProviderDeps {
  let harness: LioraHarness | undefined;
  const identity = createLioraHostIdentity();
  return {
    getHarness:
      overrides.getHarness ??
      (() => {
        harness ??= createLioraHarness({ identity });
        return harness;
      }),
    stdout: overrides.stdout ?? process.stdout,
    stderr: overrides.stderr ?? process.stderr,
    env: overrides.env ?? process.env,
    exit: overrides.exit ?? ((code: number) => process.exit(code)),
  };
}

export async function runAction(resolved: ProviderDeps, run: () => Promise<void>): Promise<void> {
  try {
    await run();
  } catch (error) {
    resolved.stderr.write(`${errorMessage(error)}\n`);
    resolved.exit(1);
  }
}

/* ------------------------------------------------------------------ */
/*  General utilities                                                  */
/* ------------------------------------------------------------------ */

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function nonEmptyString(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed === undefined || trimmed.length === 0 ? undefined : trimmed;
}

export function uniqueStrings(values: readonly string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const value of values) {
    const normalized = nonEmptyString(value);
    if (normalized === undefined || seen.has(normalized)) continue;
    seen.add(normalized);
    out.push(normalized);
  }
  return out;
}

export function optionalList<T>(value: T | undefined): T[] {
  return value === undefined ? [] : [value];
}

export function splitCommaList(value: string | undefined): string[] {
  if (value === undefined) return [];
  return uniqueStrings(value.split(',').map((entry) => entry.trim()));
}

export function parsePositiveInt(value: string, label: string, deps: ProviderDeps): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    writeProviderErr(deps, 'cli.runtime.provider.positiveIntRequired', { label });
    deps.exit(1);
  }
  return parsed;
}

export function parseEnvVarName(value: string, deps: ProviderDeps): string {
  const name = value.trim();
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) {
    writeProviderErr(deps, 'cli.runtime.provider.invalidEnvVarName', { name: value });
    deps.exit(1);
  }
  return name;
}

export function parseEnvReference(value: string): string | undefined {
  const patterns = [
    /^\{env:([A-Za-z_][A-Za-z0-9_]*)\}$/,
    /^env:([A-Za-z_][A-Za-z0-9_]*)$/,
    /^env\/([A-Za-z_][A-Za-z0-9_]*)$/,
    /^os\.environ\/([A-Za-z_][A-Za-z0-9_]*)$/,
  ];
  for (const pattern of patterns) {
    const match = pattern.exec(value);
    if (match?.[1] !== undefined) return match[1];
  }
  return undefined;
}

export function isHttpUrl(value: string): boolean {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    return false;
  }
  return parsed.protocol === 'http:' || parsed.protocol === 'https:';
}

export function formatDuration(ms: number): string {
  const seconds = Math.max(0, Math.ceil(ms / 1000));
  if (seconds < 60) return `${String(seconds)}s`;
  const minutes = Math.floor(seconds / 60);
  const remainder = seconds % 60;
  if (minutes < 60) return remainder === 0 ? `${String(minutes)}m` : `${String(minutes)}m${String(remainder)}s`;
  const hours = Math.floor(minutes / 60);
  const minuteRemainder = minutes % 60;
  return minuteRemainder === 0
    ? `${String(hours)}h`
    : `${String(hours)}h${String(minuteRemainder)}m`;
}

export function formatPercent(value: number): string {
  const percent = Math.round(Math.max(0, Math.min(1, value)) * 100);
  return `${String(percent)}%`;
}
