import {
  applyCatalogProvider,
  catalogProviderModels,
  catalogWireGroups,
  inferWireType,
  type Catalog,
} from '@superliora/sdk';
import { describe, expect, it, vi } from 'vitest';

import {
  CLINEPASS_API_BASE,
  CLINEPASS_API_KEY_ENV,
  CLINEPASS_CATALOG_ENTRY,
  CLINEPASS_PROVIDER_ID,
  COMMANDCODE_API_BASE,
  COMMANDCODE_API_KEY_ENVS,
  COMMANDCODE_CATALOG_ENTRY,
  COMMANDCODE_DOC_URL,
  COMMANDCODE_MODELS_URL,
  COMMANDCODE_PROVIDER_ID,
  detectedConnectEnvHints,
  fetchCommandCodeModels,
  mergeLocalCatalogProviders,
  OPENCODE_ZEN_API_BASE,
  OPENCODE_ZEN_CATALOG_ENTRY,
  OPENCODE_ZEN_PROVIDER_ID,
  resolveConnectCatalogEntry,
  ZAI_CODING_PLAN_API_BASE,
  ZAI_CODING_PLAN_CATALOG_ENTRY,
  ZAI_CODING_PLAN_PROVIDER_ID,
} from '#/utils/local-catalog-providers';

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('local catalog providers', () => {
  it('declares ClinePass as an OpenAI-compatible catalog entry', () => {
    expect(CLINEPASS_CATALOG_ENTRY.id).toBe(CLINEPASS_PROVIDER_ID);
    expect(CLINEPASS_CATALOG_ENTRY.api).toBe(CLINEPASS_API_BASE);
    expect(CLINEPASS_CATALOG_ENTRY.env).toEqual([CLINEPASS_API_KEY_ENV]);
    expect(inferWireType(CLINEPASS_CATALOG_ENTRY)).toBe('openai');
  });

  it('exposes ClinePass provider shell without hard-coded models (live is source)', () => {
    const models = catalogProviderModels(CLINEPASS_CATALOG_ENTRY);
    // cline-pass is on models.dev (13) — hard-coded removed, live/OpenRouter is source
    expect(models.length).toBe(0);
    expect(CLINEPASS_CATALOG_ENTRY.models).toEqual({});
  });

  it('declares Z.AI Coding Plan as an OpenAI-compatible entry without hard-coded models', () => {
    expect(ZAI_CODING_PLAN_CATALOG_ENTRY.id).toBe(ZAI_CODING_PLAN_PROVIDER_ID);
    expect(ZAI_CODING_PLAN_CATALOG_ENTRY.api).toBe(ZAI_CODING_PLAN_API_BASE);
    expect(ZAI_CODING_PLAN_CATALOG_ENTRY.env).toContain('Z_AI_API_KEY');
    expect(inferWireType(ZAI_CODING_PLAN_CATALOG_ENTRY)).toBe('openai');
    const models = catalogProviderModels(ZAI_CODING_PLAN_CATALOG_ENTRY);
    // zai-coding-plan is on models.dev (7 models) — hard-coded removed, live is source
    expect(models.length).toBe(0);
  });

  it('declares OpenCode Zen provider shell without hard-coded models (live is source)', () => {
    expect(OPENCODE_ZEN_CATALOG_ENTRY.id).toBe(OPENCODE_ZEN_PROVIDER_ID);
    expect(OPENCODE_ZEN_CATALOG_ENTRY.api).toBe(OPENCODE_ZEN_API_BASE);
    expect(OPENCODE_ZEN_CATALOG_ENTRY.env).toContain('OPENCODE_API_KEY');
    expect(inferWireType(OPENCODE_ZEN_CATALOG_ENTRY)).toBe('openai');
    const models = catalogProviderModels(OPENCODE_ZEN_CATALOG_ENTRY);
    // opencode is on models.dev (93 models) — hard-coded removed, live/OpenRouter is source
    expect(models.length).toBe(0);
  });

  it('lists unique connect-env hints without duplicating Z.AI labels', () => {
    expect(
      detectedConnectEnvHints({
        OPENCODE_API_KEY: 'k',
        Z_AI_API_KEY: 'z',
        ZAI_API_KEY: 'also-z',
        OPENROUTER_API_KEY: 'or',
      }).map((row) => row.label),
    ).toEqual(['OpenCode Zen', 'Z.AI', 'OpenRouter']);
  });

  it('merges local providers without clobbering unrelated catalog entries', () => {
    const remote: Catalog = {
      anthropic: {
        id: 'anthropic',
        name: 'Anthropic',
        npm: '@ai-sdk/anthropic',
        env: ['ANTHROPIC_API_KEY'],
      },
    };
    const merged = mergeLocalCatalogProviders(remote);
    expect(merged['anthropic']?.name).toBe('Anthropic');
    expect(merged[CLINEPASS_PROVIDER_ID]?.name).toBe('ClinePass');
    expect(merged[CLINEPASS_PROVIDER_ID]?.api).toBe(CLINEPASS_API_BASE);
    expect(merged[OPENCODE_ZEN_PROVIDER_ID]?.name).toBe('OpenCode Zen');
    expect(merged[ZAI_CODING_PLAN_PROVIDER_ID]?.name).toBe('Z.AI (GLM Coding Plan)');
  });

  it('lets SuperLiora-curated entries override a same-id remote entry', () => {
    const remote: Catalog = {
      'cline-pass': {
        id: 'cline-pass',
        name: 'Stale ClinePass',
        api: 'https://example.test/v1',
      },
    };
    const merged = mergeLocalCatalogProviders(remote);
    expect(merged['cline-pass']?.name).toBe('ClinePass');
    expect(merged['cline-pass']?.api).toBe(CLINEPASS_API_BASE);
  });
});

describe('Command Code catalog entry', () => {
  it('declares Command Code as an OpenAI-compatible catalog entry', () => {
    expect(COMMANDCODE_CATALOG_ENTRY.id).toBe(COMMANDCODE_PROVIDER_ID);
    expect(COMMANDCODE_CATALOG_ENTRY.api).toBe(COMMANDCODE_API_BASE);
    expect(COMMANDCODE_CATALOG_ENTRY.env).toEqual([...COMMANDCODE_API_KEY_ENVS]);
    expect(COMMANDCODE_CATALOG_ENTRY.doc).toBe(COMMANDCODE_DOC_URL);
    expect(inferWireType(COMMANDCODE_CATALOG_ENTRY)).toBe('openai');
  });

  it('ships a curated offline snapshot with valid chat models', () => {
    const models = catalogProviderModels(COMMANDCODE_CATALOG_ENTRY);
    expect(models.length).toBeGreaterThan(50);
    for (const model of models) {
      expect(model.capability.max_context_tokens).toBeGreaterThan(0);
      expect(model.capability.tool_use).toBe(true);
    }
  });

  it('curates GLM-5.3-Flash as a reasoning model with image+pdf input', () => {
    // Regression: the snapshot shipped `reasoning: false`, so the CommandCode
    // picker showed GLM-5.3-Flash as non-reasoning. models.dev consensus is
    // always-on reasoning with an effort ladder plus image/pdf input.
    const model = catalogProviderModels(COMMANDCODE_CATALOG_ENTRY).find(
      (row) => row.id === 'z-ai/glm-5.3-flash',
    );
    expect(model).toBeDefined();
    expect(model?.capability.thinking).toBe(true);
    expect(model?.alwaysThinking).toBe(true);
    expect(model?.supportEfforts).toEqual(['low', 'high', 'max']);
    expect(model?.capability.image_in).toBe(true);
    expect(model?.capability.pdf_in).toBe(true);
  });

  it('routes Claude models over the Anthropic Messages wire and the rest over Chat Completions', () => {
    const groups = catalogWireGroups(COMMANDCODE_CATALOG_ENTRY, { wire: 'openai' });
    const byWire = new Map(groups.map((group) => [group.wire, group]));

    const anthropic = byWire.get('anthropic');
    const openai = byWire.get('openai');
    expect(anthropic).toBeDefined();
    expect(openai).toBeDefined();
    // catalogBaseUrl strips /v1 for the anthropic wire so the official SDK
    // appends exactly one /v1/messages.
    expect(anthropic!.baseUrl).toBe('https://api.commandcode.ai/provider');
    expect(openai!.baseUrl).toBe(COMMANDCODE_API_BASE);
    expect(anthropic!.models.map((model) => model.id)).toContain('claude-sonnet-5');
    expect(anthropic!.models.map((model) => model.id)).not.toContain('deepseek/deepseek-v4-flash');
    expect(openai!.models.map((model) => model.id)).toContain('deepseek/deepseek-v4-flash');
  });

  it('appears in the merged catalog even fully offline', () => {
    const merged = mergeLocalCatalogProviders({});
    expect(merged[COMMANDCODE_PROVIDER_ID]?.name).toBe('Command Code');
    expect(merged[COMMANDCODE_PROVIDER_ID]?.api).toBe(COMMANDCODE_API_BASE);
  });

  it('hints Command Code env keys once per label', () => {
    expect(
      detectedConnectEnvHints({ CMD_API_KEY: 'k', COMMANDCODE_API_KEY: 'also-k' }).map(
        (row) => row.label,
      ),
    ).toEqual(['Command Code']);
  });
});

describe('fetchCommandCodeModels', () => {
  it('maps the live listing and enriches rows with curated capabilities', async () => {
    const fetchMock = vi.fn(async () =>
      jsonResponse({
        data: [
          { id: 'deepseek/deepseek-v4-flash', name: 'DeepSeek V4 Flash (renamed)', context_length: 999_999 },
          { id: 'brand-new-model', name: 'Brand New', context_length: 128_000 },
        ],
      }),
    );
    const models = await fetchCommandCodeModels(undefined, fetchMock as unknown as typeof fetch);

    expect(fetchMock).toHaveBeenCalledWith(
      COMMANDCODE_MODELS_URL,
      expect.objectContaining({ headers: { Accept: 'application/json' } }),
    );
    const flash = models?.['deepseek/deepseek-v4-flash'];
    expect(flash).toMatchObject({
      id: 'deepseek/deepseek-v4-flash',
      name: 'DeepSeek V4 Flash (renamed)',
      reasoning: true,
      reasoning_options: [{ type: 'toggle' }],
    });
    expect(flash?.limit?.context).toBe(999_999);
    // Unknown ids stay usable even without curated metadata.
    expect(models?.['brand-new-model']).toMatchObject({ id: 'brand-new-model' });
    expect(models?.['brand-new-model']?.limit?.context).toBe(128_000);
  });

  it('falls back to the curated context length when the live row omits one', async () => {
    const fetchMock = vi.fn(async () =>
      jsonResponse({ data: [{ id: 'xai/grok-4.5' }] }),
    );
    const models = await fetchCommandCodeModels(undefined, fetchMock as unknown as typeof fetch);
    expect(models?.['xai/grok-4.5']?.limit?.context).toBe(500_000);
  });

  it('returns undefined on HTTP errors, bad payloads, and network failures', async () => {
    const httpError = vi.fn(async () => jsonResponse('no', 500));
    expect(await fetchCommandCodeModels(undefined, httpError as unknown as typeof fetch)).toBeUndefined();

    const emptyPayload = vi.fn(async () => jsonResponse({ object: 'list', data: [] }));
    expect(await fetchCommandCodeModels(undefined, emptyPayload as unknown as typeof fetch)).toBeUndefined();

    const networkError = vi.fn(async () => {
      throw new Error('offline');
    });
    expect(await fetchCommandCodeModels(undefined, networkError as unknown as typeof fetch)).toBeUndefined();
  });
});

describe('resolveConnectCatalogEntry', () => {
  it('passes other providers through untouched', async () => {
    const remote: Catalog = {
      openai: { id: 'openai', name: 'OpenAI', api: 'https://api.openai.com/v1' },
    };
    const entry = await resolveConnectCatalogEntry(remote, 'openai');
    expect(entry).toBe(remote['openai']);
  });

  it('resolves Command Code from the live listing when reachable', async () => {
    const fetchMock = vi.fn(async () =>
      jsonResponse({ data: [{ id: 'moonshotai/Kimi-K3', context_length: 1_000_000 }] }),
    );
    const entry = await resolveConnectCatalogEntry({}, COMMANDCODE_PROVIDER_ID, undefined, fetchMock as unknown as typeof fetch);
    expect(entry?.id).toBe(COMMANDCODE_PROVIDER_ID);
    expect(Object.keys(entry?.models ?? {})).toEqual(['moonshotai/Kimi-K3']);
  });

  it('falls back to the curated snapshot when the live listing is unavailable', async () => {
    const fetchMock = vi.fn(async () => {
      throw new Error('offline');
    });
    const entry = await resolveConnectCatalogEntry({}, COMMANDCODE_PROVIDER_ID, undefined, fetchMock as unknown as typeof fetch);
    expect(entry?.models).toBe(COMMANDCODE_CATALOG_ENTRY.models);
  });
});

describe('Command Code import', () => {
  it('writes one provider per wire with user-facing alias keys', () => {
    const models = catalogProviderModels(COMMANDCODE_CATALOG_ENTRY);
    const wireGroups = catalogWireGroups(COMMANDCODE_CATALOG_ENTRY, { wire: 'openai' });
    const config = { providers: {}, models: {} } as Parameters<typeof applyCatalogProvider>[0];

    applyCatalogProvider(config, {
      providerId: COMMANDCODE_PROVIDER_ID,
      wire: 'openai',
      baseUrl: COMMANDCODE_API_BASE,
      apiKey: 'YOUR_CMD_API_KEY',
      models,
      wireGroups,
      selectedModelId: '',
      thinking: false,
    });

    expect(config.providers[COMMANDCODE_PROVIDER_ID]).toMatchObject({
      type: 'openai',
      baseUrl: COMMANDCODE_API_BASE,
    });
    expect(config.providers[`${COMMANDCODE_PROVIDER_ID}-anthropic`]).toMatchObject({
      type: 'anthropic',
      baseUrl: 'https://api.commandcode.ai/provider',
    });
    // Alias keys never leak the protocol split.
    expect(config.models?.[`${COMMANDCODE_PROVIDER_ID}/claude-sonnet-5`]).toMatchObject({
      provider: `${COMMANDCODE_PROVIDER_ID}-anthropic`,
      model: 'claude-sonnet-5',
    });
    expect(config.models?.[`${COMMANDCODE_PROVIDER_ID}/deepseek/deepseek-v4-flash`]).toMatchObject({
      provider: COMMANDCODE_PROVIDER_ID,
      model: 'deepseek/deepseek-v4-flash',
      reasoningKey: 'reasoning_content',
    });
  });
});
