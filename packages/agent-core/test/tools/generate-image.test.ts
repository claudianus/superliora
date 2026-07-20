import { describe, expect, it } from 'vitest';

import {
  isGenerateImageAvailable,
  resolveImageGenerationProvider,
} from '../../src/tools/builtin/media/generate-image';

describe('GenerateImage provider selection', () => {
  it('prefers Qwen Token Plan when key exists under auto', () => {
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
  });

  it('reports availability from any key', () => {
    expect(isGenerateImageAvailable({ qwenTokenPlanApiKey: 'sk-sp-test' })).toBe(true);
    expect(isGenerateImageAvailable({ openaiApiKey: 'sk-test' })).toBe(true);
    expect(isGenerateImageAvailable({ googleApiKey: 'google-test' })).toBe(true);
    expect(isGenerateImageAvailable({})).toBe(false);
  });
});
