/**
 * Google Antigravity OAuth profile (UNOFFICIAL, opt-in).
 *
 * Google account login that unlocks the Antigravity tier of Cloud Code
 * Assist (Gemini 3 / Claude / GPT-OSS models on the sandbox endpoints). Same
 * installed-app Google client the Antigravity IDE ships — wider scope set
 * (`cclog`, `experimentsandconfigs`) and mandatory PKCE, distinct from the
 * Gemini CLI profile.
 *
 * Heads-up: Google has banned accounts for third-party tools riding this
 * OAuth client (pi-mono and hermes-agent both removed it), so the profile is
 * experimental and defaults off — enable with
 * `SUPERLIORA_EXPERIMENTAL_GOOGLE_ANTIGRAVITY_OAUTH=1`.
 */

import type { ProviderProfile } from './provider-profile';

import {
  GOOGLE_ANTIGRAVITY_CALLBACK_PORT,
  GOOGLE_ANTIGRAVITY_DEFAULT_ENDPOINT,
  GOOGLE_GEMINI_CLI_OAUTH_CLIENT_ID,
} from '../flow/oauth-flow-google';

export const GOOGLE_ANTIGRAVITY_PROVIDER_ID = 'google-antigravity';

/** User-Agent the Antigravity IDE sends; Google kills stale versions. */
export function antigravityUserAgent(): string {
  const env = process.env['SUPERLIORA_ANTIGRAVITY_USER_AGENT']?.trim();
  if (env !== undefined && env.length > 0) return env;
  const platform = process.platform === 'win32' ? 'win32' : process.platform;
  const arch = process.arch === 'x64' ? 'x64' : process.arch;
  return `antigravity/1.15.8 (${platform}; ${arch})`;
}

export const GOOGLE_ANTIGRAVITY_PROFILE: ProviderProfile = {
  id: GOOGLE_ANTIGRAVITY_PROVIDER_ID,
  displayName: 'Google Antigravity (account login)',
  description:
    'Sign in with your Google account for the Antigravity Code Assist tier (experimental; Google may restrict third-party logins).',
  authType: 'oauth',
  flow: {
    name: GOOGLE_ANTIGRAVITY_PROVIDER_ID,
    oauthHost: 'https://accounts.google.com',
    // Same installed-app client family as the Antigravity IDE.
    clientId: GOOGLE_GEMINI_CLI_OAUTH_CLIENT_ID,
    kind: 'google_oauth',
    callbackPort: GOOGLE_ANTIGRAVITY_CALLBACK_PORT,
  },
  wire: 'code-assist',
  apiBaseUrl: GOOGLE_ANTIGRAVITY_DEFAULT_ENDPOINT,
  customHeaders: {
    'User-Agent': antigravityUserAgent(),
    'X-Goog-Api-Client': 'google-cloud-sdk vscode_cloudshelleditor/0.1',
  },
  signupUrl: 'https://antigravity.google',
  docUrl: 'https://antigravity.google/docs',
  models: [
    {
      id: 'gemini-3-pro-high',
      displayName: 'Gemini 3 Pro (High)',
      maxContextSize: 1048576,
      capabilities: ['thinking', 'tool_use', 'image_in'],
    },
    {
      id: 'gemini-3-pro-low',
      displayName: 'Gemini 3 Pro (Low)',
      maxContextSize: 1048576,
      capabilities: ['thinking', 'tool_use', 'image_in'],
    },
    {
      id: 'gemini-3-flash',
      displayName: 'Gemini 3 Flash',
      maxContextSize: 1048576,
      capabilities: ['thinking', 'tool_use', 'image_in'],
    },
    {
      id: 'claude-sonnet-4-5',
      displayName: 'Claude Sonnet 4.5 (Antigravity)',
      maxContextSize: 200000,
      capabilities: ['thinking', 'tool_use', 'image_in'],
    },
    {
      id: 'claude-opus-4-5-thinking',
      displayName: 'Claude Opus 4.5 Thinking (Antigravity)',
      maxContextSize: 200000,
      capabilities: ['thinking', 'tool_use', 'image_in'],
    },
    {
      id: 'gpt-oss-120b-medium',
      displayName: 'GPT-OSS 120B (Antigravity)',
      maxContextSize: 131072,
      capabilities: ['thinking', 'tool_use'],
    },
  ],
};
