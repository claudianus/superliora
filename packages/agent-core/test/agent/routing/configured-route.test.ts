import { describe, expect, it, vi } from 'vitest';
import { resolveConfiguredSessionRoute } from '../../../src/agent/routing';
import type { LioraConfig } from '../../../src/config';

const config: LioraConfig = {
  providers: { native: { type: 'openai', apiKey: 'key', defaultModel: 'wire' } },
  defaultProvider: 'native',
  defaultModel: 'chosen',
  models: {
    chosen: { provider: 'native', model: 'wire', maxContextSize: 32768, fallbackModels: ['fallback'] },
    fallback: { provider: 'native', model: 'other', maxContextSize: 16384 },
    unchosen: { provider: 'native', model: 'unselected', maxContextSize: 1000000 },
  },
};

describe('configured session routes', () => {
  it('uses the configured alias and only explicit fallbacks without network side effects', () => {
    const fetch = vi.spyOn(globalThis, 'fetch');
    try {
      expect(resolveConfiguredSessionRoute({ config })).toEqual({
        alias: 'chosen', chain: ['chosen', 'fallback'], source: 'configured',
      });
      expect(fetch).not.toHaveBeenCalled();
    } finally { fetch.mockRestore(); }
  });

  it('honors an explicit operator alias rather than role or context scoring', () => {
    expect(resolveConfiguredSessionRoute({ config, alias: 'fallback' }).alias).toBe('fallback');
  });

  it('resolves auto only from the configured provider default', () => {
    expect(resolveConfiguredSessionRoute({ config: { ...config, defaultModel: 'auto' } }).alias).toBe('chosen');
    expect(() => resolveConfiguredSessionRoute({ config: {
      ...config, defaultModel: 'auto', providers: { native: { type: 'openai', apiKey: 'key' } },
    } })).toThrow(/Select a configured model/);
  });

  it('keeps a real configured alias named auto', () => {
    const auto = { provider: 'native', model: 'auto', maxContextSize: 32768 };
    expect(resolveConfiguredSessionRoute({ config: {
      ...config, defaultModel: 'auto', models: { ...config.models, auto },
    } }).alias).toBe('auto');
  });

  it('requires explicit selection when no configured default is available', () => {
    expect(() => resolveConfiguredSessionRoute({ config: { providers: {} } })).toThrow(/Select a configured model/);
    expect(() => resolveConfiguredSessionRoute({ config, alias: 'missing' })).toThrow(/Select a configured model/);
  });

  it('validates configured fallback aliases and respects alias metadata overrides', () => {
    expect(() => resolveConfiguredSessionRoute({ config: {
      ...config, models: { chosen: {
        ...config.models!.chosen!, fallbackModels: ['missing'],
      } },
    } })).toThrow(/fallback model alias/);
    expect(resolveConfiguredSessionRoute({ config: {
      ...config, models: { ...config.models, chosen: {
        ...config.models!.chosen!, overrides: { fallbackModels: [] },
      } },
    } }).chain).toEqual(['chosen']);
  });
});
