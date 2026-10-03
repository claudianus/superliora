import { describe, expect, it } from 'vitest';

import type { ModelAlias } from '@superliora/sdk';

import { deriveAlwaysThinking, deriveThinkingSupported } from '../src/model-catalog';

function alias(model: string, capabilities?: readonly string[]): ModelAlias {
  return {
    model,
    ...(capabilities !== undefined ? { capabilities } : {}),
  } as unknown as ModelAlias;
}

describe('deriveThinkingSupported', () => {
  it('treats a declared always_thinking capability as thinking-supported', () => {
    expect(deriveThinkingSupported(alias('custom-model', ['always_thinking']))).toBe(true);
  });

  it('uses declared thinking capability only', () => {
    expect(deriveThinkingSupported(alias('custom-model', ['thinking']))).toBe(true);
    expect(deriveThinkingSupported(alias('some-thinking-model'))).toBe(false);
    expect(deriveThinkingSupported(alias('reasoning-model'))).toBe(false);
    expect(deriveThinkingSupported(alias('kimi-k2.5'))).toBe(false);
    expect(deriveThinkingSupported(alias('kimi-for-coding'))).toBe(false);
    expect(deriveThinkingSupported(alias('kimi-code'))).toBe(false);
    expect(deriveThinkingSupported(alias('plain-model', []))).toBe(false);
  });
});

describe('deriveAlwaysThinking', () => {
  it('reads the declared always_thinking capability', () => {
    expect(deriveAlwaysThinking(alias('custom-model', ['thinking', 'always_thinking']))).toBe(true);
    expect(deriveAlwaysThinking(alias('custom-model', ['thinking']))).toBe(false);
  });

  it('does not infer always-thinking from the model name', () => {
    // Only an explicit capability may lock the toggle to on.
    expect(deriveAlwaysThinking(alias('some-thinking-model'))).toBe(false);
  });
});
