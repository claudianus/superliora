/**
 * Kimi managed-account profile. Reuses the existing device-code flow against
 * `auth.kimi.com` (`SUPERLIORA_FLOW_CONFIG`), so the OAuth runner routes Kimi
 * logins through the same path as before — this profile just makes it
 * discoverable in the unified provider picker.
 */

import { SUPERLIORA_FLOW_CONFIG } from '../constants';
import { SUPERLIORA_PROVIDER_NAME } from '../managed-kimi-code';

import type { ProviderProfile } from './provider-profile';

export const KIMI_PROFILE: ProviderProfile = {
  id: SUPERLIORA_PROVIDER_NAME,
  displayName: 'SuperLiora (Kimi · OAuth login)',
  description: 'Sign in with your SuperLiora / Kimi account (device-code OAuth).',
  authType: 'oauth',
  flow: {
    ...SUPERLIORA_FLOW_CONFIG,
    kind: 'device_code_kimi',
  },
  wire: 'kimi',
  signupUrl: 'https://platform.kimi.com',
};
