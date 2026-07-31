/** Advanced override — $0 free fallback is product-forced unless this env is set. */
export const ALLOW_DISABLE_FREE_FALLBACK_ENV = 'SUPERLIORA_ALLOW_DISABLE_FREE_FALLBACK';

/**
 * Resolve whether DDG/local last-resort search is enabled.
 * Config `freeFallback: false` is ignored unless {@link ALLOW_DISABLE_FREE_FALLBACK_ENV}=1.
 */
export function resolveResearchSearchFreeFallback(
  configValue: boolean | undefined,
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  if (configValue !== false) return true;
  if (env[ALLOW_DISABLE_FREE_FALLBACK_ENV] === '1') return false;
  return true;
}
