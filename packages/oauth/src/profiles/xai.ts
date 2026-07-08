/**
 * xAI (Grok) profile. Uses standard OAuth 2.0 PKCE authorization-code flow
 * with a loopback callback (port 56121). Endpoints are resolved via OIDC
 * discovery at runtime rather than hard-coded paths.
 *
 * The access token is a Bearer token against `https://api.x.ai/v1/responses`,
 * which speaks the OpenAI-compatible wire protocol.
 *
 * Client id and discovery URL mirror the official Grok CLI, reused by
 * third-party tools as a public client.
 */

import type { ProviderProfile } from './provider-profile';

const XAI_OAUTH_HOST = 'https://auth.x.ai';
const XAI_CLIENT_ID = 'b1a00492-073a-47ea-816f-4c329264a828';
const XAI_CALLBACK_PORT = 56121;
// The official Grok CLI OAuth app registers `127.0.0.1` (not `localhost`) as
// the redirect host. xAI matches redirect URIs by exact string, so this must
// agree with the registered value.
const XAI_CALLBACK_HOST = '127.0.0.1';
const XAI_SCOPE = 'openid profile email offline_access grok-cli:access api:access';

export const XAI_PROFILE: ProviderProfile = {
  id: 'xai-grok',
  displayName: 'xAI Grok (account login)',
  description: 'Sign in with your xAI account to use Grok models.',
  authType: 'oauth',
  flow: {
    name: 'xai-grok',
    oauthHost: XAI_OAUTH_HOST,
    clientId: XAI_CLIENT_ID,
    kind: 'pkce_browser',
    scope: XAI_SCOPE,
    callbackPort: XAI_CALLBACK_PORT,
    callbackHost: XAI_CALLBACK_HOST,
    discoveryUrl: `${XAI_OAUTH_HOST}/.well-known/openid-configuration`,
    tokenUrl: `${XAI_OAUTH_HOST}/oauth2/token`,
    authorizeUrl: `${XAI_OAUTH_HOST}/oauth/authorize`,
    userAgent: 'liora-cli',
  },
  wire: 'openai',
  apiBaseUrl: 'https://api.x.ai/v1',
  signupUrl: 'https://x.ai',
  docUrl: 'https://docs.x.ai',
  models: [
    {
      id: 'grok-4',
      displayName: 'Grok 4',
      maxContextSize: 256000,
      capabilities: ['thinking', 'tool_use'],
    },
    {
      id: 'grok-4-fast',
      displayName: 'Grok 4 Fast',
      maxContextSize: 2000000,
      capabilities: ['thinking', 'tool_use'],
    },
  ],
};
