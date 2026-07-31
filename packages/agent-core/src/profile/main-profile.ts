import type { LioraConfig } from '../config/schema';
import type { ResolvedAgentProfile } from './types';

/** Wide-waist bundled profile name (opt-out from Core≤12). */
export const DEFAULT_MAIN_AGENT_PROFILE_NAME = 'agent';

/** Env override for the main agent profile (`core`, `agent`, `superliora-full`, …). */
export const MAIN_AGENT_PROFILE_ENV = 'SUPERLIORA_PROFILE';

/**
 * Legacy soft opt-in for Core waist / related gates. Profile hard-default is already
 * {@link SOVEREIGN_CORE_PROFILE_NAME}; this env still flips other sovereign soft gates
 * (repo-index warm, etc.) and keeps older docs working.
 */
export const SOVEREIGN_CORE_DEFAULT_ENV = 'SUPERLIORA_SOVEREIGN_CORE';

/**
 * Umbrella sovereign opt-in: enables multiple sovereign reform soft gates together.
 */
export const SOVEREIGN_UMBRELLA_ENV = 'SUPERLIORA_SOVEREIGN';

/** Sovereign Core waist (Core≤12 SSOT). Hard default when profile env/config unset. */
export const SOVEREIGN_CORE_PROFILE_NAME = 'core';

/** Opt out of Core≤12: set SUPERLIORA_PROFILE=agent or agent.profile = "agent". */
export const SOVEREIGN_CORE_CUTOVER_TIP =
  'Default profile is core (Core≤12). Wide waist: SUPERLIORA_PROFILE=agent or agent.profile = "agent".';
/** Bundled profiles suitable for the main agent (documentation / validation aid). */
export const KNOWN_MAIN_AGENT_PROFILE_NAMES = [
  SOVEREIGN_CORE_PROFILE_NAME,
  DEFAULT_MAIN_AGENT_PROFILE_NAME,
  'superliora-full',
  'coder',
  'explore',
  'plan',
  'ultra-plan',
] as const;

type Env = Readonly<Record<string, string | undefined>>;

function trimmed(value: string | undefined): string | undefined {
  const t = value?.trim();
  return t === undefined || t.length === 0 ? undefined : t;
}

/**
 * Resolve the main agent profile name from env (highest) then config.
 * Hard default is Sovereign Core (`core`, Core≤12). Wide waist via
 * `SUPERLIORA_PROFILE=agent` or `agent.profile = "agent"`.
 * Does not validate that the profile exists in the bundled catalog.
 */
export function resolveMainAgentProfileName(
  config?: Pick<LioraConfig, 'agent'> | undefined,
  env: Env = process.env,
): string {
  const fromEnv = trimmed(env[MAIN_AGENT_PROFILE_ENV]);
  if (fromEnv !== undefined) return fromEnv;
  const fromConfig = trimmed(config?.agent?.profile);
  if (fromConfig !== undefined) return fromConfig;
  return SOVEREIGN_CORE_PROFILE_NAME;
}

/**
 * Resolve the main agent profile object from the bundled catalog.
 * Throws when the requested name is missing.
 */
export function resolveMainAgentProfile(
  profiles: Readonly<Record<string, ResolvedAgentProfile>>,
  config?: Pick<LioraConfig, 'agent'> | undefined,
  env: Env = process.env,
): ResolvedAgentProfile {
  const name = resolveMainAgentProfileName(config, env);
  const profile = profiles[name];
  if (profile === undefined) {
    const known = Object.keys(profiles).toSorted().join(', ');
    throw new Error(`Agent profile "${name}" was not found. Available bundled profiles: ${known}`);
  }
  return profile;
}
