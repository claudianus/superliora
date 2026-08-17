import { describe, expect, it } from 'vitest';

import type { Catalog } from '@superliora/sdk';

import {
  applyQwenTokenPlanProvider,
  ALIBABA_TOKEN_PLAN_CATALOG_ID,
  ALIBABA_TOKEN_PLAN_CN_CATALOG_ID,
  ALIBABA_TOKEN_PLAN_ENV_KEY,
  detectQwenTokenPlanKey,
  getQwenHarnessToolsForModel,
  isQwenTokenPlanAvailable,
  isQwenTokenPlanBaseUrl,
  isTokenPlanCatalogId,
  isTokenPlanProviderId,
  QWEN_TOKEN_PLAN_BASE_URL,
  QWEN_TOKEN_PLAN_CN_BASE_URL,
  QWEN_TOKEN_PLAN_IMAGE_MODELS,
  QWEN_TOKEN_PLAN_PROVIDER_ID,
  QWEN_TOKEN_PLAN_TEXT_MODELS,
  tokenPlanTextModelsFromCatalog,
  validateQwenTokenPlanKeyFormat,
} from '#/tui/utils/model/qwen-token-plan';

describe('Qwen Token Plan utilities', () => {
  describe('validateQwenTokenPlanKeyFormat', () => {
    it('accepts sk-sp- prefixed keys', () => {
      expect(validateQwenTokenPlanKeyFormat('sk-sp-abc123')).toBeUndefined();
    });

    it('warns for non-sk-sp- keys', () => {
      const warning = validateQwenTokenPlanKeyFormat('sk-regular-key');
      expect(warning).toContain('sk-sp-');
    });
  });

  describe('detectQwenTokenPlanKey', () => {
    it('returns undefined when no key is available', () => {
      expect(detectQwenTokenPlanKey(undefined)).toBeUndefined();
    });

    it('detects key from config provider', () => {
      const config = {
        providers: {
          [QWEN_TOKEN_PLAN_PROVIDER_ID]: {
            type: 'openai' as const,
            apiKey: 'sk-sp-from-config',
          },
        },
      };
      expect(detectQwenTokenPlanKey(config as never)).toBe('sk-sp-from-config');
    });
  });

  describe('isQwenTokenPlanAvailable', () => {
    it('returns false without key', () => {
      expect(isQwenTokenPlanAvailable(undefined)).toBe(false);
    });

    it('returns true with config key', () => {
      const config = {
        providers: {
          [QWEN_TOKEN_PLAN_PROVIDER_ID]: {
            type: 'openai' as const,
            apiKey: 'sk-sp-test',
          },
        },
      };
      expect(isQwenTokenPlanAvailable(config as never)).toBe(true);
    });
  });

  describe('applyQwenTokenPlanProvider', () => {
    it('registers provider and models', () => {
      const config = { providers: {}, models: {} } as never;
      const result = applyQwenTokenPlanProvider(config, 'sk-sp-test');

      expect(result.providerId).toBe(QWEN_TOKEN_PLAN_PROVIDER_ID);
      expect(result.modelCount).toBe(QWEN_TOKEN_PLAN_TEXT_MODELS.length);
      expect(result.defaultModel).toContain(QWEN_TOKEN_PLAN_PROVIDER_ID);

      const typedConfig = config as {
        providers: Record<string, unknown>;
        models: Record<string, { provider: string; capabilities?: string[] }>;
        defaultModel: string;
        defaultThinking: boolean;
      };
      expect(typedConfig.providers[QWEN_TOKEN_PLAN_PROVIDER_ID]).toBeDefined();
      expect(typedConfig.defaultThinking).toBe(true);

      // Check that image_in capability is set for vision models.
      const maxKey = `${QWEN_TOKEN_PLAN_PROVIDER_ID}/qwen3.8-max`;
      expect(typedConfig.models[maxKey]?.capabilities).toContain('image_in');
      expect(typedConfig.defaultModel).toBe(maxKey);
    });
  });

  describe('getQwenHarnessToolsForModel', () => {
    it('returns all tools for qwen3.8-max', () => {
      const tools = getQwenHarnessToolsForModel('qwen3.8-max');
      expect(tools).toContain('web_search');
      expect(tools).toContain('code_interpreter');
      expect(tools).toContain('web_extractor');
      expect(tools).toContain('i2i_search');
      expect(tools).toContain('t2i_search');
    });

    it('returns core tools for qwen3.7-max', () => {
      const tools = getQwenHarnessToolsForModel('qwen3.7-max');
      expect(tools).toContain('web_search');
      expect(tools).toContain('web_extractor');
      expect(tools).not.toContain('i2i_search');
    });

    it('returns no tools for non-harness models', () => {
      expect(getQwenHarnessToolsForModel('qwen3.6-flash')).toEqual([]);
      expect(getQwenHarnessToolsForModel('glm-5.2')).toEqual([]);
    });

    it('returns empty for unknown model', () => {
      expect(getQwenHarnessToolsForModel('unknown-model')).toEqual([]);
    });
  });

  describe('model catalogs', () => {
    it('lists every Personal plan text model', () => {
      expect(QWEN_TOKEN_PLAN_TEXT_MODELS.map((m) => m.id)).toEqual([
        'qwen3.8-max',
        'qwen3.8-max-preview',
        'qwen3.7-max',
        'qwen3.7-plus',
        'qwen3.6-flash',
        'glm-5.2',
        'deepseek-v4-pro',
        'deepseek-v4-flash-0731',
      ]);
    });

    it('lists Personal plan image models', () => {
      expect([...QWEN_TOKEN_PLAN_IMAGE_MODELS]).toEqual([
        'wan2.7-image',
        'wan2.7-image-pro',
      ]);
    });
  });

  describe('isQwenTokenPlanBaseUrl', () => {
    it('detects Token Plan base URL', () => {
      expect(isQwenTokenPlanBaseUrl(QWEN_TOKEN_PLAN_BASE_URL)).toBe(true);
      expect(isQwenTokenPlanBaseUrl('https://token-plan.ap-southeast-1.maas.aliyuncs.com/compatible-mode/v1')).toBe(true);
    });

    it('rejects non-Token Plan URLs', () => {
      expect(isQwenTokenPlanBaseUrl('https://api.openai.com/v1')).toBe(false);
      expect(isQwenTokenPlanBaseUrl(undefined)).toBe(false);
    });
  });

  describe('alibaba-token-plan identity unification', () => {
    it('treats canonical and models.dev ids as one service', () => {
      expect(isTokenPlanProviderId(QWEN_TOKEN_PLAN_PROVIDER_ID)).toBe(true);
      expect(isTokenPlanProviderId(ALIBABA_TOKEN_PLAN_CATALOG_ID)).toBe(true);
      expect(isTokenPlanProviderId(ALIBABA_TOKEN_PLAN_CN_CATALOG_ID)).toBe(true);
      expect(isTokenPlanProviderId('anthropic')).toBe(false);
      expect(isTokenPlanCatalogId(ALIBABA_TOKEN_PLAN_CATALOG_ID)).toBe(true);
      expect(isTokenPlanCatalogId(ALIBABA_TOKEN_PLAN_CN_CATALOG_ID)).toBe(true);
      // The canonical config id is not a models.dev catalog id.
      expect(isTokenPlanCatalogId(QWEN_TOKEN_PLAN_PROVIDER_ID)).toBe(false);
    });

    it('detects keys stored under the alibaba-token-plan provider ids', () => {
      for (const providerId of [ALIBABA_TOKEN_PLAN_CATALOG_ID, ALIBABA_TOKEN_PLAN_CN_CATALOG_ID]) {
        const config = {
          providers: { [providerId]: { type: 'openai' as const, apiKey: 'sk-sp-x' } },
        };
        expect(detectQwenTokenPlanKey(config as never)).toBe('sk-sp-x');
      }
    });

    it('detects the ALIBABA_TOKEN_PLAN_API_KEY env var', () => {
      const prev = process.env[ALIBABA_TOKEN_PLAN_ENV_KEY];
      try {
        process.env[ALIBABA_TOKEN_PLAN_ENV_KEY] = 'sk-sp-env-alibaba';
        expect(detectQwenTokenPlanKey(undefined)).toBe('sk-sp-env-alibaba');
      } finally {
        if (prev === undefined) delete process.env[ALIBABA_TOKEN_PLAN_ENV_KEY];
        else process.env[ALIBABA_TOKEN_PLAN_ENV_KEY] = prev;
      }
    });

    it('recognizes the China region endpoint as Token Plan', () => {
      expect(QWEN_TOKEN_PLAN_CN_BASE_URL).toContain('cn-beijing');
      expect(isQwenTokenPlanBaseUrl(QWEN_TOKEN_PLAN_CN_BASE_URL)).toBe(true);
    });
  });

  describe('tokenPlanTextModelsFromCatalog', () => {
    function makeCatalog(): Catalog {
      return {
        [ALIBABA_TOKEN_PLAN_CATALOG_ID]: {
          id: ALIBABA_TOKEN_PLAN_CATALOG_ID,
          name: 'Alibaba Token Plan',
          models: {
            'qwen3.8-max': {
              id: 'qwen3.8-max',
              name: 'Qwen 3.8 Max',
              reasoning: true,
              tool_call: true,
              limit: { context: 1_000_000, output: 131_072 },
              modalities: { input: ['text', 'image'], output: ['text'] },
            },
            'glm-5.2': {
              id: 'glm-5.2',
              reasoning: true,
              limit: { context: 200_000 },
            },
            'wan2.7-image': {
              id: 'wan2.7-image',
              name: 'Wan 2.7 Image',
              limit: { context: 8_000 },
              modalities: { output: ['image'] },
            },
            'text-embedding-v4': {
              id: 'text-embedding-v4',
              limit: { context: 8_192 },
            },
          },
        },
      } as never;
    }

    it('extracts text-output chat models with derived capabilities', () => {
      const models = tokenPlanTextModelsFromCatalog(makeCatalog());
      expect(models).toBeDefined();
      const ids = models!.map((m) => m.id);
      expect(ids).toContain('qwen3.8-max');
      expect(ids).toContain('glm-5.2');
      // Image-output and embedding models stay out of chat aliases.
      expect(ids).not.toContain('wan2.7-image');
      expect(ids).not.toContain('text-embedding-v4');

      const flagship = models!.find((m) => m.id === 'qwen3.8-max');
      expect(flagship?.capabilities).toContain('thinking');
      expect(flagship?.capabilities).toContain('tool_use');
      expect(flagship?.capabilities).toContain('image_in');
      expect(flagship?.maxOutputSize).toBe(131_072);
      // qwen3.8 models get every server-side harness tool.
      expect(flagship?.harnessTools).toContain('web_search');
      expect(flagship?.harnessTools).toContain('code_interpreter');
      expect(flagship?.harnessTools).toContain('t2i_search');

      const glm = models!.find((m) => m.id === 'glm-5.2');
      expect(glm?.harnessTools).toEqual([]);
    });

    it('returns undefined when the entry is missing or yields nothing', () => {
      expect(tokenPlanTextModelsFromCatalog({} as never)).toBeUndefined();
      const mediaOnly = {
        [ALIBABA_TOKEN_PLAN_CATALOG_ID]: {
          id: ALIBABA_TOKEN_PLAN_CATALOG_ID,
          models: {
            'wan2.7-image': {
              id: 'wan2.7-image',
              limit: { context: 8_000 },
              modalities: { output: ['image'] },
            },
          },
        },
      } as never;
      expect(tokenPlanTextModelsFromCatalog(mediaOnly)).toBeUndefined();
    });
  });

  describe('applyQwenTokenPlanProvider with live catalog models', () => {
    it('reports modelSource and applies the regional base URL', () => {
      const config = { providers: {}, models: {} } as never;
      const result = applyQwenTokenPlanProvider(config, 'sk-sp-test', {
        models: [
          {
            id: 'qwen3.8-max',
            displayName: 'Qwen 3.8 Max',
            maxContextSize: 1_000_000,
            capabilities: ['thinking', 'tool_use'],
            harnessTools: [],
          },
        ],
        baseUrl: QWEN_TOKEN_PLAN_CN_BASE_URL,
      });
      expect(result.modelSource).toBe('catalog');
      expect(result.modelCount).toBe(1);
      expect(result.defaultModel).toBe(`${QWEN_TOKEN_PLAN_PROVIDER_ID}/qwen3.8-max`);
      const typed = config as { providers: Record<string, { baseUrl?: string }> };
      expect(typed.providers[QWEN_TOKEN_PLAN_PROVIDER_ID]?.baseUrl).toBe(QWEN_TOKEN_PLAN_CN_BASE_URL);
    });

    it('caps a live Flash window at the 256k Plus band', () => {
      const config = { providers: {}, models: {} } as never;
      applyQwenTokenPlanProvider(config, 'sk-sp-test', {
        models: [
          {
            id: 'qwen3.6-flash',
            displayName: 'Qwen 3.6 Flash',
            maxContextSize: 1_000_000,
            capabilities: ['thinking', 'tool_use'],
            harnessTools: [],
          },
        ],
      });
      const typed = config as {
        models: Record<string, { maxContextSize?: number }>;
      };
      expect(typed.models[`${QWEN_TOKEN_PLAN_PROVIDER_ID}/qwen3.6-flash`]?.maxContextSize).toBe(
        256_000,
      );
    });

    it('reports preset source when no live models are passed', () => {
      const config = { providers: {}, models: {} } as never;
      const result = applyQwenTokenPlanProvider(config, 'sk-sp-test');
      expect(result.modelSource).toBe('preset');
    });
  });
});
