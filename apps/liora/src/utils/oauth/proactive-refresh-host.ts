/**
 * Host-side proactive OAuth refresh for long Liora sessions.
 *
 * Call sites:
 *   - apps/liora/src/cli/run-shell.ts (interactive TUI)
 *   - apps/liora/src/cli/run-prompt.ts (headless prompt runs)
 *
 * Uses harness.auth.resolveOAuthTokenProvider → OAuthManager.ensureFresh under the hood.
 */

import type { RuntimeDegradedEvent } from '@superliora/protocol';
import {
  OAUTH_PROACTIVE_REFRESH_INTERVAL_MS,
  startProactiveRefreshTimer,
  SUPERLIORA_PROVIDER_NAME,
  type OAuthRefreshOutcome,
  type ProactiveRefreshTimerHandle,
} from '@superliora/oauth';
import type { LioraHarness } from '@superliora/sdk';

/** Keep tokens warm during multi-minute agent runs (~default refresh threshold). */
export { OAUTH_PROACTIVE_REFRESH_INTERVAL_MS };

export const OAUTH_REFRESH_DEGRADED_HINT =
  'Run /login or Settings → Accounts; pool may failover · other work continues.';

export interface HarnessOAuthProactiveRefreshOptions {
  /** Host hook: surface volatile runtime.degraded (TUI footer / Ops). */
  readonly onDegraded?: ((event: RuntimeDegradedEvent) => void) | undefined;
}

/**
 * Build oauth-scoped runtime.degraded from a proactive ensureFresh failure.
 * `atMs` anchors the footer/oauth↓ TTL window (see runtime-degraded.ts).
 */
export function buildOAuthRefreshDegradedEvent(
  error: unknown,
  atMs: number = Date.now(),
): RuntimeDegradedEvent {
  const reason =
    error instanceof Error
      ? error.message.replace(/\s+/g, ' ').trim()
      : String(error).replace(/\s+/g, ' ').trim();
  return {
    type: 'runtime.degraded',
    scope: 'oauth',
    reason: reason.length > 0 ? reason : 'oauth_refresh_failed',
    hint: OAUTH_REFRESH_DEGRADED_HINT,
    atMs,
  };
}

/** Build oauth-scoped runtime.degraded from OAuthManager onRefresh failure. */
export function buildOAuthRefreshDegradedEventFromOutcome(
  outcome: Extract<OAuthRefreshOutcome, { success: false }>,
  atMs: number = Date.now(),
): RuntimeDegradedEvent {
  const reason =
    outcome.reason === 'unauthorized'
      ? 'OAuth refresh unauthorized; re-login required'
      : 'oauth_refresh_failed';
  return buildOAuthRefreshDegradedEvent(reason, atMs);
}

/**
 * Starts a periodic ensureFresh poll when the managed OAuth token provider is available.
 * Returns undefined when the host auth surface does not expose getAccessToken (no OAuth).
 */
export function startHarnessOAuthProactiveRefresh(
  harness: LioraHarness,
  options: HarnessOAuthProactiveRefreshOptions = {},
): ProactiveRefreshTimerHandle | undefined {
  const tokenProvider = harness.auth.resolveOAuthTokenProvider(SUPERLIORA_PROVIDER_NAME);
  const ensureFresh = tokenProvider.getAccessToken;
  if (typeof ensureFresh !== 'function') {
    return undefined;
  }
  return startProactiveRefreshTimer(
    () => ensureFresh.call(tokenProvider),
    OAUTH_PROACTIVE_REFRESH_INTERVAL_MS,
    {
      onError: (error) => {
        options.onDegraded?.(buildOAuthRefreshDegradedEvent(error));
      },
    },
  );
}
