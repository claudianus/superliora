import { describe, expect, it, vi } from 'vitest';

vi.mock('#/utils/catalog-cache', () => ({
  loadCatalog: vi.fn(),
}));

vi.mock('@superliora/oauth', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@superliora/oauth')>();
  return {
    ...actual,
    fetchCursorAvailableModels: vi.fn(),
    OAuthProviderManager: class {
      async ensureFresh() {
        return 'cursor-token';
      }
    },
  };
});

const { loadCatalog } = await import('#/utils/catalog-cache');
const { fetchCursorAvailableModels } = await import('@superliora/oauth');
const { resolveOAuthProviderModels } = await import('#/tui/commands/provider-connect/oauth');

const XAI_PRESETS = [
  { id: 'grok-4.5', displayName: 'Grok 4.5', maxContextSize: 500000, capabilities: ['thinking', 'tool_use', 'image_in'] },
  { id: 'grok-4.3', displayName: 'Grok 4.3', maxContextSize: 1000000, capabilities: ['thinking', 'tool_use', 'image_in'] },
  { id: 'grok-build-0.1', displayName: 'Grok Build 0.1', maxContextSize: 256000, capabilities: ['thinking', 'tool_use'] },
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
            modalities: { input: ['text', 'image'], output: ['text'] },
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
    expect(alias?.maxContextSize).toBe(200000);
    expect(alias?.capabilities).toContain('thinking');
  });

  it('falls back to the profile preset when the catalog has no entry', async () => {
    vi.mocked(loadCatalog).mockResolvedValue({});

    const result = await resolveOAuthProviderModels('xai-grok', XAI_PRESETS);

    expect(result).toBeDefined();
    expect(result!.map((m) => m.model)).toEqual(['grok-4.5', 'grok-4.3', 'grok-build-0.1']);
    expect(result![0]?.provider).toBe('xai-grok');
  });

  it('falls back to the profile preset when the catalog fetch throws', async () => {
    vi.mocked(loadCatalog).mockRejectedValue(new Error('network down'));

    const result = await resolveOAuthProviderModels('xai-grok', XAI_PRESETS);

    expect(result).toBeDefined();
    expect(result!.map((m) => m.model)).toEqual(['grok-4.5', 'grok-4.3', 'grok-build-0.1']);
  });

  it('returns undefined when neither catalog nor preset yields models', async () => {
    vi.mocked(loadCatalog).mockResolvedValue({});

    const result = await resolveOAuthProviderModels('xai-grok', undefined);

    expect(result).toBeUndefined();
  });

  it('prefers Cursor AvailableModels over static presets', async () => {
    vi.mocked(fetchCursorAvailableModels).mockResolvedValue([
      {
        id: 'composer-2.5',
        displayName: 'Composer 2.5',
        maxContextSize: 200_000,
        capabilities: ['thinking', 'tool_use'],
      },
      {
        id: 'claude-4.6-opus-high',
        displayName: 'Claude 4.6 Opus',
        maxContextSize: 200_000,
        capabilities: ['thinking', 'tool_use', 'image_in'],
      },
    ]);

    const result = await resolveOAuthProviderModels(
      'cursor-oauth',
      [{ id: 'composer-1', displayName: 'Composer 1', maxContextSize: 100_000 }],
      { accessToken: 'tok' },
    );

    expect(result?.map((m) => m.model)).toEqual(['composer-2.5', 'claude-4.6-opus-high']);
    expect(result?.[1]).toMatchObject({
      displayName: 'Claude 4.6 Opus (high)',
      supportEfforts: [],
      defaultEffort: 'high',
    });
    expect(fetchCursorAvailableModels).toHaveBeenCalledWith({ accessToken: 'tok' });
  });

  it('falls back to Cursor presets when AvailableModels is empty', async () => {
    vi.mocked(fetchCursorAvailableModels).mockResolvedValue(undefined);

    const result = await resolveOAuthProviderModels(
      'cursor-oauth',
      [{ id: 'composer-2.5', displayName: 'Composer 2.5', maxContextSize: 200_000 }],
      { accessToken: 'tok' },
    );

    expect(result?.map((m) => m.model)).toEqual(['composer-2.5']);
  });
});
