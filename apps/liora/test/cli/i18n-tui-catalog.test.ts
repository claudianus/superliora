import { describe, it, expect, afterEach } from 'vitest';

import { resolveCliLocale, setCliLocale, detectCliLocale } from '#/cli/i18n';
import { STRINGS_TUI_EN, STRINGS_TUI_KO } from '#/cli/i18n/strings-tui';

afterEach(() => {
  setCliLocale('en');
});

describe('STRINGS_TUI_EN/KO parity', () => {
  it('has identical key sets', () => {
    const enKeys = Object.keys(STRINGS_TUI_EN).sort();
    const koKeys = Object.keys(STRINGS_TUI_KO).sort();
    expect(koKeys).toEqual(enKeys);
  });

  it('keeps English catalog free of Hangul except language-name labels', () => {
    const hangul = /[\uAC00-\uD7A3]/;
    const allow = new Set(['tui.locale.option.ko']);
    const polluted = Object.entries(STRINGS_TUI_EN)
      .filter(([key, value]) => !allow.has(key) && hangul.test(value))
      .map(([key]) => key);
    expect(polluted).toEqual([]);
  });
});

describe('resolveCliLocale', () => {
  it('honors fixed en/ko preferences', () => {
    expect(resolveCliLocale({ preference: 'en', env: { LANG: 'ko_KR.UTF-8' } })).toBe('en');
    expect(resolveCliLocale({ preference: 'ko', env: { LANG: 'en_US.UTF-8' } })).toBe('ko');
  });

  it('uses detectCliLocale for auto', () => {
    expect(resolveCliLocale({ preference: 'auto', env: { SUPERLIORA_LOCALE: 'ko' } })).toBe('ko');
    expect(resolveCliLocale({ preference: 'auto', env: { LANG: 'en_US.UTF-8' } })).toBe('en');
  });

  it('defaults preference to auto', () => {
    expect(resolveCliLocale({ env: { SUPERLIORA_LOCALE: 'ko' } })).toBe('ko');
  });

  it('SUPERLIORA_LOCALE wins in detectCliLocale', () => {
    expect(detectCliLocale({ SUPERLIORA_LOCALE: 'en', LANG: 'ko_KR.UTF-8' })).toBe('en');
  });
});
