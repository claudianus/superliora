/**
 * Factory Droid (`factory.ai`) OAuth profile — WorkOS device-code login.
 *
 * `api.workos.com/user_management/authorize/device` is RFC 8628-compliant, so
 * the generic `device_code` flow runs it; the granted access token is a WorkOS
 * JWT whose `external_org_id` claim scopes the account. `postExchange:
 * 'factory_region'` then calls `api.factory.ai/api/cli/whoami` to resolve the
 * org id (`X-Factory-Org-Id`), residency `region` (API host), and
 * `inferenceRegion` (upstream eligibility) onto the stored token — connect
 * writes them into the provider config.
 *
 * Runtime: the `factory-droid` wire multiplexes the Factory LLM proxy across
 * anthropic-messages / openai-responses / openai-completions / google-generate
 * per model, chosen by the shipped model registry (no listing endpoint).
 */

import type { ProviderProfile } from './provider-profile';

export const FACTORY_DROID_PROVIDER_ID = 'factory-droid';
export const FACTORY_DROID_OAUTH_HOST = 'https://api.workos.com';
export const FACTORY_DROID_CLIENT_ID = 'client_01HNM792M5G5G1A2THWPXKFMXB';

export const FACTORY_DROID_PROFILE: ProviderProfile = {
  id: FACTORY_DROID_PROVIDER_ID,
  displayName: 'Factory Droid (subscription)',
  description:
    'Sign in with your Factory account (device code). One subscription covers the full multi-provider roster.',
  authType: 'oauth',
  flow: {
    name: FACTORY_DROID_PROVIDER_ID,
    oauthHost: FACTORY_DROID_OAUTH_HOST,
    clientId: FACTORY_DROID_CLIENT_ID,
    kind: 'device_code',
    deviceCodeUrl: `${FACTORY_DROID_OAUTH_HOST}/user_management/authorize/device`,
    tokenUrl: `${FACTORY_DROID_OAUTH_HOST}/user_management/authenticate`,
    requestHeaders: { Accept: 'application/json' },
    postExchange: 'factory_region',
  },
  wire: 'factory-droid',
  signupUrl: 'https://factory.ai',
  docUrl: 'https://docs.factory.ai',
};
