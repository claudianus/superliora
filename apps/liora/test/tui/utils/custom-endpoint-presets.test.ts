import { describe, expect, it } from 'vitest';

import {
  CUSTOM_ENDPOINT_PRESETS,
  getCustomEndpointPreset,
} from '#/tui/utils/model/custom-endpoint-presets';

describe('custom endpoint presets', () => {
  it('covers the opencode-documented local servers', () => {
    const ids = CUSTOM_ENDPOINT_PRESETS.map((preset) => preset.id);
    for (const id of ['ollama', 'lm-studio', 'llamacpp', 'vllm', 'textgen-webui', 'localai']) {
      expect(ids).toContain(id);
    }
  });

  it('every preset carries a usable base URL, wire, and doc link', () => {
    for (const preset of CUSTOM_ENDPOINT_PRESETS) {
      expect(preset.baseUrl).toMatch(/^https?:\/\//);
      expect(preset.wire).toBe('openai');
      expect(preset.docUrl).toMatch(/^https?:\/\//);
      expect(preset.providerId.length).toBeGreaterThan(0);
      expect(getCustomEndpointPreset(preset.id)).toBe(preset);
    }
  });

  it('returns undefined for unknown preset ids', () => {
    expect(getCustomEndpointPreset('nope')).toBeUndefined();
  });
});
