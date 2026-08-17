/**
 * Env-only Windows TUI host check. Used at startup so the TUI can hint
 * `/windows-setup` without importing installer scripts.
 */

export function windowsTuiHostDegraded(
  env: NodeJS.ProcessEnv = process.env,
  platform: NodeJS.Platform = process.platform,
): boolean {
  return platform === 'win32' && !(env.WT_SESSION ?? '').trim();
}

/** CI / pipeline hosts must not download Windows Terminal during TUI tests. */
export function isCiLike(env: NodeJS.ProcessEnv = process.env): boolean {
  const ci = (env.CI ?? '').trim().toLowerCase();
  if (ci === 'true' || ci === '1' || ci === 'yes') return true;
  if ((env.GITHUB_ACTIONS ?? '').trim().toLowerCase() === 'true') return true;
  if ((env.TF_BUILD ?? '').trim().toLowerCase() === 'true') return true;
  return false;
}

/**
 * Best-effort auto-apply on conhost / PC-bang. Installer skip flags and
 * `SUPERLIORA_AUTO_TERMINAL=0` turn this off. CI is always off.
 */
export function shouldAutoApplyWindowsSetup(
  env: NodeJS.ProcessEnv = process.env,
  platform: NodeJS.Platform = process.platform,
): boolean {
  if (!windowsTuiHostDegraded(env, platform)) return false;
  if (isCiLike(env)) return false;
  if (env.SUPERLIORA_NO_TERMINAL === '1' || env.SUPERLIORA_SKIP_TERMINAL === '1') {
    return false;
  }
  if (env.SUPERLIORA_AUTO_TERMINAL === '0') return false;
  return true;
}
