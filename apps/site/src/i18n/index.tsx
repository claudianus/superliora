import { createContext, useContext, useMemo, type ReactNode } from 'react';
import { defaultLang, translations, type Lang, type Translation } from './translations';

export interface I18nContextValue {
  lang: Lang;
  t: Translation;
  switchLang: (lang: Lang) => void;
}

const I18nContext = createContext<I18nContextValue | null>(null);

export function I18nProvider({
  children,
  initialLang = defaultLang,
}: {
  children: ReactNode;
  initialLang?: Lang;
}) {
  const lang = initialLang;
  const t = useMemo(() => translations[lang], [lang]);

  const switchLang = (next: Lang) => {
    if (next === lang) return;
    const basePath = import.meta.env.BASE_URL ?? '/';
    const target = next === 'ko' ? `${basePath}` : `${basePath}en/`;
    window.location.href = target;
  };

  return <I18nContext.Provider value={{ lang, t, switchLang }}>{children}</I18nContext.Provider>;
}

export function useI18n(): I18nContextValue {
  const ctx = useContext(I18nContext);
  if (!ctx) {
    throw new Error('useI18n must be used within an I18nProvider');
  }
  return ctx;
}

export type { Lang, Translation } from './translations';
