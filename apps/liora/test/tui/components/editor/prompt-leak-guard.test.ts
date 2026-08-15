import { describe, expect, it } from 'vitest';

import { looksLikePromptLeak } from '#/tui/utils/editor/prompt-leak-guard';

describe('looksLikePromptLeak', () => {
  it('rejects compileUnsafe, dist-native intermediates, and stack traces', () => {
    expect(looksLikePromptLeak('compileUnsafe failed while linking')).toBe(true);
    expect(
      looksLikePromptLeak('thrown from dist-native/intermediates/main.cjs:12'),
    ).toBe(true);
    expect(
      looksLikePromptLeak(
        'TypeError: boom\n    at foo (app.ts:1:1)\n    at bar (app.ts:2:2)',
      ),
    ).toBe(true);
    expect(
      looksLikePromptLeak('    at Module._load (node:internal/modules/cjs/loader:1:1)'),
    ).toBe(true);
  });

  it('keeps ordinary drafts', () => {
    expect(looksLikePromptLeak('please restore this draft')).toBe(false);
    expect(looksLikePromptLeak('/goal ship the prompt guard')).toBe(false);
    expect(looksLikePromptLeak('')).toBe(false);
  });
});
