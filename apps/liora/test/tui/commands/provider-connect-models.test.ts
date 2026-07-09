import { describe, expect, it, vi } from 'vitest';

vi.mock('#/utils/catalog-cache', () => ({
  loadCatalog: vi.fn(),
}));

const { loadCatalog } = await import('#/utils/catalog-cache');
const { resolveOAuthProviderModels } = await import('#/tui/commands/provider-connect');

const XAI_PRESETS = [
  { id: 'grok-4.5', displayName: 'Grok 4.5', maxContextSize: 500000, capabilities: ['thinking', 'tool_use'] },
  { id: 'grok-4', displayName: 'Grok 4', maxContextSize: 256000, capabilities: ['thinking', 'tool_use'] },
];

describe('resolveOAuthProviderModels', () => {
  it('prefers models.dev catalog models for the OAuth provider', async () => {
    vi.mocked(loadCatalog).mockResolvedValue({
      xai: {
        id: 'xai',
        name: 'xAI',
        models: {
          'grok-4.5': {
            id: 'grok-4.5',
            name: 'Grok 4.5',
            limit: { context: 500000, output: 32000 },
            tool_call: true,
            reasoning: true,
            modalities: { input: ['text'], output: ['text'] },
          },
        },
      },
    });

    const result = await resolveOAuthProviderModels('xai-grok', XAI_PRESETS);

    expect(result).toBeDefined();
    expect(result!.length).toBe(1);
    const alias = result![0];
    expect(alias?.model).toBe('grok-4.5');
    expect(alias?.provider).toBe('xai-grok');
    expect(alias?.maxContextSize).toBe(500000);
    expect(alias?.capabilities).toContain('thinking');
  });

  it('falls back to the profile preset when the catalog has no entry', async () => {
    vi.mocked(loadCatalog).mockResolvedValue({});

    const result = await resolveOAuthProviderModels('xai-grok', XAI_PRESETS);

    expect(result).toBeDefined();
    expect(result!.map((m) => m.model)).toEqual(['grok-4.5', 'grok-4']);
    expect(result![0]?.provider).toBe('xai-grok');
  });

  it('falls back to the profile preset when the catalog fetch throws', async () => {
    vi.mocked(loadCatalog).mockRejectedValue(new Error('network down'));

    const result = await resolveOAuthProviderModels('xai-grok', XAI_PRESETS);

    expect(result).toBeDefined();
    expect(result!.map((m) => m.model)).toEqual(['grok-4.5', 'grok-4']);
  });

  it('returns undefined when neither catalog nor preset yields models', async () => {
    vi.mocked(loadCatalog).mockResolvedValue({});

    const result = await resolveOAuthProviderModels('xai-grok', undefined);

    expect(result).toBeUndefined();
  });
});
