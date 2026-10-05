/**
 * Kilo Gateway OAuth profile — Kilo's bespoke device authorization against
 * `api.kilo.ai` (POST `/api/device-auth/codes`, then GET-poll the code).
 *
 * The minted token is a gateway API key on `api.kilo.ai/api/gateway`
 * (OpenAI-compatible, OpenRouter-style model ids like `anthropic/claude-*`),
 * not an OAuth grant — the bundle reports ~1-year expiry and an expired
 * credential re-runs the login flow.
 */

import type { ProviderProfile } from './provider-profile';

export const KILO_PROVIDER_ID = 'kilo';
export const KILO_OAUTH_HOST = 'https://api.kilo.ai';
export const KILO_API_BASE_URL = 'https://api.kilo.ai/api/gateway';

export const KILO_PROFILE: ProviderProfile = {
  id: KILO_PROVIDER_ID,
  displayName: 'Kilo Gateway (account login)',
  description:
    'Sign in with your Kilo account (device code). The gateway exposes the shared frontier catalog under one token.',
  authType: 'oauth',
  flow: {
    name: KILO_PROVIDER_ID,
    oauthHost: KILO_OAUTH_HOST,
    clientId: 'liora',
    kind: 'kilo_device',
  },
  wire: 'openai',
  apiBaseUrl: KILO_API_BASE_URL,
  // models.dev carries `kilo`, so the connect flow merges the live catalog.
  liveModels: true,
  signupUrl: 'https://kilo.ai',
  docUrl: 'https://kilo.ai',
  models: [
    {
      id: 'moonshotai/kimi-k2.6',
      displayName: 'Kimi K2.6',
      maxContextSize: 262144,
      capabilities: ['tool_use', 'thinking'],
    },
    {
      id: 'anthropic/claude-sonnet-4.6',
      displayName: 'Claude Sonnet 4.6',
      maxContextSize: 1000000,
      capabilities: ['tool_use', 'image_in', 'thinking'],
    },
  ],
};
