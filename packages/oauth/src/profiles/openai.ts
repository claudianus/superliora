/**
 * OpenAI Codex / ChatGPT profile. Supports two flows against `auth.openai.com`:
 *   - PKCE browser flow (loopback callback on port 1455), and
 *   - a custom device-code flow (usercode → poll → token exchange).
 *
 * The resulting access token is a Bearer token against the ChatGPT Codex
 * backend (`https://chatgpt.com/backend-api/codex/responses`), so the
 * persisted provider config uses wire type `openai_responses` with that base.
 *
 * Endpoints and the public client id mirror the official Codex CLI, which
 * third-party tools (opencode, etc.) reuse as a public client.
 */

import type { ProviderProfile } from './provider-profile';

const OPENAI_OAUTH_HOST = 'https://auth.openai.com';
const OPENAI_CLIENT_ID = 'app_EMoamEEZ73f0CkXaXp7hrann';
const OPENAI_CALLBACK_PORT = 1455;
const OPENAI_SCOPE = 'openid profile email offline_access';

export const OPENAI_PROFILE: ProviderProfile = {
  id: 'openai-codex',
  displayName: 'OpenAI Codex (ChatGPT login)',
  description: 'Sign in with your ChatGPT account to use Codex models.',
  authType: 'oauth',
  flow: {
    name: 'openai-codex',
    oauthHost: OPENAI_OAUTH_HOST,
    clientId: OPENAI_CLIENT_ID,
    kind: 'device_code_openai',
    scope: OPENAI_SCOPE,
    callbackPort: OPENAI_CALLBACK_PORT,
    tokenUrl: `${OPENAI_OAUTH_HOST}/oauth/token`,
    authorizeUrl: `${OPENAI_OAUTH_HOST}/oauth/authorize`,
    userAgent: 'liora-cli',
  },
  wire: 'openai_responses',
  apiBaseUrl: 'https://chatgpt.com/backend-api/codex',
  signupUrl: 'https://chatgpt.com',
  docUrl: 'https://developers.openai.com/codex/auth',
  models: [
    {
      id: 'gpt-5-codex',
      displayName: 'GPT-5 Codex',
      maxContextSize: 272000,
      capabilities: ['thinking', 'tool_use'],
    },
    {
      id: 'gpt-5.1-codex',
      displayName: 'GPT-5.1 Codex',
      maxContextSize: 272000,
      capabilities: ['thinking', 'tool_use'],
    },
  ],
};
