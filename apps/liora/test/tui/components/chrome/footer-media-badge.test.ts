import { afterEach, describe, expect, it } from 'vitest';

import {
  formatMediaFooterBadge,
  mediaImageKeyReady,
  mediaVideoKeyReady,
} from '#/tui/components/chrome/footer';

const KEYS = ['OPENAI_API_KEY', 'GOOGLE_API_KEY', 'GEMINI_API_KEY'] as const;

describe('footer media readiness badges', () => {
  const prev: Record<string, string | undefined> = {};

  afterEach(() => {
    for (const key of KEYS) {
      if (prev[key] === undefined) delete process.env[key];
      else process.env[key] = prev[key];
    }
  });

  function clearKeys(): void {
    for (const key of KEYS) {
      prev[key] = process.env[key];
      delete process.env[key];
    }
  }

  it('reports img when only OpenAI key is present', () => {
    clearKeys();
    process.env['OPENAI_API_KEY'] = 'sk-test';
    expect(mediaImageKeyReady()).toBe(true);
    expect(mediaVideoKeyReady()).toBe(false);
    expect(formatMediaFooterBadge()?.label).toBe('img');
  });

  it('reports img·vid when image and video keys are present', () => {
    clearKeys();
    process.env['OPENAI_API_KEY'] = 'sk-test';
    process.env['GOOGLE_API_KEY'] = 'g-test';
    expect(formatMediaFooterBadge()?.label).toBe('img·vid');
  });

  it('returns null when no media keys exist', () => {
    clearKeys();
    expect(formatMediaFooterBadge()).toBeNull();
  });
});
