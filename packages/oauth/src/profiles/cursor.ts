/**
 * Cursor account OAuth profile — deep-link PKCE poll against
 * `api2.cursor.sh`, then inference via Cursor's Connect-RPC agent/chat API.
 *
 * **Experimental.** Cursor does not publish a third-party OAuth + chat API for
 * CLI reuse. Endpoints and client-version gates are reverse-engineered from
 * the Cursor CLI / community clients and may break without notice. Disable
 * with `SUPERLIORA_EXPERIMENTAL_CURSOR_OAUTH=0`.
 *
 * Model presets are the offline fallback; live catalogs come from
 * {@link fetchCursorAvailableModels} on connect / provider refresh.
 */

import {
  CURSOR_FALLBACK_MODELS,
  cursorModelsToPresets,
} from './cursor-available-models';
import {
  CURSOR_CLIENT_TYPE,
  CURSOR_CLIENT_VERSION_DEFAULT,
  cursorAuthHeaders,
  resolveCursorClientVersion,
} from './cursor-client';
import type { ProviderProfile } from './provider-profile';

const CURSOR_OAUTH_HOST = 'https://api2.cursor.sh';
const CURSOR_LOGIN_HOST = 'https://cursor.com';
/** Default agent host used by current Cursor CLI clients (non-privacy). */
export const CURSOR_AGENT_BASE_URL = 'https://agentn.global.api5.cursor.sh';

export {
  CURSOR_CLIENT_TYPE,
  CURSOR_CLIENT_VERSION_DEFAULT,
  cursorAuthHeaders,
  resolveCursorClientVersion,
};

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
  models: cursorModelsToPresets(CURSOR_FALLBACK_MODELS),
};
