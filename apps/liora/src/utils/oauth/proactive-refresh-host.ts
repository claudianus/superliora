/**
 * Host-side proactive OAuth refresh for long Liora sessions.
 *
 * Call sites:
 *   - apps/liora/src/cli/run-shell.ts (interactive TUI)
 *   - apps/liora/src/cli/run-prompt.ts (headless prompt runs)
 *
 * Uses harness.auth.resolveOAuthTokenProvider → OAuthManager.ensureFresh under the hood.
 */

import {
  OAUTH_PROACTIVE_REFRESH_INTERVAL_MS,
  startProactiveRefreshTimer,
  SUPERLIORA_PROVIDER_NAME,
  type OAuthRefreshOutcome,
  type ProactiveRefreshTimerHandle,
} from '@superliora/oauth';
import type { LioraHarness } from '@superliora/sdk';

import { OAUTH_LOGIN_REQUIRED_CODE } from '#/constant/app';

/** Keep tokens warm during multi-minute agent runs (~default refresh threshold). */
export { OAUTH_PROACTIVE_REFRESH_INTERVAL_MS };

export const OAUTH_REFRESH_FAILURE_HINT =
  'Run /login or Settings → Accounts; pool may failover · other work continues.';

export interface OAuthRefreshFailure {
  readonly reason: string;
  readonly hint: string;
}

export interface HarnessOAuthProactiveRefreshOptions {
  /** Host hook: surface an observed credential refresh failure. */
  readonly onRefreshFailure?: ((failure: OAuthRefreshFailure) => void) | undefined;
}

/** Normalize a credential refresh error for the host's warning surface. */
export function buildOAuthRefreshFailure(error: unknown): OAuthRefreshFailure {
  const reason =
    error instanceof Error
      ? error.message.replaceAll(/\s+/g, ' ').trim()
      : String(error).replaceAll(/\s+/g, ' ').trim();
  return {
    reason: reason.length > 0 ? reason : 'oauth_refresh_failed',
    hint: OAUTH_REFRESH_FAILURE_HINT,
  };
}

/** Map OAuthManager's actual refresh failure outcome to a warning. */
export function buildOAuthRefreshFailureFromOutcome(
  outcome: Extract<OAuthRefreshOutcome, { success: false }>,
): OAuthRefreshFailure {
  const reason =
    outcome.reason === 'unauthorized'
      ? 'OAuth refresh unauthorized; re-login required'
      : 'oauth_refresh_failed';
  return buildOAuthRefreshFailure(reason);
}

/** Unused managed OAuth is not a refresh failure — skip the host warning. */
function isIdleLoginRequiredError(error: unknown): boolean {
  if ((error as { readonly code?: unknown } | null)?.code === OAUTH_LOGIN_REQUIRED_CODE) {
    return true;
  }
  const message = error instanceof Error ? error.message : String(error);
  return message.includes('No token for ') || message.includes('requires login before it can be used');
}

/**
 * Starts a periodic ensureFresh poll when the managed OAuth token provider is available.
 * Returns undefined when the host auth surface does not expose getAccessToken (no OAuth).
 *
 * Skips ticks when no managed token is cached so unused Kimi OAuth does not spam
 * credential warnings for Cursor/other-provider sessions.
 */
export function startHarnessOAuthProactiveRefresh(
  harness: LioraHarness,
  options: HarnessOAuthProactiveRefreshOptions = {},
): ProactiveRefreshTimerHandle | undefined {
  const resolve = harness.auth?.resolveOAuthTokenProvider;
  if (typeof resolve !== 'function') {
    return undefined;
  }
  const tokenProvider = resolve.call(harness.auth, SUPERLIORA_PROVIDER_NAME);
  const ensureFresh = tokenProvider?.getAccessToken?.bind(tokenProvider);
  if (typeof ensureFresh !== 'function') {
    return undefined;
  }
  const getCached = harness.auth?.getCachedAccessToken?.bind(harness.auth);
  return startProactiveRefreshTimer(
    async () => {
      // Only warm a provider the user has actually logged into.
      if (typeof getCached === 'function') {
        const cached = await getCached(SUPERLIORA_PROVIDER_NAME);
        if (cached == null || cached.length === 0) {
          return '';
        }
      }
      return ensureFresh();
    },
    OAUTH_PROACTIVE_REFRESH_INTERVAL_MS,
    {
      onError: (error) => {
        if (isIdleLoginRequiredError(error)) {
          return;
        }
        options.onRefreshFailure?.(buildOAuthRefreshFailure(error));
      },
    },
  );
}
