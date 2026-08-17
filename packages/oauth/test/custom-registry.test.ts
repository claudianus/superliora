import { describe, expect, it } from 'vitest';

import {
  applyCustomRegistryProvider,
  capabilitiesFromCustomEntry,
  CUSTOM_REGISTRY_DEFAULT_CAPABILITIES,
  CUSTOM_REGISTRY_DEFAULT_MAX_CONTEXT,
  CustomRegistryApiError,
  type CustomRegistryModelEntry,
} from '../src/registry/custom-registry';
import type { ManagedKimiConfigShape } from '../src/kimi';

describe('oauth/custom-registry — pure helpers', () => {
  it('exposes the documented default constants', () => {
    expect(CUSTOM_REGISTRY_DEFAULT_MAX_CONTEXT).toBe(131072);
    expect([...CUSTOM_REGISTRY_DEFAULT_CAPABILITIES]).toEqual(['tool_use']);
  });

  it('CustomRegistryApiError exposes message, name, and status', () => {
    const err = new CustomRegistryApiError('boom', 503);
    expect(err.message).toBe('boom');
    expect(err.name).toBe('CustomRegistryApiError');
    expect(err.status).toBe(503);
    expect(err).toBeInstanceOf(Error);
  });

  describe('capabilitiesFromCustomEntry', () => {
    it('returns the default capability set for a fully empty entry', () => {
      // No rich hints → empty cap set; consumers fall back to defaults.
      const result = capabilitiesFromCustomEntry({ id: 'empty' });
      expect(result).toEqual([]);
    });

    it('adds "tool_use" when tool_call is true', () => {
      const result = capabilitiesFromCustomEntry({ id: 'tool', tool_call: true });
      expect(result).toContain('tool_use');
    });

    it('adds "thinking" when reasoning is true or interleaved is set', () => {
      expect(capabilitiesFromCustomEntry({ id: 'reason', reasoning: true })).toContain('thinking');
      expect(
        capabilitiesFromCustomEntry({ id: 'interleaved', interleaved: { field: 'reasoning' } }),
      ).toContain('thinking');
    });

    it('adds image_in / video_in / image_out / audio_out for matching modalities', () => {
      const entry: CustomRegistryModelEntry = {
        id: 'modalities',
        modalities: {
          input: ['text', 'image', 'video'],
          output: ['text', 'image', 'audio'],
        },
      };
      const result = capabilitiesFromCustomEntry(entry);
      expect(result).toEqual(
        expect.arrayContaining(['image_in', 'video_in', 'image_out', 'audio_out']),
      );
    });

    it('deduplicates repeated capabilities (reasoning + interleaved both imply thinking)', () => {
      const result = capabilitiesFromCustomEntry({
        id: 'dedupe',
        reasoning: true,
        interleaved: { field: 'reasoning' },
      });
      const thinkingCount = result.filter((c) => c === 'thinking').length;
      expect(thinkingCount).toBe(1);
    });
  });

  it('caps Grok registry windows at the xAI 200k price band', () => {
    const config: ManagedKimiConfigShape = { providers: {}, models: {} };
    applyCustomRegistryProvider(
      config,
      {
        id: 'xai',
        name: 'xAI',
        type: 'openai',
        api: 'https://api.x.ai/v1',
        models: {
          'grok-4.6': {
            id: 'grok-4.6',
            name: 'Grok 4.6',
            limit: { context: 500_000, output: 32_000 },
          },
        },
      },
      { kind: 'apiJson', url: 'https://example.test/api.json', apiKey: 'sk-test' },
    );
    expect(config.models?.['xai/grok-4.6']).toMatchObject({ maxContextSize: 200_000 });
  });
});
