import { log, type LioraHarness } from '@superliora/sdk';

import { listModelsFromHarness } from '#/model-catalog';

/**
 * Compute the `currentValue` for the `model` config option when the
 * caller (either `newSession` or `loadSession`'s fallback path) does
 * not have a more specific signal. Prefers the harness's configured
 * `defaultModel`; otherwise falls back to the first listed catalog
 * alias so the dropdown's "current" highlight is always one of the
 * options the client will render. Returns the empty string when the
 * harness has no models at all — a degenerate config the UI can still
 * render (an empty dropdown with an empty `currentValue`).
 *
 * Tolerant to partial-stub harnesses (`getConfig` missing or
 * throwing) — adapter-level unit tests routinely construct minimal
 * `LioraHarness` shapes that only stub `auth.status` + `createSession`.
 * Production callers always supply a real harness with both methods;
 * the swallow-and-fallback path exists purely for test ergonomics.
 *
 * Logged at `warn` when a fallback fires so a dev who forgot to set
 * `default_model = ...` sees a breadcrumb in the agent log.
 */
export async function resolveCurrentModelId(harness: LioraHarness): Promise<string> {
  if (typeof harness.getConfig !== 'function') return '';
  try {
    const config = await harness.getConfig();
    const declared = config.defaultModel;
    if (typeof declared === 'string' && declared.length > 0) {
      return declared;
    }
  } catch (error) {
    log.warn('acp: harness.getConfig threw during configOptions assembly; falling back', {
      error: error instanceof Error ? error.message : String(error),
    });
    return '';
  }
  try {
    const models = await listModelsFromHarness(harness);
    if (models.length === 0) {
      log.warn('acp: harness exposes no models; configOptions will ship an empty model picker');
      return '';
    }
    log.warn(
      'acp: harness has no defaultModel; falling back to first catalog entry for configOptions.currentValue',
      { fallbackModelId: models[0]!.id },
    );
    return models[0]!.id;
  } catch (error) {
    log.warn('acp: listModelsFromHarness threw during configOptions assembly', {
      error: error instanceof Error ? error.message : String(error),
    });
  }
  return '';
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
