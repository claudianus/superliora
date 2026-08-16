/**
 * Which failures cool down the whole provider credential vs one model alias.
 *
 * Cursor has two spend lanes on one login (`cursor-oauth`):
 *   - Included: Auto (`default`), Grok 4.5, Composer 2.5
 *   - API: other named models (Claude/GPT/…)
 * Marking the whole provider after an API-lane quota/empty kills the included
 * lane too — keep cursor non-auth failures alias-scoped.
 */

import type { ProviderRouteFailureKind } from '../turn/provider-route-types';

export const CURSOR_OAUTH_PROVIDER_ID = 'cursor-oauth';

/**
 * Cursor models that share the included/subscription request pool (not API
 * usage). Wire ids and `cursor-oauth/<id>` aliases both accepted.
 */
export function isCursorIncludedLaneModel(aliasOrModelId: string): boolean {
  const id = cursorWireModelId(aliasOrModelId);
  if (id.length === 0) return false;
  if (id === 'default' || id === 'auto' || id === 'cursor-auto') return true;
  if (id === 'composer-2.5' || id.startsWith('composer-2.5-')) return true;
  // GetUsableModels keeps the `cursor-` prefix on Grok 4.5 variants.
  if (/^(cursor-)?grok-4\.5(?:-|$)/.test(id)) return true;
  return false;
}

/** Strip `cursor-oauth/` so lane checks work on aliases or bare wire ids. */
export function cursorWireModelId(aliasOrModelId: string): string {
  const raw = aliasOrModelId.trim().toLowerCase();
  if (raw.length === 0) return '';
  const prefix = `${CURSOR_OAUTH_PROVIDER_ID}/`;
  return raw.startsWith(prefix) ? raw.slice(prefix.length) : raw;
}

/**
 * True when this failure should mark {@link sharedCredentialHealthStore} for
 * the provider (hiding every alias on that provider).
 */
export function shouldMarkProviderCredential(
  providerId: string,
  failureKind: ProviderRouteFailureKind,
): boolean {
  const id = providerId.trim();
  if (id.length === 0) return false;

  // Auth rejects the credential for every model on that login.
  if (failureKind === 'auth') return true;

  // Model id retired / not found stays alias-scoped everywhere.
  if (failureKind === 'model_unavailable') return false;

  // Empty is flaky / model-local on live probe — never poison the provider.
  if (failureKind === 'empty') return false;

  // AbortSignal.timeout / one-alias abort is not credential death. Marking
  // xai-grok here hid every sibling SKU (grok-4.6) for the probe_fail TTL.
  if (failureKind === 'timeout') return false;

  // Included (Auto/Grok/Composer) vs API spend share one provider id.
  if (id === CURSOR_OAUTH_PROVIDER_ID) return false;

  return (
    failureKind === 'quota' ||
    failureKind === 'rate_limit' ||
    failureKind === 'server' ||
    failureKind === 'connection'
  );
}
