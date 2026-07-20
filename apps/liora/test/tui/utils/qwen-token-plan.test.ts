import { describe, expect, it } from 'vitest';

import {
  applyQwenTokenPlanProvider,
  detectQwenTokenPlanKey,
  getQwenHarnessToolsForModel,
  isQwenTokenPlanAvailable,
  isQwenTokenPlanBaseUrl,
  QWEN_TOKEN_PLAN_BASE_URL,
  QWEN_TOKEN_PLAN_PROVIDER_ID,
  QWEN_TOKEN_PLAN_TEXT_MODELS,
  validateQwenTokenPlanKeyFormat,
} from '#/tui/utils/qwen-token-plan';

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
      const maxPreviewKey = `${QWEN_TOKEN_PLAN_PROVIDER_ID}/qwen3.8-max-preview`;
      expect(typedConfig.models[maxPreviewKey]?.capabilities).toContain('image_in');
    });
  });

  describe('getQwenHarnessToolsForModel', () => {
    it('returns all tools for qwen3.8-max-preview', () => {
      const tools = getQwenHarnessToolsForModel('qwen3.8-max-preview');
      expect(tools).toContain('web_search');
      expect(tools).toContain('code_interpreter');
      expect(tools).toContain('reverse_image_search');
    });

    it('returns core tools for qwen3.7-max', () => {
      const tools = getQwenHarnessToolsForModel('qwen3.7-max');
      expect(tools).toContain('web_search');
      expect(tools).not.toContain('reverse_image_search');
    });

    it('returns empty for unknown model', () => {
      expect(getQwenHarnessToolsForModel('unknown-model')).toEqual([]);
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
});
