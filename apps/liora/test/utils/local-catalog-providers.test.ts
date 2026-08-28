import {
  catalogProviderModels,
  inferWireType,
  type Catalog,
} from '@superliora/sdk';
import { describe, expect, it } from 'vitest';

import {
  CLINEPASS_API_BASE,
  CLINEPASS_API_KEY_ENV,
  CLINEPASS_CATALOG_ENTRY,
  CLINEPASS_PROVIDER_ID,
  detectedConnectEnvHints,
  mergeLocalCatalogProviders,
  OPENCODE_ZEN_API_BASE,
  OPENCODE_ZEN_CATALOG_ENTRY,
  OPENCODE_ZEN_PROVIDER_ID,
  ZAI_CODING_PLAN_API_BASE,
  ZAI_CODING_PLAN_CATALOG_ENTRY,
  ZAI_CODING_PLAN_PROVIDER_ID,
} from '#/utils/local-catalog-providers';

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
