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
  mergeLocalCatalogProviders,
} from '#/utils/local-catalog-providers';

describe('local catalog providers', () => {
  it('declares ClinePass as an OpenAI-compatible catalog entry', () => {
    expect(CLINEPASS_CATALOG_ENTRY.id).toBe(CLINEPASS_PROVIDER_ID);
    expect(CLINEPASS_CATALOG_ENTRY.api).toBe(CLINEPASS_API_BASE);
    expect(CLINEPASS_CATALOG_ENTRY.env).toEqual([CLINEPASS_API_KEY_ENV]);
    expect(inferWireType(CLINEPASS_CATALOG_ENTRY)).toBe('openai');
  });

  it('lists curated ClinePass models with positive context windows', () => {
    const models = catalogProviderModels(CLINEPASS_CATALOG_ENTRY);
    expect(models.length).toBeGreaterThanOrEqual(10);
    expect(models.every((m) => m.id.startsWith('cline-pass/'))).toBe(true);
    expect(models.every((m) => m.capability.max_context_tokens > 0)).toBe(true);
    expect(models.every((m) => m.capability.tool_use)).toBe(true);
    expect(models.some((m) => m.id === 'cline-pass/glm-5.2')).toBe(true);
    expect(models.some((m) => m.id === 'cline-pass/deepseek-v4-flash')).toBe(true);
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
  });

  it('lets SuperLiora-curated entries override a same-id remote entry', () => {
    const remote: Catalog = {
      clinepass: {
        id: 'clinepass',
        name: 'Stale ClinePass',
        api: 'https://example.test/v1',
      },
    };
    const merged = mergeLocalCatalogProviders(remote);
    expect(merged.clinepass?.name).toBe('ClinePass');
    expect(merged.clinepass?.api).toBe(CLINEPASS_API_BASE);
  });
});
