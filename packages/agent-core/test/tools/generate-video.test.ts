import { describe, expect, it } from 'vitest';

import { isGenerateVideoAvailable } from '../../src/tools/builtin/media/generate-video';

describe('GenerateVideo availability', () => {
  it('is available when GOOGLE_API_KEY or GEMINI_API_KEY is set', () => {
    expect(isGenerateVideoAvailable({ googleApiKey: 'google-test' })).toBe(true);
    expect(isGenerateVideoAvailable({})).toBe(false);
  });
});
