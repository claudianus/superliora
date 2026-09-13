/**
 * Kiro (Amazon Q Developer / CodeWhisperer) OAuth profile.
 *
 * AWS SSO OIDC device-code flow against Browser Builder ID. Model requests run
 * through the CodeWhisperer streaming service with the SSO access token as a
 * Bearer credential — the `codewhisperer` kosong wire.
 */

import type { ProviderProfile } from './provider-profile';

export const KIRO_PROVIDER_ID = 'kiro';
export const KIRO_CODEWHISPERER_BASE_URL = 'https://codewhisperer.us-east-1.amazonaws.com';

export const KIRO_PROFILE: ProviderProfile = {
  id: KIRO_PROVIDER_ID,
  displayName: 'Kiro (Amazon Q Developer)',
  description: 'Sign in with AWS Builder ID (Amazon Q / Kiro subscription quota).',
  authType: 'oauth',
  flow: {
    name: KIRO_PROVIDER_ID,
    oauthHost: 'https://oidc.us-east-1.amazonaws.com',
    clientId: 'kiro-public-client',
    kind: 'device_code_kiro',
  },
  wire: 'codewhisperer',
  apiBaseUrl: KIRO_CODEWHISPERER_BASE_URL,
  signupUrl: 'https://kiro.dev',
  docUrl: 'https://kiro.dev/docs',
  models: [
    {
      id: 'claude-sonnet-4-6',
      displayName: 'Claude Sonnet 4.6 (Kiro)',
      maxContextSize: 200000,
      capabilities: ['thinking', 'tool_use', 'image_in'],
    },
    {
      id: 'claude-sonnet-4-5',
      displayName: 'Claude Sonnet 4.5 (Kiro)',
      maxContextSize: 200000,
      capabilities: ['thinking', 'tool_use', 'image_in'],
    },
    {
      id: 'claude-haiku-4-5',
      displayName: 'Claude Haiku 4.5 (Kiro)',
      maxContextSize: 200000,
      capabilities: ['thinking', 'tool_use', 'image_in'],
    },
  ],
};
