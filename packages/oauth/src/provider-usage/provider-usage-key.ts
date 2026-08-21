import {
  ANTHROPIC_PROFILE,
  CURSOR_PROFILE,
  getProviderProfile,
  KIMI_PROFILE,
  OPENAI_PROFILE,
  XAI_PROFILE,
} from '../profiles';
import { isXaiGrokProviderId } from '../profiles/long-context-pricing';

/**
 * Map a catalog id, OAuth wire name, or route `providerName` onto the
 * snapshot `providerKey` we actually fetch (`anthropic-oauth`, `openai-codex`, …).
 *
 * Uses existing {@link ProviderProfile} `id` / `wire`. Catalog `openai` is
 * Codex — not xAI's OpenAI-compat `wire: 'openai'`.
 */
export function resolveUsageProviderKey(name: string | undefined): string | undefined {
  if (name === undefined) return undefined;
  const key = name.trim();
  if (key.length === 0) return undefined;
  if (getProviderProfile(key) !== undefined) return key;
  if (isXaiGrokProviderId(key)) return XAI_PROFILE.id;

  switch (key) {
    case ANTHROPIC_PROFILE.wire:
      return ANTHROPIC_PROFILE.id;
    case OPENAI_PROFILE.wire:
    case 'openai':
      return OPENAI_PROFILE.id;
    case CURSOR_PROFILE.wire:
      return CURSOR_PROFILE.id;
    case KIMI_PROFILE.wire:
      return KIMI_PROFILE.id;
    default:
      return key;
  }
}
