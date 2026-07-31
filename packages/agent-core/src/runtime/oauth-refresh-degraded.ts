import type { OAuthRefreshOutcome } from '@superliora/oauth';
import type { RuntimeDegradedEvent } from '@superliora/protocol';

export const OAUTH_REFRESH_DEGRADED_HINT =
  'Run /login or Settings → Accounts; other work continues.';

export function oauthRefreshFailureReason(
  outcome: Extract<OAuthRefreshOutcome, { success: false }>,
): string {
  return outcome.reason === 'unauthorized'
    ? 'OAuth refresh unauthorized; re-login required'
    : 'oauth_refresh_failed';
}

export function buildOAuthRefreshDegradedEvent(
  reason: string,
  atMs: number = Date.now(),
): RuntimeDegradedEvent {
  const normalized = reason.replaceAll(/\s+/g, ' ').trim();
  return {
    type: 'runtime.degraded',
    scope: 'oauth',
    reason: normalized.length > 0 ? normalized : 'oauth_refresh_failed',
    hint: OAUTH_REFRESH_DEGRADED_HINT,
    atMs,
  };
}

export function buildOAuthRefreshDegradedEventFromOutcome(
  outcome: Extract<OAuthRefreshOutcome, { success: false }>,
  atMs: number = Date.now(),
): RuntimeDegradedEvent {
  return buildOAuthRefreshDegradedEvent(oauthRefreshFailureReason(outcome), atMs);
}

export function buildOAuthRefreshDegradedEventFromError(
  error: unknown,
  atMs: number = Date.now(),
): RuntimeDegradedEvent {
  const reason =
    error instanceof Error
      ? error.message.replaceAll(/\s+/g, ' ').trim()
      : String(error).replaceAll(/\s+/g, ' ').trim();
  return buildOAuthRefreshDegradedEvent(reason, atMs);
}
