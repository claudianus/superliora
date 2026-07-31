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

export type HideLegacyTrigger = typeof HIDE_LEGACY_TOOL_NAMES_ENV | typeof SOVEREIGN_UMBRELLA_ENV;

export interface HideLegacyToolsGlance {
  readonly enabled: boolean;
  readonly trigger: HideLegacyTrigger | null;
  readonly hiddenCompatCount: number;
}

function nonEmptyEnv(name: string, env: NodeJS.ProcessEnv): string | undefined {
  const value = env[name]?.trim();
  return value !== undefined && value.length > 0 ? value : undefined;
}

/** Mirrors agent-core shouldRegisterLegacyCompat soft gate (env or sovereign umbrella). */
export function isHideLegacyToolNamesEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  if (nonEmptyEnv(HIDE_LEGACY_TOOL_NAMES_ENV, env) !== undefined) return true;
  return isSovereignUmbrellaEnabled(env);
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
  const trigger =
    nonEmptyEnv(HIDE_LEGACY_TOOL_NAMES_ENV, env) !== undefined
      ? HIDE_LEGACY_TOOL_NAMES_ENV
      : SOVEREIGN_UMBRELLA_ENV;
  return { enabled: true, trigger, hiddenCompatCount };
}

/** Live status for Settings → Tools Session (live) block. */
export function formatHideLegacyToolsStatusLine(glance: HideLegacyToolsGlance): string {
  const countLabel = `${String(glance.hiddenCompatCount)} compat alias(es) off primary help`;
  if (!glance.enabled || glance.trigger == null) {
    return `Hide legacy: OFF · ${countLabel}`;
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
