/**
 * Profile settings glance — effective main-agent profile + Sovereign Core opt-in (SSOT §9.2).
 * Mirrors packages/agent-core/src/profile/main-profile.ts (TUI cannot import agent-core).
 */

import { SOVEREIGN_UMBRELLA_ENV, isSovereignUmbrellaEnabled } from '#/tui/utils/host/host-glance';

export { SOVEREIGN_UMBRELLA_ENV };

export const DEFAULT_MAIN_AGENT_PROFILE_NAME = 'agent';
export const MAIN_AGENT_PROFILE_ENV = 'SUPERLIORA_PROFILE';
export const SOVEREIGN_CORE_DEFAULT_ENV = 'SUPERLIORA_SOVEREIGN_CORE';
export const SOVEREIGN_CORE_PROFILE_NAME = 'core';
export const SOVEREIGN_CONDUCTOR_PROFILE_NAME = 'conductor';

/** Mirrors bundled profiles in packages/agent-core/src/profile/default/*.yaml */
export const KNOWN_MAIN_AGENT_PROFILE_NAMES = [
  SOVEREIGN_CONDUCTOR_PROFILE_NAME,
  SOVEREIGN_CORE_PROFILE_NAME,
  DEFAULT_MAIN_AGENT_PROFILE_NAME,
  'superliora-full',
  'coder',
  'explore',
  'plan',
  'ultra-plan',
] as const;

/**
 * Bundled always-on tool counts (SSOT with profile yaml; not live MCP).
 * Used for /status · /profile · Settings so guides never claim tools the waist lacks.
 */
export const KNOWN_PROFILE_TOOL_COUNTS: Readonly<Record<string, number>> = {
  // conductor.yaml whitelist length (builtins + mcp__* access pattern).
  [SOVEREIGN_CONDUCTOR_PROFILE_NAME]: 25,
  [SOVEREIGN_CORE_PROFILE_NAME]: 12,
  [DEFAULT_MAIN_AGENT_PROFILE_NAME]: 34,
  // superliora-full grows with visual/MCP globs — approximate floor for diagnostics only.
  'superliora-full': 50,
};

export type SovereignCoreTrigger = typeof SOVEREIGN_CORE_DEFAULT_ENV | typeof SOVEREIGN_UMBRELLA_ENV;

export interface ProfileLiveGlance {
  readonly effectiveProfile: string;
  readonly sovereignCoreOptIn: boolean;
  readonly sovereignCoreTrigger: SovereignCoreTrigger | null;
  /** Bundled waist size when known; undefined for custom / specialist profiles. */
  readonly expectedToolCount?: number;
}

function trimmed(value: string | undefined): string | undefined {
  const t = value?.trim();
  return t === undefined || t.length === 0 ? undefined : t;
}

function isTruthyEnvFlag(value: string | undefined): boolean {
  const flag = trimmed(value);
  if (flag === undefined) return false;
  return flag === '1' || flag.toLowerCase() === 'true';
}

/** Mirrors agent-core isSovereignCoreDefaultEnabled. */
export function isSovereignCoreDefaultEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return (
    isTruthyEnvFlag(env[SOVEREIGN_CORE_DEFAULT_ENV]) || isSovereignUmbrellaEnabled(env)
  );
}

/** Mirrors agent-core resolveMainAgentProfileName. */
export function resolveEffectiveProfileName(
  configProfile: string | undefined,
  envProfile: string | undefined,
  env: NodeJS.ProcessEnv = process.env,
): string {
  const fromEnv = trimmed(envProfile);
  if (fromEnv !== undefined) return fromEnv;
  const fromConfig = trimmed(configProfile);
  if (fromConfig !== undefined) return fromConfig;
  // Sovereign soft flags no longer force core; main hard-default is conductor (mirrors agent-core).
  return SOVEREIGN_CONDUCTOR_PROFILE_NAME;
}

export function expectedToolCountForProfile(profileName: string): number | undefined {
  return KNOWN_PROFILE_TOOL_COUNTS[profileName];
}

export function loadProfileLiveGlance(input: {
  readonly configProfile?: string;
  readonly env?: NodeJS.ProcessEnv;
}): ProfileLiveGlance {
  const env = input.env ?? process.env;
  const envProfile = trimmed(env[MAIN_AGENT_PROFILE_ENV]);
  const effectiveProfile = resolveEffectiveProfileName(input.configProfile, envProfile, env);
  const sovereignCoreOptIn = isSovereignCoreDefaultEnabled(env);
  const sovereignCoreTrigger = !sovereignCoreOptIn
    ? null
    : trimmed(env[SOVEREIGN_CORE_DEFAULT_ENV]) !== undefined
      ? SOVEREIGN_CORE_DEFAULT_ENV
      : SOVEREIGN_UMBRELLA_ENV;
  return {
    effectiveProfile,
    sovereignCoreOptIn,
    sovereignCoreTrigger,
    expectedToolCount: expectedToolCountForProfile(effectiveProfile),
  };
}

/**
 * Compact diagnostic: `profile=core tools=12` — kills guide/sensor mismatch
 * when system.md names Goal/SearchTools that core waist does not expose.
 */
export function formatProfileToolsBadge(glance: ProfileLiveGlance): string {
  const count = glance.expectedToolCount;
  if (count === undefined) {
    return `profile=${glance.effectiveProfile}`;
  }
  return `profile=${glance.effectiveProfile} tools=${String(count)}`;
}

/** Live status for Settings → Tools Session (live) block. */
export function formatProfileLiveStatusLine(glance: ProfileLiveGlance): string {
  if (glance.effectiveProfile === SOVEREIGN_CONDUCTOR_PROFILE_NAME) {
    return `Conductor: ON (default) · ${formatProfileToolsBadge(glance)}`;
  }
  if (glance.effectiveProfile === SOVEREIGN_CORE_PROFILE_NAME) {
    const waist =
      glance.sovereignCoreTrigger !== null
        ? `Core waist: ON (${glance.sovereignCoreTrigger}=1)`
        : 'Core waist: ON';
    return `${waist} · ${formatProfileToolsBadge(glance)}`;
  }
  return `Core waist: OFF · ${formatProfileToolsBadge(glance)}`;
}
