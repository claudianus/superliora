import { describe, expect, it } from 'vitest';

import {
  capabilitiesFromCustomEntry,
  CUSTOM_REGISTRY_DEFAULT_CAPABILITIES,
  CUSTOM_REGISTRY_DEFAULT_MAX_CONTEXT,
  CustomRegistryApiError,
  type CustomRegistryModelEntry,
} from '../src/registry/custom-registry';

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
      const result = capabilitiesFromCustomEntry({});
      expect(result).toEqual([]);
    });

    it('adds "tool_use" when tool_call is true', () => {
      const result = capabilitiesFromCustomEntry({ tool_call: true });
      expect(result).toContain('tool_use');
    });

    it('adds "thinking" when reasoning is true or interleaved is set', () => {
      expect(capabilitiesFromCustomEntry({ reasoning: true })).toContain('thinking');
      expect(capabilitiesFromCustomEntry({ interleaved: 'field' })).toContain('thinking');
    });

    it('adds image_in / video_in / image_out / audio_out for matching modalities', () => {
      const entry: CustomRegistryModelEntry = {
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
      const result = capabilitiesFromCustomEntry({ reasoning: true, interleaved: 'reasoning' });
      const thinkingCount = result.filter((c) => c === 'thinking').length;
      expect(thinkingCount).toBe(1);
    });
  });
});
