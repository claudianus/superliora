import { describe, expect, it } from 'vitest';

import {
  isGenerateImageAvailable,
  resolveImageGenerationProvider,
} from '../../src/tools/builtin/media/generate-image';

describe('GenerateImage provider selection', () => {
  it('prefers OpenAI when both keys exist under auto', () => {
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
  });

  it('reports availability from either key', () => {
    expect(isGenerateImageAvailable({ openaiApiKey: 'sk-test' })).toBe(true);
    expect(isGenerateImageAvailable({ googleApiKey: 'google-test' })).toBe(true);
    expect(isGenerateImageAvailable({})).toBe(false);
  });
});
