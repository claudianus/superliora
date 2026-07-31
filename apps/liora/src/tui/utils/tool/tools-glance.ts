/**
 * Tools settings glance — hide-legacy env gate + compat alias inventory (SSOT: agent-core builtin-tools).
 */

import {
  formatProfileLiveStatusLine,
  type ProfileLiveGlance,
} from '#/tui/utils/agent/profile-glance';
import { SOVEREIGN_UMBRELLA_ENV, isSovereignUmbrellaEnabled } from '#/tui/utils/host/host-glance';

export { SOVEREIGN_UMBRELLA_ENV };

export const HIDE_LEGACY_TOOL_NAMES_ENV = 'SUPERLIORA_HIDE_LEGACY_TOOL_NAMES';
export const SHOW_LEGACY_TOOL_NAMES_ENV = 'SUPERLIORA_SHOW_LEGACY_TOOL_NAMES';

export type HideLegacyTrigger =
  | typeof HIDE_LEGACY_TOOL_NAMES_ENV
  | typeof SOVEREIGN_UMBRELLA_ENV
  | 'default';

export interface HideLegacyToolsGlance {
  readonly enabled: boolean;
  readonly trigger: HideLegacyTrigger | null;
  readonly hiddenCompatCount: number;
}

function nonEmptyEnv(name: string, env: NodeJS.ProcessEnv): string | undefined {
  const value = env[name]?.trim();
  return value !== undefined && value.length > 0 ? value : undefined;
}

function isTruthyEnvFlag(value: string | undefined): boolean {
  const flag = value?.trim();
  if (flag === undefined || flag.length === 0) return false;
  return flag === '1' || flag.toLowerCase() === 'true';
}

/** Mirrors agent-core hide-legacy gate — product default ON; SHOW_LEGACY opt-out. */
export function isHideLegacyToolNamesEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  if (isTruthyEnvFlag(env[SHOW_LEGACY_TOOL_NAMES_ENV])) return false;
  return true;
}

export function resolveHideLegacyToolsGlance(input: {
  readonly hiddenCompatAliases: readonly string[];
  readonly env?: NodeJS.ProcessEnv;
}): HideLegacyToolsGlance {
  const env = input.env ?? process.env;
  const hiddenCompatCount = input.hiddenCompatAliases.length;
  if (!isHideLegacyToolNamesEnabled(env)) {
    return { enabled: false, trigger: null, hiddenCompatCount };
  }
  const trigger: HideLegacyTrigger =
    nonEmptyEnv(HIDE_LEGACY_TOOL_NAMES_ENV, env) !== undefined
      ? HIDE_LEGACY_TOOL_NAMES_ENV
      : isSovereignUmbrellaEnabled(env)
        ? SOVEREIGN_UMBRELLA_ENV
        : 'default';
  return { enabled: true, trigger, hiddenCompatCount };
}

/** Live status for Settings → Tools Session (live) block. */
export function formatHideLegacyToolsStatusLine(glance: HideLegacyToolsGlance): string {
  const countLabel = `${String(glance.hiddenCompatCount)} compat alias(es) off primary help`;
  if (!glance.enabled || glance.trigger == null) {
    return `Hide legacy: OFF · ${countLabel}`;
  }
  if (glance.trigger === 'default') {
    return `Hide legacy: ON (default) · ${countLabel}`;
  }
  return `Hide legacy: ON (${glance.trigger}=1) · ${countLabel}`;
}

export function buildToolsSessionLiveLines(input: {
  readonly activeCount: number;
  readonly registeredCount: number;
  readonly hideLegacy: HideLegacyToolsGlance;
  readonly profile: ProfileLiveGlance;
}): readonly string[] {
  return [
    '── Session (live) ───────────────────────────',
    formatProfileLiveStatusLine(input.profile),
    `Tools: ${String(input.activeCount)} active / ${String(input.registeredCount)} registered`,
    formatHideLegacyToolsStatusLine(input.hideLegacy),
    '',
  ];
}
