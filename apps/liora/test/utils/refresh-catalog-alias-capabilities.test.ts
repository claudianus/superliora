import type { Catalog, LioraConfig } from '@superliora/sdk';
import { catalogModelToAlias, catalogProviderModels } from '@superliora/sdk';
import { describe, expect, it } from 'vitest';

import {
  COMMANDCODE_PROVIDER_ID,
  mergeLocalCatalogProviders,
} from '#/utils/local-catalog-providers';
import { catalogAliasCapabilityPatch } from '#/utils/refresh-catalog-alias-capabilities';

const devCatalog: Catalog = {
  'nano-gpt': {
    id: 'nano-gpt',
    models: {
      'meta/muse-spark-1.3': {
        id: 'meta/muse-spark-1.3',
        reasoning: true,
        tool_call: true,
        reasoning_options: [{ type: 'effort', values: ['minimal', 'low', 'medium', 'high', 'xhigh'] }],
        modalities: { input: ['text', 'image'], output: ['text'] },
      },
    },
  },
};

const mergedCatalog = mergeLocalCatalogProviders(devCatalog);

function baseConfig(models: LioraConfig['models']): LioraConfig {
  return {
    providers: {
      [COMMANDCODE_PROVIDER_ID]: {
        type: 'openai',
        baseUrl: 'https://api.commandcode.ai/provider/v1',
        apiKey: 'YOUR_CMD_API_KEY',
      },
    },
    models,
  } as LioraConfig;
}

describe('catalogAliasCapabilityPatch', () => {
  it('upgrades stale alias capabilities from the enriched catalog', () => {
    const config = baseConfig({
      'commandcode/meta/muse-spark-1.3': {
        provider: COMMANDCODE_PROVIDER_ID,
        model: 'meta/muse-spark-1.3',
        maxContextSize: 1_048_576,
        capabilities: ['tool_use'],
      },
    });
    const patch = catalogAliasCapabilityPatch(config, mergedCatalog);
    const refreshed = patch?.models?.['commandcode/meta/muse-spark-1.3'];
    expect(refreshed?.capabilities).toContain('thinking');
    expect(refreshed?.capabilities).toContain('always_thinking');
    expect(refreshed?.supportEfforts).toEqual(['low', 'medium', 'high', 'xhigh']);
    expect(refreshed?.reasoningKey).toBe('reasoning_content');
    // Gateway pricing stays from the curated row.
    expect(refreshed?.cost).toMatchObject({ input: 1.25, output: 4.25 });
  });

  it('returns undefined when alias metadata already matches the catalog', () => {
    const model = catalogProviderModels(mergedCatalog[COMMANDCODE_PROVIDER_ID]!).find(
      (candidate) => candidate.id === 'meta/muse-spark-1.3',
    )!;
    const alias = catalogModelToAlias(COMMANDCODE_PROVIDER_ID, model);
    const config = baseConfig({
      'commandcode/meta/muse-spark-1.3': { ...alias, userManaged: false },
    });
    expect(catalogAliasCapabilityPatch(config, mergedCatalog)).toBeUndefined();
  });

  it('skips userManaged aliases', () => {
    const config = baseConfig({
      'commandcode/meta/muse-spark-1.3': {
        provider: COMMANDCODE_PROVIDER_ID,
        model: 'meta/muse-spark-1.3',
        maxContextSize: 1_048_576,
        capabilities: ['tool_use'],
        userManaged: true,
      },
    });
    expect(catalogAliasCapabilityPatch(config, mergedCatalog)).toBeUndefined();
  });

  it('skips OAuth-backed providers', () => {
    const config = {
      providers: {
        [COMMANDCODE_PROVIDER_ID]: {
          type: 'openai',
          baseUrl: 'https://api.commandcode.ai/provider/v1',
          oauth: { key: 'k', refresh: 'r' },
        },
      },
      models: {
        'commandcode/meta/muse-spark-1.3': {
          provider: COMMANDCODE_PROVIDER_ID,
          model: 'meta/muse-spark-1.3',
          maxContextSize: 1_048_576,
          capabilities: ['tool_use'],
        },
      },
    } as unknown as LioraConfig;
    expect(catalogAliasCapabilityPatch(config, mergedCatalog)).toBeUndefined();
  });
});
