import { describe, expect, it } from 'vitest';

import { detectInstallLocale, isKoreanTag } from '../../../../scripts/install/locale.mjs';
import { t } from '../../../../scripts/install/strings.mjs';
import { formatHostSetupPlan, planHostSetup } from '../../../../scripts/install/host-setup.mjs';

describe('scripts/install locale', () => {
  it('treats empty env as English and does not consult Intl', () => {
    expect(detectInstallLocale({}, { intl: false })).toBe('en');
    expect(detectInstallLocale({})).toBe('en');
  });

  it('selects Korean from SUPERLIORA_LOCALE and LANG', () => {
    expect(detectInstallLocale({ SUPERLIORA_LOCALE: 'ko', LANG: 'en_US.UTF-8' })).toBe('ko');
    expect(detectInstallLocale({ LANG: 'ko_KR.UTF-8' })).toBe('ko');
    expect(detectInstallLocale({ LANG: 'en_US.UTF-8' })).toBe('en');
    expect(isKoreanTag('ko-KR')).toBe(true);
    expect(isKoreanTag('C')).toBe(false);
    expect(detectInstallLocale({ LANG: 'C.UTF-8' }, { osLocale: 'ko-KR' })).toBe('en');
    expect(detectInstallLocale(
      { LANG: 'en_US.UTF-8', MSYSTEM: 'MINGW64' },
      { platform: 'win32', osLocale: 'ko-KR' },
    )).toBe('ko');
    expect(detectInstallLocale(
      {},
      { platform: 'darwin', osLocale: 'ko-KR', intl: true },
    )).toBe('ko');
  });

  it('renders installer copy in both locales', () => {
    expect(t('install.title', undefined, 'en')).toBe('Installing SuperLiora');
    expect(t('install.title', undefined, 'ko')).toBe('SuperLiora 설치 중');
    expect(t('install.summary.desktop', undefined, 'ko')).toContain('바탕화면');
    expect(t('install.nodeInstalled', { version: '24.15.0' }, 'ko')).toContain('24.15.0');
  });

  it('localizes the host-setup plan chrome', () => {
    const en = planHostSetup({
      platform: 'linux',
      locale: 'en',
      env: { HOME: '/home/dev' },
      isFile: () => false,
      which: () => undefined,
      readText: () => '',
    });
    expect(formatHostSetupPlan(en)).toContain('Host setup');
    expect(formatHostSetupPlan(en)).toContain('Install');

    const ko = planHostSetup({
      platform: 'linux',
      locale: 'ko',
      env: { HOME: '/home/dev' },
      isFile: () => false,
      which: () => undefined,
      readText: () => '',
    });
    const text = formatHostSetupPlan(ko);
    expect(text).toContain('호스트 설정');
    expect(text).toContain('설치');
    expect(ko.items.some((item: { title: string }) => item.title.includes('바탕화면'))).toBe(true);
  });
});
