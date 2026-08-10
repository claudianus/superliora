import { describe, expect, it } from 'vitest';

import {
  isGenerateVideoAvailable,
  selectVideoGenerationProvider,
} from '../../src/tools/builtin/media/generate-video';

describe('GenerateVideo availability', () => {
  it('is available when QWEN_TOKEN_PLAN_API_KEY is set', () => {
    expect(isGenerateVideoAvailable({ qwenTokenPlanApiKey: 'sk-sp-test' })).toBe(true);
  });

  it('is available when GOOGLE_API_KEY or GEMINI_API_KEY is set', () => {
    expect(isGenerateVideoAvailable({ googleApiKey: 'google-test' })).toBe(true);
  });

  it('is not available without any key', () => {
    expect(isGenerateVideoAvailable({})).toBe(false);
  });

  it('falls back to auto when a forced provider is missing', () => {
    expect(
      selectVideoGenerationProvider('qwen', {
        xaiApiKey: 'xai-test',
        googleApiKey: 'google-test',
      }),
    ).toEqual({ provider: 'xai', fellBackFrom: 'qwen' });
    expect(selectVideoGenerationProvider('google', { xaiApiKey: 'xai-test' })).toEqual({
      provider: 'xai',
      fellBackFrom: 'google',
    });
  });

  it('skips env fallbacks for extras services switched off in Settings', () => {
    const ENV_KEYS = [
      'XAI_API_KEY',
      'QWEN_TOKEN_PLAN_API_KEY',
      'ALIBABA_TOKEN_PLAN_API_KEY',
      'GOOGLE_API_KEY',
      'GEMINI_API_KEY',
    ] as const;
    const prev = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));
    try {
      process.env['XAI_API_KEY'] = 'xai-env';
      process.env['QWEN_TOKEN_PLAN_API_KEY'] = 'sk-sp-env';
      delete process.env['ALIBABA_TOKEN_PLAN_API_KEY'];
      delete process.env['GOOGLE_API_KEY'];
      delete process.env['GEMINI_API_KEY'];

      expect(isGenerateVideoAvailable({})).toBe(true);
      // xai off → qwen env still serves.
      expect(isGenerateVideoAvailable({ extrasDisabled: ['xai-grok'] })).toBe(true);
      // Both extras off → env keys no longer count.
      expect(isGenerateVideoAvailable({ extrasDisabled: ['xai-grok', 'qwen-token-plan'] })).toBe(
        false,
      );
    } finally {
      for (const key of ENV_KEYS) {
        const value = prev[key];
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
      }
    }
  });
});
