import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import type { Dict, Locale } from "./types";
import { ko } from "./ko";
import { en } from "./en";

const dicts: Record<Locale, Dict> = { ko, en };

interface LocaleCtx {
  locale: Locale;
  t: Dict;
  setLocale: (l: Locale) => void;
}

const Ctx = createContext<LocaleCtx>({ locale: "ko", t: ko, setLocale: () => {} });

function initialLocale(): Locale {
  try {
    const saved = localStorage.getItem("sl-locale");
    if (saved === "ko" || saved === "en") return saved;
  } catch {}
  // Explicit URL locale (e.g. /en/ on GitHub Pages) beats browser detection.
  const hint = document.documentElement.dataset.locale;
  if (hint === "ko" || hint === "en") return hint;
  if (typeof navigator !== "undefined" && navigator.language?.toLowerCase().startsWith("ko")) return "ko";
  return "en";
}

export function LocaleProvider({ children }: { children: ReactNode }) {
  const [locale, setLocaleState] = useState<Locale>(initialLocale);

  const setLocale = (l: Locale) => {
    setLocaleState(l);
    try {
      localStorage.setItem("sl-locale", l);
    } catch {}
  };

  useEffect(() => {
    document.documentElement.lang = locale;
    document.title = dicts[locale].meta.title;
  }, [locale]);

  const value = useMemo(() => ({ locale, t: dicts[locale], setLocale }), [locale]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useLocale() {
  return useContext(Ctx);
}
