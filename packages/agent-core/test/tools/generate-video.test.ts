import { describe, expect, it } from 'vitest';

import { isGenerateVideoAvailable } from '../../src/tools/builtin/media/generate-video';

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
});
