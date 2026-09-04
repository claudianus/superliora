import { describe, expect, it, vi } from 'vitest';

import {
  applyCustomRegistryEntries,
  applyCustomRegistryProvider,
  capabilitiesFromCustomEntry,
  CUSTOM_REGISTRY_DEFAULT_CAPABILITIES,
  CUSTOM_REGISTRY_DEFAULT_MAX_CONTEXT,
  CustomRegistryApiError,
  fetchCustomRegistry,
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

  it('times out a hung registry fetch with a 408 (no indefinite hang)', async () => {
    const hanging = vi.fn(
      (_url: unknown, init?: { signal?: AbortSignal }) =>
        new Promise<never>((_, reject) => {
          init?.signal?.addEventListener('abort', () => {
            reject(new DOMException('This operation was aborted.', 'AbortError'));
          });
        }),
    );
    await expect(
      fetchCustomRegistry(
        { kind: 'apiJson', url: 'https://hang.test/api.json', apiKey: 'k' },
        hanging as unknown as typeof fetch,
        undefined,
        { timeoutMs: 20 },
      ),
    ).rejects.toMatchObject({ name: 'CustomRegistryApiError', status: 408 });
    expect(hanging).toHaveBeenCalledOnce();
  });

  it('propagates a caller abort instead of mapping it to a timeout', async () => {
    const controller = new AbortController();
    controller.abort();
    const fetchMock = vi.fn(async () => {
      throw new DOMException('This operation was aborted.', 'AbortError');
    });
    await expect(
      fetchCustomRegistry(
        { kind: 'apiJson', url: 'https://x.test/api.json', apiKey: 'k' },
        fetchMock as unknown as typeof fetch,
        controller.signal,
        { timeoutMs: 5_000 },
      ),
    ).rejects.toMatchObject({ name: 'AbortError' });
  });

  it('skips registry entries that collide with OAuth logins (never deletes them)', () => {
    const config: ManagedKimiConfigShape = {
      providers: {
        'cursor-oauth': {
          type: 'cursor',
          baseUrl: 'https://api2.cursor.sh',
          oauth: { storage: 'file', key: 'cursor-oauth' },
        },
      },
      models: {},
    };
    const result = applyCustomRegistryEntries(
      config,
      {
        rogue: {
          id: 'cursor-oauth',
          name: 'Rogue',
          api: 'https://rogue.test/v1',
          type: 'openai',
          models: {},
        },
        fine: {
          id: 'fine',
          name: 'Fine',
          api: 'https://fine.test/v1',
          type: 'openai',
          models: {},
        },
      },
      { kind: 'apiJson', url: 'https://example.test/api.json', apiKey: 'k' },
    );
    expect(result.skippedOAuthCollisions).toEqual(['cursor-oauth']);
    expect(result.applied).toEqual(['fine']);
    expect(config.providers['cursor-oauth']).toMatchObject({
      baseUrl: 'https://api2.cursor.sh',
    });
    expect(config.providers['fine']).toBeDefined();
  });
});
