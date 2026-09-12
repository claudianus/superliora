/**
 * Google Gemini CLI OAuth profile — Cloud Code Assist login.
 *
 * Standard Google OAuth (client id/secret from the official Gemini CLI) with a
 * loopback callback on port 8085. The resulting token is a Bearer token for
 * the Code Assist endpoint (`cloudcode-pa.googleapis.com`), which speaks a
 * Gemini-style wire inside a `{model, project, request}` envelope — the
 * `code-assist` kosong wire. The discovered/provisioned Code Assist project id
 * is stored with the token and written into the provider config on connect.
 *
 * Free-tier accounts get a project provisioned automatically; workspace
 * accounts may require GOOGLE_CLOUD_PROJECT.
 */

import type { ProviderProfile } from './provider-profile';

import { GOOGLE_GEMINI_CLI_CALLBACK_PORT, GOOGLE_GEMINI_CLI_OAUTH_CLIENT_ID, GOOGLE_CODE_ASSIST_ENDPOINT } from '../flow/oauth-flow-google';

export const GOOGLE_GEMINI_CLI_PROVIDER_ID = 'google-gemini-cli';

export const GOOGLE_GEMINI_CLI_PROFILE: ProviderProfile = {
  id: GOOGLE_GEMINI_CLI_PROVIDER_ID,
  displayName: 'Google Gemini (Code Assist account login)',
  description: 'Sign in with your Google account (Gemini CLI free tier / Code Assist).',
  authType: 'oauth',
  flow: {
    name: GOOGLE_GEMINI_CLI_PROVIDER_ID,
    oauthHost: 'https://accounts.google.com',
    clientId: GOOGLE_GEMINI_CLI_OAUTH_CLIENT_ID,
    kind: 'google_oauth',
    scope:
      'https://www.googleapis.com/auth/cloud-platform https://www.googleapis.com/auth/userinfo.email https://www.googleapis.com/auth/userinfo.profile',
    callbackPort: GOOGLE_GEMINI_CLI_CALLBACK_PORT,
    authorizeUrl: 'https://accounts.google.com/o/oauth2/v2/auth',
    tokenUrl: 'https://oauth2.googleapis.com/token',
  },
  wire: 'code-assist',
  apiBaseUrl: GOOGLE_CODE_ASSIST_ENDPOINT,
  signupUrl: 'https://codeassist.google',
  docUrl: 'https://developers.google.com/gemini-code-assist',
  models: [
    {
      id: 'gemini-2.5-pro',
      displayName: 'Gemini 2.5 Pro',
      maxContextSize: 1048576,
      capabilities: ['thinking', 'tool_use', 'image_in'],
    },
    {
      id: 'gemini-2.5-flash',
      displayName: 'Gemini 2.5 Flash',
      maxContextSize: 1048576,
      capabilities: ['thinking', 'tool_use', 'image_in'],
    },
  ],
};
