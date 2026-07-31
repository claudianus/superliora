import type { ProviderConfig as KosongProviderConfig } from '@superliora/kosong';
import { getModelCapability, type ModelCapability } from '@superliora/kosong';

import type { ModelAlias, ProviderConfig } from '../../config';

export function resolveModelCapabilities(
  alias: ModelAlias,
  provider: KosongProviderConfig,
): ModelCapability {
  const declared = new Set((alias.capabilities ?? []).map((c) => c.trim().toLowerCase()));
  const detected = getModelCapability(provider.type, provider.model);

  return {
    image_in: declared.has('image_in') || detected.image_in,
    video_in: declared.has('video_in') || detected.video_in,
    audio_in: declared.has('audio_in') || detected.audio_in,
    thinking: declared.has('thinking') || declared.has('always_thinking') || detected.thinking,
    tool_use: declared.has('tool_use') || detected.tool_use,
    max_context_tokens: alias.maxContextSize,
  };
}

export function providerHasAnyCredential(provider: ProviderConfig): boolean {
  if (typeof provider.apiKey === 'string' && provider.apiKey.trim().length > 0) return true;
  if (Array.isArray(provider.apiKeys) && provider.apiKeys.some((k) => typeof k === 'string' && k.trim().length > 0))
    return true;
  if (Array.isArray(provider.credentials) && provider.credentials.length > 0) return true;
  if (provider.oauth !== undefined) return true;
  if (Array.isArray(provider.oauths) && provider.oauths.length > 0) return true;
  return false;
}

export function sameCapability(
  primary: ModelCapability | undefined,
  other: ModelCapability | undefined,
): boolean {
  if (primary === undefined || other === undefined) return true;
  // Vision parity when primary accepts images
  if (primary.image_in && ! other.image_in) return false;
  return true;
}
