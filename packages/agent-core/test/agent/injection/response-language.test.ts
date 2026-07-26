import { describe, expect, it } from 'vitest';

import type { Agent } from '#/agent';
import {
  ResponseLanguageInjector,
  buildResponseLanguageDirective,
} from '#/agent/injection/response-language';
import type { ResponseLanguagePreference } from '#/session/response-language';

const pref: ResponseLanguagePreference = {
  code: 'ko',
  label: 'Korean',
  source: 'user',
  updatedAt: 1,
};

describe('agent/injection/response-language — buildResponseLanguageDirective', () => {
  it('wraps by default in <response_language> tags', () => {
    const result = buildResponseLanguageDirective(pref);
    expect(result).toContain('<response_language>');
    expect(result).toContain('</response_language>');
  });

  it('omits the wrapper when { wrapped: false }', () => {
    const result = buildResponseLanguageDirective(pref, { wrapped: false });
    expect(result).not.toContain('<response_language>');
    expect(result).toContain('MANDATORY response language LOCKED: Korean (ko)');
  });

  it('includes the preference code, label, and lock phrases', () => {
    const result = buildResponseLanguageDirective(pref);
    expect(result).toContain('Korean (ko)');
    expect(result).toContain('Do NOT drift');
    expect(result).toContain('original language');
  });
});

describe('agent/injection/response-language — getInjection', () => {
  it('returns undefined when preference is undefined', () => {
    const injector = new ResponseLanguageInjector({
      context: { history: [] },
      getResponseLanguagePreference: () => undefined,
    } as unknown as Agent);
    expect(injector.getInjection()).toBeUndefined();
  });

  it('emits the directive on first call', () => {
    const injector = new ResponseLanguageInjector({
      context: { history: [] },
      getResponseLanguagePreference: () => pref,
    } as unknown as Agent);
    const result = injector.getInjection();
    expect(result).toContain('<response_language>');
    expect(result).toContain('Korean (ko)');
  });

  it('re-emits when the preference key changes', () => {
    let current: ResponseLanguagePreference = pref;
    const injector = new ResponseLanguageInjector({
      context: { history: [] },
      getResponseLanguagePreference: () => current,
    } as unknown as Agent);
    expect(injector.getInjection()).toBeDefined();
    current = { ...pref, updatedAt: 2 };
    expect(injector.getInjection()).toBeDefined();
  });

  it('onContextClear resets the cached key', () => {
    const injector = new ResponseLanguageInjector({
      context: { history: [] },
      getResponseLanguagePreference: () => pref,
    } as unknown as Agent);
    expect(injector.getInjection()).toBeDefined();
    injector.onContextClear();
    expect(injector.getInjection()).toBeDefined();
  });
});
