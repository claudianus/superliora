/**
 * Env-only TUI host checks. Used at startup so the TUI can decide whether
 * to prompt /host-setup without importing installer scripts.
 */

export function windowsTuiHostDegraded(
  env: NodeJS.ProcessEnv = process.env,
  platform: NodeJS.Platform = process.platform,
): boolean {
  return platform === 'win32' && !(env.WT_SESSION ?? '').trim();
}

/** CI / pipeline hosts must not download packages during TUI tests. */
export function isCiLike(env: NodeJS.ProcessEnv = process.env): boolean {
  const ci = (env.CI ?? '').trim().toLowerCase();
  if (ci === 'true' || ci === '1' || ci === 'yes') return true;
  if ((env.GITHUB_ACTIONS ?? '').trim().toLowerCase() === 'true') return true;
  if ((env.TF_BUILD ?? '').trim().toLowerCase() === 'true') return true;
  return false;
}

/**
 * Show the host-setup confirm sheet when the planner later reports gaps.
 * Installer skip flags and `SUPERLIORA_AUTO_TERMINAL=0` turn this off. CI is always off.
 */
export function shouldPromptHostSetup(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  if (isCiLike(env)) return false;
  if (env.SUPERLIORA_NO_HOST_SETUP === '1') return false;
  if (env.SUPERLIORA_AUTO_TERMINAL === '0') return false;
  return true;
}

/** @deprecated Silent auto-apply is gone; use {@link shouldPromptHostSetup}. */
export function shouldAutoApplyWindowsSetup(
  _env: NodeJS.ProcessEnv = process.env,
  _platform: NodeJS.Platform = process.platform,
): boolean {
  return false;
}
