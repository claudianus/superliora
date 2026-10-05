/**
 * Muse Code (Meta) OAuth profile — Meta OIDC device-code login against
 * `auth.meta.com`, then a subscription-authorized API-key mint at
 * `api.meta.ai/muse-code/key`.
 *
 * Meta's device grant omits `expires_in` and rejects refresh grants, so the
 * account token is non-expiring (`jwt_or_never`). Model requests never use
 * the account token: `postExchange: 'muse_key'` mints the Muse API key and
 * stores it as the access token while the Meta token stays in
 * `refreshToken` for re-minting.
 *
 * Runtime: OpenAI Responses wire at `api.meta.ai/v1` with the mandatory
 * `x-api-version` header. The endpoint only accepts `tool_choice: "auto"`,
 * which our adapter satisfies by omitting the field.
 */

import type { ProviderProfile } from './provider-profile';

export const MUSE_CODE_PROVIDER_ID = 'muse-code';
export const MUSE_CODE_DEVICE_URL = 'https://auth.meta.com/oidc/device/authorization/';
export const MUSE_CODE_TOKEN_URL = 'https://auth.meta.com/oidc/device/token/';
export const MUSE_CODE_CLIENT_ID = '1031625952748946';
export const MUSE_CODE_API_BASE_URL = 'https://api.meta.ai/v1';
const MUSE_API_HEADERS = { 'x-api-version': '1.0.0' } as const;

export const MUSE_CODE_PROFILE: ProviderProfile = {
  id: MUSE_CODE_PROVIDER_ID,
  displayName: 'Muse Code (Meta subscription)',
  description:
    'Sign in with your Meta account (device code). Mints a Muse Code API key backed by your Meta subscription.',
  authType: 'oauth',
  flow: {
    name: MUSE_CODE_PROVIDER_ID,
    oauthHost: 'https://auth.meta.com',
    clientId: MUSE_CODE_CLIENT_ID,
    kind: 'device_code',
    deviceCodeUrl: MUSE_CODE_DEVICE_URL,
    tokenUrl: MUSE_CODE_TOKEN_URL,
    requestHeaders: MUSE_API_HEADERS,
    tokenExpiry: 'jwt_or_never',
    postExchange: 'muse_key',
  },
  wire: 'openai_responses',
  apiBaseUrl: MUSE_CODE_API_BASE_URL,
  customHeaders: MUSE_API_HEADERS,
  signupUrl: 'https://www.meta.ai',
  docUrl: 'https://www.meta.ai',
  models: [
    {
      id: 'muse-spark-1.3',
      displayName: 'Muse Spark 1.3',
      maxContextSize: 262144,
      capabilities: ['tool_use'],
    },
    {
      id: 'muse-spark-1.2',
      displayName: 'Muse Spark 1.2',
      maxContextSize: 262144,
      capabilities: ['tool_use'],
    },
  ],
};
