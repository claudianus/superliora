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

/** Mirrors bundled profiles in packages/agent-core/src/profile/default/*.yaml */
export const KNOWN_MAIN_AGENT_PROFILE_NAMES = [
  SOVEREIGN_CORE_PROFILE_NAME,
  DEFAULT_MAIN_AGENT_PROFILE_NAME,
  'superliora-full',
  'coder',
  'explore',
  'plan',
  'ultra-plan',
] as const;

export type SovereignCoreTrigger = typeof SOVEREIGN_CORE_DEFAULT_ENV | typeof SOVEREIGN_UMBRELLA_ENV;

export interface ProfileLiveGlance {
  readonly effectiveProfile: string;
  readonly sovereignCoreOptIn: boolean;
  readonly sovereignCoreTrigger: SovereignCoreTrigger | null;
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
  if (isSovereignCoreDefaultEnabled(env)) return SOVEREIGN_CORE_PROFILE_NAME;
  return SOVEREIGN_CORE_PROFILE_NAME;
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
  return { effectiveProfile, sovereignCoreOptIn, sovereignCoreTrigger };
}

/** Live status for Settings → Tools Session (live) block. */
export function formatProfileLiveStatusLine(glance: ProfileLiveGlance): string {
  const waist =
    glance.effectiveProfile === SOVEREIGN_CORE_PROFILE_NAME
      ? glance.sovereignCoreOptIn && glance.sovereignCoreTrigger !== null
        ? `Core waist: ON (${glance.sovereignCoreTrigger}=1)`
        : 'Core waist: ON (default)'
      : 'Core waist: OFF';
  return `${waist} · Profile: ${glance.effectiveProfile}`;
}
