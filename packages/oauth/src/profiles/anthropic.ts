/**
 * Anthropic (Claude) OAuth profile — PKCE browser flow against
 * `console.anthropic.com`.
 *
 * **Disabled by default.** Anthropic does not currently authorize third-party
 * CLIs to reuse its Claude-Code subscription OAuth (tokens minted by non-Claude
 * Code clients are rejected after the callback). This profile is implemented
 * ahead of time and gated behind the `anthropic_oauth` experimental flag
 * (`SUPERLIORA_EXPERIMENTAL_ANTHROPIC_OAUTH=1`) so it can be enabled instantly
 * if Anthropic's policy changes.
 *
 * Endpoints and the client id are the values reverse-engineered from the
 * Claude Code client. The resulting token is a Bearer token against the
 * Anthropic Messages API.
 */

import type { ProviderProfile } from './provider-profile';

const ANTHROPIC_OAUTH_HOST = 'https://console.anthropic.com';
const ANTHROPIC_CLIENT_ID = '9d1c250a-e61b-44d9-88ed-5944d1962f47';
const ANTHROPIC_CALLBACK_PORT = 1456;
const ANTHROPIC_SCOPE = 'org:create_api_key user:profile user:inference';

export const ANTHROPIC_PROFILE: ProviderProfile = {
  id: 'anthropic-oauth',
  displayName: 'Anthropic (Claude account login)',
  description: 'Sign in with your Anthropic account (experimental).',
  authType: 'oauth',
  flow: {
    name: 'anthropic-oauth',
    oauthHost: ANTHROPIC_OAUTH_HOST,
    clientId: ANTHROPIC_CLIENT_ID,
    kind: 'pkce_browser',
    scope: ANTHROPIC_SCOPE,
    callbackPort: ANTHROPIC_CALLBACK_PORT,
    authorizeUrl: 'https://claude.ai/oauth/authorize',
    tokenUrl: `${ANTHROPIC_OAUTH_HOST}/v1/oauth/token`,
    userAgent: 'liora-cli',
  },
  wire: 'anthropic',
  apiBaseUrl: 'https://api.anthropic.com',
  signupUrl: 'https://console.anthropic.com',
  docUrl: 'https://docs.anthropic.com',
  models: [
    {
      id: 'claude-opus-4-1',
      displayName: 'Claude Opus 4.1',
      maxContextSize: 200000,
      capabilities: ['thinking', 'tool_use', 'image_in'],
    },
    {
      id: 'claude-sonnet-4-1',
      displayName: 'Claude Sonnet 4.1',
      maxContextSize: 200000,
      capabilities: ['thinking', 'tool_use', 'image_in'],
    },
  ],
};
