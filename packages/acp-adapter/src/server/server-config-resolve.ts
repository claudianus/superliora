import { log, resolveConfiguredSessionRoute, type LioraHarness } from '@superliora/sdk';

/** Display the configured alias or the native provider default, never a guessed catalog row. */
export async function resolveCurrentModelId(harness: LioraHarness): Promise<string> {
  if (typeof harness.getConfig !== 'function') return '';
  try {
    const config = await harness.getConfig();
    const declared = config.defaultModel?.trim();
    if (declared && (declared.toLowerCase() !== 'auto' || config.models?.[declared] !== undefined)) {
      return declared;
    }
    return resolveConfiguredSessionRoute({ config }).alias;
  } catch (error) {
    log.warn('acp: no configured model selection available for configOptions', {
      error: error instanceof Error ? error.message : String(error),
    });
    return '';
  }
}

/**
 * Compute the initial value for the `thinking` toggle when
 * a session is created (or loaded with no persisted thinking state).
 * Reads the harness's `getConfig().defaultThinking` flag if exposed —
 * the same source `Session.createSession` would consult for new
 * sessions. Returns `false` when the harness has no opinion, so the
 * toggle starts off.
 *
 * Tolerant to partial-stub harnesses for the same reason
 * {@link resolveCurrentModelId} is — adapter-level unit tests
 * routinely omit `getConfig`. The swallow-and-fallback path keeps
 * the test ergonomics symmetric.
 */
export async function resolveCurrentThinkingEnabled(harness: LioraHarness): Promise<boolean> {
  if (typeof harness.getConfig !== 'function') return false;
  try {
    const config = await harness.getConfig();
    const declared = (config as { defaultThinking?: unknown }).defaultThinking;
    if (typeof declared === 'boolean') return declared;
    if (typeof declared === 'string') {
      const normalized = declared.trim().toLowerCase();
      return normalized !== 'off' && normalized.length > 0;
    }
    return false;
  } catch (error) {
    log.warn('acp: harness.getConfig threw during thinking toggle resolution; defaulting to off', {
      error: error instanceof Error ? error.message : String(error),
    });
    return false;
  }
}
