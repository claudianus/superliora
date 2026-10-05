/**
 * Devin (Cognition) OAuth profile — the Devin CLI's own authorization-code +
 * PKCE login against `app.devin.ai`, with a `127.0.0.1:59653/callback`
 * loopback and a JSON token exchange at `api.devin.ai/auth/cli/token`
 * returning a long-lived session JWT.
 *
 * The session token authenticates the Cascade backend at
 * `server.codeium.com` (Connect-RPC + protobuf). Model discovery goes through
 * `GetCliModelConfigs`; the presets below are the known seed entries so the
 * provider is usable even when live discovery is unreachable.
 */

import type { ProviderProfile } from './provider-profile';

export const DEVIN_PROVIDER_ID = 'devin';
export const DEVIN_AUTHORIZE_URL = 'https://app.devin.ai/auth/cli/continue';
export const DEVIN_TOKEN_URL = 'https://api.devin.ai/auth/cli/token';
export const DEVIN_API_BASE_URL = 'https://server.codeium.com';
export const DEVIN_CALLBACK_PORT = 59653;

export const DEVIN_PROFILE: ProviderProfile = {
  id: DEVIN_PROVIDER_ID,
  displayName: 'Devin (account login)',
  description:
    'Sign in with your Devin account. Unlocks the Cascade model roster (SWE, Claude, GPT, Gemini) through your Devin subscription.',
  authType: 'oauth',
  flow: {
    name: DEVIN_PROVIDER_ID,
    oauthHost: 'https://api.devin.ai',
    // Devin's first-party CLI login registers no client_id.
    clientId: '',
    kind: 'devin_pkce',
    authorizeUrl: DEVIN_AUTHORIZE_URL,
    tokenUrl: DEVIN_TOKEN_URL,
    callbackPort: DEVIN_CALLBACK_PORT,
    callbackHost: '127.0.0.1',
  },
  wire: 'devin',
  apiBaseUrl: DEVIN_API_BASE_URL,
  signupUrl: 'https://app.devin.ai',
  docUrl: 'https://docs.devin.ai',
  // Fallback seed: live `GetCliModelConfigs` discovery runs at connect and
  // expands this to the credential-scoped roster.
  models: [
    {
      id: 'adaptive',
      displayName: 'Devin Adaptive (router)',
      maxContextSize: 200000,
      capabilities: ['tool_use'],
    },
    {
      id: 'swe-1-6',
      displayName: 'SWE-1.6',
      maxContextSize: 200000,
      capabilities: ['tool_use'],
    },
    {
      id: 'swe-1-6-fast',
      displayName: 'SWE-1.6 Fast',
      maxContextSize: 200000,
      capabilities: ['tool_use'],
    },
  ],
};
