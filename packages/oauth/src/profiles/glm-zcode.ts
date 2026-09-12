/**
 * GLM ZCode OAuth profile (UNOFFICIAL, opt-in).
 *
 * Turns a Z.AI account login into a provisioned Z.AI API key via ZCode's
 * authorize page + broker (see {@link ./flow/oauth-flow-glm-zcode.ts}). Model
 * requests then run against Z.AI's Anthropic-compatible endpoint with a plain
 * Bearer key — exactly like a dashboard key, so the provider speaks the
 * `anthropic` wire with `Authorization: Bearer` instead of `x-api-key`.
 *
 * The flow is unofficial (reverse-engineered from the ZCode desktop app) and
 * ships behind the `glm_zcode_oauth` kill-switch flag.
 */

import type { ProviderProfile } from './provider-profile';

import {
  GLM_ZCODE_ANTHROPIC_BASE_URL,
  GLM_ZCODE_OAUTH_AUTHORIZE_URL,
  GLM_ZCODE_OAUTH_CLIENT_ID,
} from '../flow/oauth-flow-glm-zcode';

export const GLM_ZCODE_PROFILE: ProviderProfile = {
  id: 'glm-zcode',
  displayName: 'GLM ZCode (Z.AI account login)',
  description: 'Unofficial ZCode-based Z.AI login; provisions a Z.AI API key automatically.',
  authType: 'oauth',
  flow: {
    name: 'glm-zcode',
    oauthHost: 'https://chat.z.ai',
    clientId: GLM_ZCODE_OAUTH_CLIENT_ID,
    kind: 'code_paste',
    authorizeUrl: GLM_ZCODE_OAUTH_AUTHORIZE_URL,
  },
  wire: 'anthropic',
  apiBaseUrl: GLM_ZCODE_ANTHROPIC_BASE_URL,
  wireAuth: 'bearer',
  signupUrl: 'https://z.ai',
  docUrl: 'https://docs.z.ai',
  models: [
    {
      id: 'glm-4.7',
      displayName: 'GLM 4.7',
      maxContextSize: 200000,
      capabilities: ['thinking', 'tool_use', 'image_in'],
    },
    {
      id: 'glm-4.6',
      displayName: 'GLM 4.6',
      maxContextSize: 200000,
      capabilities: ['thinking', 'tool_use', 'image_in'],
    },
    {
      id: 'glm-4.5-air',
      displayName: 'GLM 4.5 Air',
      maxContextSize: 128000,
      capabilities: ['thinking', 'tool_use'],
    },
  ],
};
