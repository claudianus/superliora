/**
 * GitLab Duo OAuth profile.
 *
 * Standard OAuth 2.0 PKCE authorization-code flow against `gitlab.com` with a
 * loopback callback on port 8080 (the client id is the public app id used by
 * third-party GitLab CLI integrations; no client secret is involved, and the
 * refresh grant is `client_id` + `refresh_token` only — matching the generic
 * PKCE refresh path).
 *
 * Model requests run through the GitLab Duo anthropic proxy on
 * `cloud.gitlab.com`, which authenticates with `Authorization: Bearer <gitlab
 * oauth token>`, so the provider speaks the `anthropic` wire in bearer mode.
 */

import type { ProviderProfile } from './provider-profile';

export const GITLAB_DUO_OAUTH_HOST = 'https://gitlab.com';
/** Public OAuth application id reused by third-party GitLab CLI clients. */
export const GITLAB_DUO_CLIENT_ID =
  'da4edff2e6ebd2bc3208611e2768bc1c1dd7be791dc5ff26ca34ca9ee44f7d4b';
export const GITLAB_DUO_CALLBACK_PORT = 8080;
export const GITLAB_DUO_SCOPE = 'api';

/** GitLab Duo anthropic-compatible proxy (Duo Workflow / Duo Chat models). */
export const GITLAB_DUO_ANTHROPIC_PROXY_URL = 'https://cloud.gitlab.com/ai/v1/proxy/anthropic';

export const GITLAB_DUO_PROFILE: ProviderProfile = {
  id: 'gitlab-duo',
  displayName: 'GitLab Duo',
  description: 'Sign in with your GitLab account (Duo Proxy: Claude models on GitLab infrastructure).',
  authType: 'oauth',
  flow: {
    name: 'gitlab-duo',
    oauthHost: GITLAB_DUO_OAUTH_HOST,
    clientId: GITLAB_DUO_CLIENT_ID,
    kind: 'pkce_browser',
    variant: 'generic',
    scope: GITLAB_DUO_SCOPE,
    callbackPort: GITLAB_DUO_CALLBACK_PORT,
    authorizeUrl: `${GITLAB_DUO_OAUTH_HOST}/oauth/authorize`,
    tokenUrl: `${GITLAB_DUO_OAUTH_HOST}/oauth/token`,
  },
  wire: 'anthropic',
  apiBaseUrl: GITLAB_DUO_ANTHROPIC_PROXY_URL,
  wireAuth: 'bearer',
  signupUrl: 'https://gitlab.com',
  docUrl: 'https://docs.gitlab.com/user/gitlab_duo/',
  models: [
    {
      id: 'claude-opus-4-6',
      displayName: 'Duo Chat Opus 4.6',
      maxContextSize: 200000,
      capabilities: ['thinking', 'tool_use', 'image_in'],
    },
    {
      id: 'claude-sonnet-4-6',
      displayName: 'Duo Chat Sonnet 4.6',
      maxContextSize: 200000,
      capabilities: ['thinking', 'tool_use', 'image_in'],
    },
    {
      id: 'claude-haiku-4-5',
      displayName: 'Duo Chat Haiku 4.5',
      maxContextSize: 200000,
      capabilities: ['thinking', 'tool_use', 'image_in'],
    },
  ],
};
