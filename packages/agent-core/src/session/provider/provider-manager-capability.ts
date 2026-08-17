import type { ProviderConfig as KosongProviderConfig } from '@superliora/kosong';
import { getModelCapability, type ModelCapability } from '@superliora/kosong';
import { applyXaiPricingSafeContextTokens } from '@superliora/oauth';

import type { ModelAlias, ProviderConfig } from '../../config';
import { lookupModelsDevModel } from '../../utils/model-presets';

/**
 * Resolve effective model capabilities for routing / vision / fleet.
 *
 * Merge rule (positive evidence wins — never let a stale partial
 * `capabilities: ['tool_use']` list deny multimodal that models.dev reports):
 *   declared config ∪ wire static table ∪ warm models.dev row
 */
export function resolveModelCapabilities(
  alias: ModelAlias,
  provider: KosongProviderConfig,
): ModelCapability {
  const declared = new Set((alias.capabilities ?? []).map((c) => c.trim().toLowerCase()));
  const wire = getModelCapability(provider.type, provider.model);
  const catalog = lookupModelsDevModel(provider.model) ?? lookupModelsDevModel(alias.model);

  return {
    image_in:
      declared.has('image_in') || wire.image_in || catalog?.supportsVision === true,
    video_in: declared.has('video_in') || wire.video_in,
    audio_in: declared.has('audio_in') || wire.audio_in,
    thinking:
      declared.has('thinking') ||
      declared.has('always_thinking') ||
      wire.thinking ||
      catalog?.supportsReasoning === true,
    tool_use:
      declared.has('tool_use') || wire.tool_use || catalog?.supportsTools === true,
    max_context_tokens: applyXaiPricingSafeContextTokens(
      alias.maxContextSize ?? catalog?.contextWindow ?? 0,
      { provider: alias.provider, model: alias.model ?? provider.model },
    ),
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
