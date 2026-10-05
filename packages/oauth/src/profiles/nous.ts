/**
 * Nous Portal OAuth profile — device-code login against
 * `portal.nousresearch.com` (the subscription portal behind Nous Research's
 * inference gateway).
 *
 * The granted access token is a JWT used directly as the Bearer credential on
 * `inference-api.nousresearch.com/v1` (OpenAI-compatible). Refresh is a
 * single-use rotation: the refresh token travels in the
 * `x-nous-refresh-token` header, not the form body, and replaying one revokes
 * the session server-side.
 *
 * The public `client_id` (`hermes-cli`) is the registered portal client every
 * CLI carries — Nous issues it for this device flow the same way Google
 * ships the Gemini CLI client id.
 */

import type { ProviderProfile } from './provider-profile';

export const NOUS_PROVIDER_ID = 'nous';
export const NOUS_OAUTH_HOST = 'https://portal.nousresearch.com';
export const NOUS_OAUTH_CLIENT_ID = 'hermes-cli';
export const NOUS_INFERENCE_BASE_URL = 'https://inference-api.nousresearch.com/v1';

export const NOUS_PROFILE: ProviderProfile = {
  id: NOUS_PROVIDER_ID,
  displayName: 'Nous Portal (account login)',
  description:
    'Sign in with your Nous Research portal account (device code). One subscription covers Hermes and frontier models.',
  authType: 'oauth',
  flow: {
    name: NOUS_PROVIDER_ID,
    oauthHost: NOUS_OAUTH_HOST,
    clientId: NOUS_OAUTH_CLIENT_ID,
    kind: 'device_code',
    refreshTokenHeader: 'x-nous-refresh-token',
  },
  wire: 'openai',
  apiBaseUrl: NOUS_INFERENCE_BASE_URL,
  signupUrl: 'https://portal.nousresearch.com',
  docUrl: 'https://portal.nousresearch.com',
  // Aggregator catalog churns daily; prefer the live /models list on connect.
  liveModels: true,
  models: [
    {
      id: 'hermes-4-70b',
      displayName: 'Hermes 4 70B',
      maxContextSize: 131072,
      capabilities: ['tool_use'],
    },
    {
      id: 'hermes-4-405b',
      displayName: 'Hermes 4 405B',
      maxContextSize: 131072,
      capabilities: ['tool_use'],
    },
  ],
};
