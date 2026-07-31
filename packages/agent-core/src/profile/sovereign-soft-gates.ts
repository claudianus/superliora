/**
 * Pure env gates for sovereign umbrella soft reform — no heavy imports.
 */

import {
  SOVEREIGN_CORE_DEFAULT_ENV,
  SOVEREIGN_UMBRELLA_ENV,
} from './main-profile';

export const HIDE_LEGACY_TOOL_NAMES_ENV = 'SUPERLIORA_HIDE_LEGACY_TOOL_NAMES';
/** Opt out of hide-legacy product default (legacy compat aliases register again). */
export const SHOW_LEGACY_TOOL_NAMES_ENV = 'SUPERLIORA_SHOW_LEGACY_TOOL_NAMES';
export const REPO_INDEX_WARM_ENV = 'SUPERLIORA_REPO_INDEX_WARM';
export const MISSION_DUAL_EMIT_ENV = 'SUPERLIORA_MISSION_DUAL_EMIT';
export const FLEET_DUAL_EMIT_ENV = 'SUPERLIORA_FLEET_DUAL_EMIT';

function isTruthyEnvFlag(value: string | undefined): boolean {
  const flag = value?.trim();
  if (flag === undefined || flag.length === 0) return false;
  return flag === '1' || flag.toLowerCase() === 'true';
}

function isFalsyEnvFlag(value: string | undefined): boolean {
  const flag = value?.trim();
  if (flag === undefined || flag.length === 0) return false;
  return flag === '0' || flag.toLowerCase() === 'false';
}

function nonEmptyEnvFrom(name: string, env: NodeJS.ProcessEnv): string | undefined {
  const value = env[name]?.trim();
  return value !== undefined && value.length > 0 ? value : undefined;
}

/** Which env flag enabled hide-legacy tool names, if any (null when opted out). */
export function hideLegacyToolNamesEnableReason(
  env: NodeJS.ProcessEnv = process.env,
): string | null {
  if (isTruthyEnvFlag(env[SHOW_LEGACY_TOOL_NAMES_ENV])) return null;
  if (nonEmptyEnvFrom(HIDE_LEGACY_TOOL_NAMES_ENV, env) !== undefined) {
    return HIDE_LEGACY_TOOL_NAMES_ENV;
  }
  if (isTruthyEnvFlag(env[SOVEREIGN_UMBRELLA_ENV])) return `${SOVEREIGN_UMBRELLA_ENV}=1`;
  return 'default';
}

/** Product default ON; opt out via {@link SHOW_LEGACY_TOOL_NAMES_ENV}=1. */
export function isHideLegacyToolNamesEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return hideLegacyToolNamesEnableReason(env) !== null;
}

/** Which env flag enabled session-start codemap warm, if any (null when opted out). */
export function repoIndexWarmEnableReason(
  env: NodeJS.ProcessEnv = process.env,
): string | null {
  if (isFalsyEnvFlag(env[REPO_INDEX_WARM_ENV])) return null;
  if (env[REPO_INDEX_WARM_ENV]?.trim() === '1') return `${REPO_INDEX_WARM_ENV}=1`;
  if (isTruthyEnvFlag(env[SOVEREIGN_CORE_DEFAULT_ENV])) return `${SOVEREIGN_CORE_DEFAULT_ENV}=1`;
  if (isTruthyEnvFlag(env[SOVEREIGN_UMBRELLA_ENV])) return `${SOVEREIGN_UMBRELLA_ENV}=1`;
  return 'default';
}

export function isRepoIndexWarmEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return repoIndexWarmEnableReason(env) !== null;
}

/** Which env flag enabled mission dual-emit, if any. */
export function missionDualEmitEnableReason(
  env: NodeJS.ProcessEnv = process.env,
): string | null {
  if (env[MISSION_DUAL_EMIT_ENV]?.trim() === '1') return `${MISSION_DUAL_EMIT_ENV}=1`;
  if (isTruthyEnvFlag(env[SOVEREIGN_UMBRELLA_ENV])) return `${SOVEREIGN_UMBRELLA_ENV}=1`;
  return null;
}

export function isMissionDualEmitEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return missionDualEmitEnableReason(env) !== null;
}

/** Which env flag enabled fleet dual-emit, if any. */
export function fleetDualEmitEnableReason(
  env: NodeJS.ProcessEnv = process.env,
): string | null {
  if (env[FLEET_DUAL_EMIT_ENV]?.trim() === '1') return `${FLEET_DUAL_EMIT_ENV}=1`;
  if (isTruthyEnvFlag(env[SOVEREIGN_UMBRELLA_ENV])) return `${SOVEREIGN_UMBRELLA_ENV}=1`;
  return null;
}

export function isFleetDualEmitEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return fleetDualEmitEnableReason(env) !== null;
}
