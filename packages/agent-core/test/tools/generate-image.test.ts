import { describe, expect, it } from 'vitest';

import {
  isGenerateImageAvailable,
  resolveImageGenerationProvider,
} from '../../src/tools/builtin/media/generate-image';
import { XaiGrokBuildClient } from '../../src/tools/providers/xai-grok-build';

describe('GenerateImage provider selection', () => {
  it('prefers xAI Grok Build when client is present under auto', () => {
    const xaiGrokBuild = new XaiGrokBuildClient({
      apiKey: 'xai-test',
      fetchImpl: (async () => new Response()) as unknown as typeof fetch,
    });
    expect(
      resolveImageGenerationProvider('auto', {
        xaiGrokBuild,
        qwenTokenPlanApiKey: 'sk-sp-test',
        openaiApiKey: 'sk-test',
        googleApiKey: 'google-test',
      }),
    ).toBe('xai');
  });

  it('prefers Qwen Token Plan when xAI is absent under auto', () => {
    expect(
      resolveImageGenerationProvider('auto', {
        qwenTokenPlanApiKey: 'sk-sp-test',
        openaiApiKey: 'sk-test',
        googleApiKey: 'google-test',
      }),
    ).toBe('qwen');
  });

  it('falls back to OpenAI when Qwen key is absent', () => {
    expect(
      resolveImageGenerationProvider('auto', {
        openaiApiKey: 'sk-test',
        googleApiKey: 'google-test',
      }),
    ).toBe('openai');
  });

  it('prefers Codex over platform keys when a ChatGPT session is present', () => {
    const codex = {
      tokenProvider: { getAccessToken: async () => 'codex-token' },
      baseUrl: 'https://chatgpt.com/backend-api/codex',
      model: 'gpt-5.1-codex',
    };
    expect(
      resolveImageGenerationProvider('auto', {
        codex,
        openaiApiKey: 'sk-test',
        googleApiKey: 'google-test',
      }),
    ).toBe('codex');
    expect(resolveImageGenerationProvider('auto', { codex, qwenTokenPlanApiKey: 'sk-sp-x' })).toBe(
      'qwen',
    );
    expect(resolveImageGenerationProvider('codex', { codex })).toBe('codex');
    expect(
      resolveImageGenerationProvider('codex', { openaiApiKey: 'sk-test' }),
    ).toBeUndefined();
  });

  it('honors forced provider only when that key exists', () => {
    expect(
      resolveImageGenerationProvider('google', {
        openaiApiKey: 'sk-test',
        googleApiKey: 'google-test',
      }),
    ).toBe('google');
    expect(
      resolveImageGenerationProvider('openai', {
        googleApiKey: 'google-test',
      }),
    ).toBeUndefined();
    expect(
      resolveImageGenerationProvider('qwen', {
        qwenTokenPlanApiKey: 'sk-sp-test',
      }),
    ).toBe('qwen');
    expect(
      resolveImageGenerationProvider('qwen', {
        openaiApiKey: 'sk-test',
      }),
    ).toBeUndefined();
    expect(
      resolveImageGenerationProvider('xai', {
        xaiApiKey: 'xai-test',
      }),
    ).toBe('xai');
  });

  it('reports availability from any key', () => {
    expect(isGenerateImageAvailable({ qwenTokenPlanApiKey: 'sk-sp-test' })).toBe(true);
    expect(isGenerateImageAvailable({ openaiApiKey: 'sk-test' })).toBe(true);
    expect(isGenerateImageAvailable({ googleApiKey: 'google-test' })).toBe(true);
    expect(isGenerateImageAvailable({ xaiApiKey: 'xai-test' })).toBe(true);
    const prev = {
      XAI_API_KEY: process.env['XAI_API_KEY'],
      OPENAI_API_KEY: process.env['OPENAI_API_KEY'],
      GOOGLE_API_KEY: process.env['GOOGLE_API_KEY'],
      GEMINI_API_KEY: process.env['GEMINI_API_KEY'],
      QWEN_TOKEN_PLAN_API_KEY: process.env['QWEN_TOKEN_PLAN_API_KEY'],
      ALIBABA_TOKEN_PLAN_API_KEY: process.env['ALIBABA_TOKEN_PLAN_API_KEY'],
    };
    try {
      delete process.env['XAI_API_KEY'];
      delete process.env['OPENAI_API_KEY'];
      delete process.env['GOOGLE_API_KEY'];
      delete process.env['GEMINI_API_KEY'];
      delete process.env['QWEN_TOKEN_PLAN_API_KEY'];
      delete process.env['ALIBABA_TOKEN_PLAN_API_KEY'];
      expect(isGenerateImageAvailable({})).toBe(false);
    } finally {
      for (const [key, value] of Object.entries(prev)) {
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
      }
    }
  });

  it('skips env fallbacks for extras services switched off in Settings', () => {
    const ENV_KEYS = [
      'XAI_API_KEY',
      'QWEN_TOKEN_PLAN_API_KEY',
      'ALIBABA_TOKEN_PLAN_API_KEY',
      'OPENAI_API_KEY',
      'GOOGLE_API_KEY',
      'GEMINI_API_KEY',
    ] as const;
    const prev = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));
    try {
      process.env['XAI_API_KEY'] = 'xai-env';
      process.env['QWEN_TOKEN_PLAN_API_KEY'] = 'sk-sp-env';
      delete process.env['ALIBABA_TOKEN_PLAN_API_KEY'];
      delete process.env['OPENAI_API_KEY'];
      delete process.env['GOOGLE_API_KEY'];
      delete process.env['GEMINI_API_KEY'];

      // Disabled xai-grok: its env key no longer makes xai ready.
      expect(resolveImageGenerationProvider('auto', { extrasDisabled: ['xai-grok'] })).toBe('qwen');
      expect(
        resolveImageGenerationProvider('xai', { extrasDisabled: ['xai-grok'] }),
      ).toBeUndefined();
      // Both off: nothing left from env keys.
      expect(
        resolveImageGenerationProvider('auto', {
          extrasDisabled: ['xai-grok', 'qwen-token-plan'],
        }),
      ).toBeUndefined();
      // Enabled: env keys flow as before.
      expect(resolveImageGenerationProvider('auto', {})).toBe('xai');
    } finally {
      for (const key of ENV_KEYS) {
        const value = prev[key];
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
      }
    }
  });
});
