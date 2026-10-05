/**
 * OpenRouter OAuth profile — browser PKCE consent that mints a durable
 * OpenRouter API key (`openrouter.ai/auth` → loopback `?code=` →
 * `POST /api/v1/auth/keys`).
 *
 * The minted `sk-or-…` key is permanent (OpenRouter's docs call it an API key,
 * not an OAuth token), so it is stored as a long-lived token bundle and the
 * refresh path re-wraps it without a server round-trip. Runtime requests hit
 * the ordinary OpenRouter endpoint, identical to a pasted dashboard key.
 */

import type { ProviderProfile } from './provider-profile';

export const OPENROUTER_OAUTH_PROVIDER_ID = 'openrouter-oauth';
export const OPENROUTER_OAUTH_HOST = 'https://openrouter.ai';
export const OPENROUTER_AUTHORIZE_URL = `${OPENROUTER_OAUTH_HOST}/auth`;
export const OPENROUTER_KEY_EXCHANGE_URL = `${OPENROUTER_OAUTH_HOST}/api/v1/auth/keys`;
export const OPENROUTER_API_BASE_URL = `${OPENROUTER_OAUTH_HOST}/api/v1`;

export const OPENROUTER_OAUTH_PROFILE: ProviderProfile = {
  id: OPENROUTER_OAUTH_PROVIDER_ID,
  displayName: 'OpenRouter (account login)',
  description:
    'Sign in with your OpenRouter account to mint an API key automatically (browser consent).',
  authType: 'oauth',
  flow: {
    name: OPENROUTER_OAUTH_PROVIDER_ID,
    oauthHost: OPENROUTER_OAUTH_HOST,
    // OpenRouter's key mint has no client registration — the PKCE pair is the
    // credential. `clientId` is required by the config shape but unused.
    clientId: '',
    kind: 'pkce_api_key',
    authorizeUrl: OPENROUTER_AUTHORIZE_URL,
    tokenUrl: OPENROUTER_KEY_EXCHANGE_URL,
  },
  wire: 'openai',
  apiBaseUrl: OPENROUTER_API_BASE_URL,
  signupUrl: 'https://openrouter.ai',
  docUrl: 'https://openrouter.ai/docs',
  models: [
    {
      id: 'anthropic/claude-sonnet-4.5',
      displayName: 'Claude Sonnet 4.5 (OpenRouter)',
      maxContextSize: 1000000,
      capabilities: ['thinking', 'tool_use', 'image_in'],
    },
    {
      id: 'openai/gpt-5.2',
      displayName: 'GPT-5.2 (OpenRouter)',
      maxContextSize: 400000,
      capabilities: ['thinking', 'tool_use', 'image_in'],
    },
    {
      id: 'google/gemini-3-pro-preview',
      displayName: 'Gemini 3 Pro (OpenRouter)',
      maxContextSize: 1048576,
      capabilities: ['thinking', 'tool_use', 'image_in'],
    },
  ],
};
