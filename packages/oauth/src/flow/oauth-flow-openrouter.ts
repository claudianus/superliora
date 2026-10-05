/**
 * OpenRouter PKCE login — browser consent that mints a durable API key.
 *
 * OpenRouter's third-party auth is not a token grant: the authorize URL
 * (`https://openrouter.ai/auth?callback_url=…&code_challenge=…`) redirects
 * back to a loopback URL with a single-use `?code=`, which the client posts
 * to `/api/v1/auth/keys` together with the PKCE verifier. The response is a
 * permanent `sk-or-…` API key, stored as a long-lived token bundle (refresh
 * is a no-op — a revoked key requires a fresh login).
 */

import { OAuthError } from '../errors';
import type { TokenInfo } from '../types';
import type { ProviderFlowConfig } from '../profiles/provider-profile';
import {
  generatePkcePair,
  postJson,
  startCallbackServer,
  waitForCallbackOrManual,
  type ManualCallbackPromptContext,
} from './oauth-flow-http';

const KEY_EXCHANGE_TIMEOUT_MS = 30_000;
/** OpenRouter keys are durable; keep them far from refresh thresholds. */
const STATIC_KEY_LIFETIME_S = 10 * 365 * 24 * 60 * 60;

export interface RunOpenRouterKeyFlowOptions {
  readonly onAuthorizeUrl?: (url: string) => Promise<void> | void;
  readonly onManualCallbackPrompt?: (
    context: ManualCallbackPromptContext,
  ) => Promise<string | undefined>;
  readonly signal?: AbortSignal;
}

/**
 * Runs the OpenRouter login: open `authorizeUrl` (default
 * `https://openrouter.ai/auth`) → loopback `?code=` callback → exchange the
 * code for an API key at `tokenUrl` (default `/api/v1/auth/keys`).
 */
export async function runOpenRouterKeyFlow(
  flow: ProviderFlowConfig,
  options: RunOpenRouterKeyFlowOptions = {},
): Promise<TokenInfo> {
  const authorizeUrl =
    flow.authorizeUrl ?? `${flow.oauthHost.replace(/\/$/, '')}/auth`;
  const tokenUrl =
    flow.tokenUrl ?? `${flow.oauthHost.replace(/\/$/, '')}/api/v1/auth/keys`;

  const pkce = generatePkcePair();
  // Ephemeral loopback port: OpenRouter accepts any loopback callback_url.
  const server = await startCallbackServer(0, '127.0.0.1');
  try {
    const url = new URL(authorizeUrl);
    url.searchParams.set('callback_url', server.redirectUri);
    url.searchParams.set('code_challenge', pkce.challenge);
    url.searchParams.set('code_challenge_method', pkce.method);
    await options.onAuthorizeUrl?.(url.toString());

    // No `state` is issued for this flow — the callback carries only `code`.
    const { code } = await waitForCallbackOrManual(server, {
      signal: options.signal,
      onManualCallbackPrompt: options.onManualCallbackPrompt,
    });

    const { status, data } = await postJson(
      tokenUrl,
      { code, code_verifier: pkce.verifier, code_challenge_method: pkce.method },
      { signal: options.signal, timeoutMs: KEY_EXCHANGE_TIMEOUT_MS },
    );
    const key = data['key'];
    if (status !== 200 || typeof key !== 'string' || key.length === 0) {
      const detail =
        typeof data['error'] === 'object' && data['error'] !== null
          ? (data['error'] as Record<string, unknown>)['message']
          : undefined;
      throw new OAuthError(
        `OpenRouter key exchange failed (HTTP ${status})${
          typeof detail === 'string' && detail.length > 0 ? `: ${detail}` : ''
        }`,
      );
    }

    return {
      accessToken: key,
      // The key doubles as its own refresh credential: the refresh impl
      // re-wraps it (see `refreshForFlow`), never calling the provider again.
      refreshToken: key,
      expiresAt: Math.floor(Date.now() / 1000) + STATIC_KEY_LIFETIME_S,
      scope: '',
      tokenType: 'Bearer',
      expiresIn: STATIC_KEY_LIFETIME_S,
    };
  } finally {
    await server.close();
  }
}
