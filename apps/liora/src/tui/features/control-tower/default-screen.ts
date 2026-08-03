/**
 * Control tower default-screen policy (V5-1).
 *
 * The Conductor profile starts on the job desk board instead of the bare
 * transcript: the board is the operator's first surface, `Esc` returns to the
 * transcript. Profile resolution mirrors `/profile status`
 * (config `agent.profile` → `SUPERLIORA_PROFILE` env → conductor default).
 */

import {
  loadProfileLiveGlance,
  SOVEREIGN_CONDUCTOR_PROFILE_NAME,
} from '../../utils/agent/profile-glance';

/** True when this effective profile boots into the control tower board. */
export function isControlTowerDefaultScreenProfile(effectiveProfile: string): boolean {
  return effectiveProfile === SOVEREIGN_CONDUCTOR_PROFILE_NAME;
}

/**
 * Resolve whether the control tower board should be the first screen after
 * startup. A config read failure falls back to env-only resolution so startup
 * never blocks on it.
 */
export async function shouldOpenControlTowerAtStartup(input: {
  getConfigProfile(): Promise<string | undefined>;
  env?: NodeJS.ProcessEnv;
}): Promise<boolean> {
  let configProfile: string | undefined;
  try {
    configProfile = await input.getConfigProfile();
  } catch {
    configProfile = undefined;
  }
  const glance = loadProfileLiveGlance({ configProfile, env: input.env });
  return isControlTowerDefaultScreenProfile(glance.effectiveProfile);
}
