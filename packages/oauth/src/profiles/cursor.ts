/**
 * Cursor account OAuth profile — deep-link PKCE poll against
 * `api2.cursor.sh`, then inference via Cursor's Connect-RPC agent/chat API.
 *
 * **Experimental.** Cursor does not publish a third-party OAuth + chat API for
 * CLI reuse. Endpoints and client-version gates are reverse-engineered from
 * the Cursor CLI / community clients and may break without notice. Disable
 * with `SUPERLIORA_EXPERIMENTAL_CURSOR_OAUTH=0`.
 */

import type { ProviderProfile } from './provider-profile';

const CURSOR_OAUTH_HOST = 'https://api2.cursor.sh';
const CURSOR_LOGIN_HOST = 'https://cursor.com';
/** Default agent host used by current Cursor CLI clients (non-privacy). */
export const CURSOR_AGENT_BASE_URL = 'https://agentn.global.api5.cursor.sh';
/** Client version advertised on Connect requests; override via env. */
export const CURSOR_CLIENT_VERSION_DEFAULT = 'cli-2026.07.08-0c04a8a';
export const CURSOR_CLIENT_TYPE = 'cli';

export function resolveCursorClientVersion(): string {
  const fromEnv = process.env['SUPERLIORA_CURSOR_CLIENT_VERSION']?.trim();
  if (fromEnv !== undefined && fromEnv.length > 0) return fromEnv;
  return CURSOR_CLIENT_VERSION_DEFAULT;
}

/** Static headers identifying a Cursor CLI session for Connect-RPC calls. */
export function cursorAuthHeaders(): Record<string, string> {
  return {
    'x-cursor-client-type': CURSOR_CLIENT_TYPE,
    'x-cursor-client-version': resolveCursorClientVersion(),
    'x-ghost-mode': 'false',
  };
}

export const CURSOR_PROFILE: ProviderProfile = {
  id: 'cursor-oauth',
  displayName: 'Cursor (account login)',
  description:
    'Sign in with your Cursor account (experimental). Uses Cursor subscription models via the unofficial Connect API.',
  authType: 'oauth',
  flow: {
    name: 'cursor-oauth',
    oauthHost: CURSOR_OAUTH_HOST,
    // Cursor deep-link login does not use a registered OAuth client id.
    clientId: 'cursor-cli',
    kind: 'deep_link_poll',
    authorizeUrl: `${CURSOR_LOGIN_HOST}/loginDeepControl`,
    tokenUrl: `${CURSOR_OAUTH_HOST}/auth/exchange_user_api_key`,
    userAgent: 'liora-cli',
  },
  wire: 'cursor',
  apiBaseUrl: CURSOR_AGENT_BASE_URL,
  customHeaders: cursorAuthHeaders(),
  signupUrl: 'https://cursor.com',
  docUrl: 'https://cursor.com/docs',
  models: [
    {
      id: 'composer-2',
      displayName: 'Composer 2',
      maxContextSize: 200000,
      capabilities: ['thinking', 'tool_use'],
    },
    {
      id: 'composer-1.5',
      displayName: 'Composer 1.5',
      maxContextSize: 200000,
      capabilities: ['thinking', 'tool_use'],
    },
    {
      id: 'claude-sonnet-4-5',
      displayName: 'Claude Sonnet 4.5 (via Cursor)',
      maxContextSize: 200000,
      capabilities: ['thinking', 'tool_use', 'image_in'],
    },
    {
      id: 'gpt-5.2',
      displayName: 'GPT-5.2 (via Cursor)',
      maxContextSize: 200000,
      capabilities: ['thinking', 'tool_use'],
    },
    {
      id: 'grok-4',
      displayName: 'Grok 4 (via Cursor)',
      maxContextSize: 200000,
      capabilities: ['thinking', 'tool_use'],
    },
  ],
};
