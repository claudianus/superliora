/**
 * Qwen OAuth profile — Qwen account login via RFC 8628 device code + PKCE
 * (the same grant qwen-code uses against `chat.qwen.ai`).
 *
 * The token response carries a per-account `resource_url` (the inference
 * endpoint assigned to the subscription, e.g. `portal.qwen.ai`); the device
 * flow captures it onto the stored token and the connect flow writes it as
 * the provider `baseUrl`. Requests then run on the OpenAI-compatible wire.
 */

import type { ProviderProfile } from './provider-profile';

export const QWEN_OAUTH_PROVIDER_ID = 'qwen-oauth';
export const QWEN_OAUTH_HOST = 'https://chat.qwen.ai';
export const QWEN_OAUTH_CLIENT_ID = 'f0304373b74a44d2b584a3fb70ca9e56';
export const QWEN_OAUTH_SCOPE = 'openid profile email model.completion';
/** Fallback when the token response omits `resource_url`. */
export const QWEN_PORTAL_API_BASE_URL = 'https://portal.qwen.ai/v1';

/**
 * Normalizes Qwen's `resource_url` into an OpenAI-compatible base URL.
 * The field may arrive scheme-less (`portal.qwen.ai`) or bare of `/v1`.
 */
export function qwenResourceUrlToBaseUrl(resourceUrl: string): string | undefined {
  const trimmed = resourceUrl.trim();
  if (trimmed.length === 0) return undefined;
  const withScheme = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
  try {
    const url = new URL(withScheme);
    const path = url.pathname.replace(/\/+$/, '');
    if (path === '' || path === '/') {
      url.pathname = '/v1';
    } else {
      url.pathname = path;
    }
    return url.toString().replace(/\/+$/, '');
  } catch {
    return undefined;
  }
}

export const QWEN_OAUTH_PROFILE: ProviderProfile = {
  id: QWEN_OAUTH_PROVIDER_ID,
  displayName: 'Qwen (account login)',
  description: 'Sign in with your Qwen account (device code). Includes free-tier daily quota.',
  authType: 'oauth',
  flow: {
    name: QWEN_OAUTH_PROVIDER_ID,
    oauthHost: QWEN_OAUTH_HOST,
    clientId: QWEN_OAUTH_CLIENT_ID,
    kind: 'device_code',
    deviceCodeUrl: `${QWEN_OAUTH_HOST}/api/v1/oauth2/device/code`,
    tokenUrl: `${QWEN_OAUTH_HOST}/api/v1/oauth2/token`,
    scope: QWEN_OAUTH_SCOPE,
    pkce: true,
  },
  wire: 'openai',
  apiBaseUrl: QWEN_PORTAL_API_BASE_URL,
  signupUrl: 'https://chat.qwen.ai',
  docUrl: 'https://qwen.ai',
  models: [
    {
      id: 'qwen3-coder-plus',
      displayName: 'Qwen3 Coder Plus',
      maxContextSize: 1048576,
      capabilities: ['thinking', 'tool_use'],
    },
    {
      id: 'qwen3-coder-flash',
      displayName: 'Qwen3 Coder Flash',
      maxContextSize: 262144,
      capabilities: ['tool_use'],
    },
    {
      id: 'qwen3-max',
      displayName: 'Qwen3 Max',
      maxContextSize: 262144,
      capabilities: ['thinking', 'tool_use'],
    },
    {
      id: 'qwen3-vl-plus',
      displayName: 'Qwen3 VL Plus',
      maxContextSize: 262144,
      capabilities: ['tool_use', 'image_in'],
    },
  ],
};
