/**
 * MiniMax OAuth profile — MiniMax Coding Plan subscription login.
 *
 * MiniMax's grant is a device-flow variant (`POST /oauth/code` issues a
 * `user_code` + portal URL; the client polls `/oauth/token` with a
 * `urn:ietf:params:oauth:grant-type:user_code` grant and a PKCE verifier).
 * Tokens authenticate the Anthropic Messages-compatible endpoint
 * (`{host}/anthropic`) as `Authorization: Bearer` — the `anthropic` wire with
 * `wireAuth: 'bearer'`.
 *
 * Two regional lanes ship as separate profiles: the international host
 * (`api.minimax.io`) and the China host (`api.minimaxi.com`). Tokens are not
 * portable between them.
 */

import type { ProviderProfile } from './provider-profile';

export const MINIMAX_OAUTH_PROVIDER_ID = 'minimax-oauth';
export const MINIMAX_OAUTH_CN_PROVIDER_ID = 'minimax-oauth-cn';
export const MINIMAX_OAUTH_HOST = 'https://api.minimax.io';
export const MINIMAX_OAUTH_CN_HOST = 'https://api.minimaxi.com';
export const MINIMAX_OAUTH_CLIENT_ID = '78257093-7e40-4613-99e0-527b14b39113';

const MINIMAX_MODELS: ProviderProfile['models'] = [
  {
    id: 'MiniMax-M3',
    displayName: 'MiniMax M3',
    maxContextSize: 1048576,
    capabilities: ['thinking', 'tool_use'],
  },
  {
    id: 'MiniMax-M2.5',
    displayName: 'MiniMax M2.5',
    maxContextSize: 262144,
    capabilities: ['thinking', 'tool_use'],
  },
];

export const MINIMAX_OAUTH_PROFILE: ProviderProfile = {
  id: MINIMAX_OAUTH_PROVIDER_ID,
  displayName: 'MiniMax (Coding Plan login)',
  description: 'Sign in with your MiniMax Coding Plan account (user code + browser).',
  authType: 'oauth',
  flow: {
    name: MINIMAX_OAUTH_PROVIDER_ID,
    oauthHost: MINIMAX_OAUTH_HOST,
    clientId: MINIMAX_OAUTH_CLIENT_ID,
    kind: 'user_code',
  },
  wire: 'anthropic',
  wireAuth: 'bearer',
  apiBaseUrl: `${MINIMAX_OAUTH_HOST}/anthropic`,
  signupUrl: 'https://platform.minimax.io',
  docUrl: 'https://platform.minimax.io/docs',
  models: MINIMAX_MODELS,
};

export const MINIMAX_OAUTH_CN_PROFILE: ProviderProfile = {
  id: MINIMAX_OAUTH_CN_PROVIDER_ID,
  displayName: 'MiniMax · China (Coding Plan login)',
  description: 'Sign in with your MiniMax Coding Plan account on the China endpoint.',
  authType: 'oauth',
  flow: {
    name: MINIMAX_OAUTH_CN_PROVIDER_ID,
    oauthHost: MINIMAX_OAUTH_CN_HOST,
    clientId: MINIMAX_OAUTH_CLIENT_ID,
    kind: 'user_code',
  },
  wire: 'anthropic',
  wireAuth: 'bearer',
  apiBaseUrl: `${MINIMAX_OAUTH_CN_HOST}/anthropic`,
  signupUrl: 'https://platform.minimaxi.com',
  docUrl: 'https://platform.minimaxi.com/docs',
  models: MINIMAX_MODELS,
};
