/**
 * One-click local-endpoint presets for the `/login` custom-endpoint dialog.
 *
 * Hosted gateways (OpenRouter, DeepSeek, …) already surface as catalog rows
 * with env hints, so presets cover the opposite gap: local OpenAI-compatible
 * servers (opencode documents the same set: Ollama, LM Studio, llama.cpp).
 * Selecting a preset opens the custom-endpoint dialog prefilled — the user
 * only types the model id.
 */

import { getApiKeyProvider } from '@superliora/oauth';

import type { CustomEndpointWireType } from '#/tui/components/dialogs/provider/custom-endpoint-import';

export interface CustomEndpointPreset {
  /** Stable preset id (`preset:<id>` picker value). */
  readonly id: string;
  /** Default provider id written to config (editable in the dialog). */
  readonly providerId: string;
  readonly displayName: string;
  readonly baseUrl: string;
  readonly wire: CustomEndpointWireType;
  readonly docUrl: string;
}

/** Registry ids that become picker presets, in display order. */
const PRESET_REGISTRY_IDS = [
  'ollama',
  'lm-studio',
  'llamacpp',
  'vllm',
  'textgen-webui',
  'localai',
] as const;

function presetProviderId(registryId: string): string {
  // Keep config ids filesystem- and picker-friendly.
  if (registryId === 'textgen-webui') return 'textgen';
  return registryId;
}

export const CUSTOM_ENDPOINT_PRESETS: readonly CustomEndpointPreset[] = PRESET_REGISTRY_IDS.map(
  (id): CustomEndpointPreset => {
    const def = getApiKeyProvider(id);
    if (def === undefined || def.defaultBaseUrl === undefined) {
      throw new Error(`Custom endpoint preset is missing registry data: "${id}".`);
    }
    return {
      id,
      providerId: presetProviderId(id),
      displayName: def.displayName,
      baseUrl: def.defaultBaseUrl,
      wire: 'openai',
      docUrl: def.docUrl,
    };
  },
);

export function getCustomEndpointPreset(id: string): CustomEndpointPreset | undefined {
  return CUSTOM_ENDPOINT_PRESETS.find((preset) => preset.id === id);
}
