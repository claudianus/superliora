/**
 * OAuth provider profile registry. Bundles the built-in OAuth-capable
 * profiles and exposes lookup helpers consumed by the TUI picker and the
 * OAuth flow runner.
 */

import { ANTHROPIC_PROFILE } from './anthropic';
import { KIMI_PROFILE } from './kimi';
import { OPENAI_PROFILE } from './openai';
import type { OAuthProviderId, ProviderProfile } from './provider-profile';
import { XAI_PROFILE } from './xai';

export type { OAuthFlowKind, OAuthProviderId, OAuthProviderWire, ProviderFlowConfig, ProviderModelPreset, ProviderProfile } from './provider-profile';

/**
 * Profiles that are always available in the provider picker.
 */
export const PROVIDER_PROFILES: readonly ProviderProfile[] = [
  KIMI_PROFILE,
  OPENAI_PROFILE,
  XAI_PROFILE,
];

/**
 * Profiles gated behind an experimental flag. The TUI only surfaces these when
 * the matching flag is enabled, so the implementation ships ahead of any
 * policy/availability change without exposing it to users.
 */
export const EXPERIMENTAL_PROVIDER_PROFILES: readonly { readonly profile: ProviderProfile; readonly flag: string }[] = [
  { profile: ANTHROPIC_PROFILE, flag: 'anthropic_oauth' },
];

/** All profiles (always-on + experimental), for id-based lookup. */
const ALL_PROFILES: readonly ProviderProfile[] = [
  ...PROVIDER_PROFILES,
  ...EXPERIMENTAL_PROVIDER_PROFILES.map((entry) => entry.profile),
];

const PROFILE_BY_ID: ReadonlyMap<string, ProviderProfile> = new Map(
  ALL_PROFILES.map((profile) => [profile.id, profile]),
);

/** Returns the profile for an OAuth provider id, or `undefined`. */
export function getProviderProfile(id: string): ProviderProfile | undefined {
  return PROFILE_BY_ID.get(id);
}

/** Whether the given id maps to a built-in OAuth-capable provider. */
export function isOAuthProviderId(id: string): boolean {
  return PROFILE_BY_ID.has(id);
}

export { ANTHROPIC_PROFILE, KIMI_PROFILE, OPENAI_PROFILE, XAI_PROFILE };
