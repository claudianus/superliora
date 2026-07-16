import { useEffect, useState } from 'react';
import { I18nProvider, useI18n } from './i18n';
import { useTheme } from './hooks/useTheme';
import { Sections } from './components/Sections';
import { SunIcon, MoonIcon, GithubIcon } from './components/Icons';

type Lang = 'ko' | 'en';

function getInitialLang(): Lang {
  const htmlLang = document.documentElement.lang;
  return htmlLang === 'en' ? 'en' : 'ko';
}

function SkipLink() {
  const { t } = useI18n();
  return (
    <a
      href="#main"
      className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50 focus:rounded-md focus:bg-cyan focus:px-4 focus:py-2 focus:text-bg focus:outline-none"
    >
      {t.skip}
    </a>
  );
}

function ThemeToggle() {
  const { theme, toggle } = useTheme();
  return (
    <button
      type="button"
      onClick={toggle}
      aria-pressed={theme === 'dark'}
      aria-label={theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'}
      className="rounded-full border border-line bg-bg-2 p-2 text-soft transition hover:border-cyan hover:text-cyan focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan focus-visible:ring-offset-2 focus-visible:ring-offset-bg"
    >
      {theme === 'dark' ? <SunIcon className="h-5 w-5" /> : <MoonIcon className="h-5 w-5" />}
    </button>
  );
}

function BrandMark() {
  return (
    <span className="relative flex h-8 w-8 items-center justify-center overflow-hidden rounded-lg border border-cyan/30 bg-bg-2">
      <span className="absolute inset-0 bg-gradient-to-br from-cyan/25 to-transparent" />
      <span className="relative font-mono text-sm font-bold tracking-tight text-cyan">S</span>
    </span>
  );
}

function Navbar() {
  const { lang, t } = useI18n();
  const base = import.meta.env.BASE_URL ?? '/';
  const koHref = `${base}`;
  const enHref = `${base}en/`;
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 12);
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  const links = [
    { href: '#ultra', label: t.nav.workflow },
    { href: '#harness', label: t.nav.harness },
    { href: '#memory', label: t.nav.memory },
    { href: '#capabilities', label: t.nav.capabilities },
    { href: '#install', label: t.nav.install },
  ];

  return (
    <header
      className={`nav-shell fixed left-0 right-0 top-0 z-40 border-b border-transparent backdrop-blur-xl ${scrolled ? 'scrolled' : 'bg-bg/40'}`}
    >
      <div className="mx-auto flex max-w-7xl items-center justify-between gap-4 px-4 py-3 sm:px-6 lg:px-8">
        <a
          href={base}
          className="flex items-center gap-2.5 font-sans text-lg font-bold tracking-tight text-text focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan focus-visible:ring-offset-2 focus-visible:ring-offset-bg"
        >
          <BrandMark />
          <span>SuperLiora</span>
        </a>

        <nav aria-label="Main" className="hidden items-center gap-1 text-sm font-medium text-soft lg:flex">
          {links.map((link) => (
            <a
              key={link.href}
              href={link.href}
              className="rounded-full px-3 py-1.5 transition hover:bg-bg-2 hover:text-text focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan focus-visible:ring-offset-2 focus-visible:ring-offset-bg"
            >
              {link.label}
            </a>
          ))}
        </nav>

        <div className="flex items-center gap-2 sm:gap-3">
          <div className="flex items-center gap-1 rounded-full border border-line bg-bg-2 p-1 text-xs font-medium">
            <a
              href={koHref}
              aria-current={lang === 'ko' ? 'page' : undefined}
              className={`rounded-full px-2.5 py-1 transition ${lang === 'ko' ? 'bg-cyan text-bg' : 'text-soft hover:text-cyan'}`}
            >
              KR
            </a>
            <a
              href={enHref}
              aria-current={lang === 'en' ? 'page' : undefined}
              className={`rounded-full px-2.5 py-1 transition ${lang === 'en' ? 'bg-cyan text-bg' : 'text-soft hover:text-cyan'}`}
            >
              EN
            </a>
          </div>
          <ThemeToggle />
          <a
            href="https://github.com/claudianus/superliora"
            className="hidden items-center gap-1.5 rounded-full border border-line bg-bg-2 px-3 py-1.5 text-xs font-semibold text-soft transition hover:border-cyan hover:text-cyan sm:inline-flex"
            aria-label="GitHub"
          >
            <GithubIcon className="h-3.5 w-3.5" />
            <span>GitHub</span>
          </a>
        </div>
      </div>
    </header>
  );
}

function Footer() {
  const { t, lang } = useI18n();
  const base = import.meta.env.BASE_URL ?? '/';
  return (
    <footer className="border-t border-line px-4 py-12 sm:px-6 lg:px-8">
      <div className="mx-auto flex max-w-7xl flex-col gap-8">
        <div className="flex flex-col items-start justify-between gap-6 sm:flex-row sm:items-center">
          <div className="flex items-center gap-3">
            <BrandMark />
            <div>
              <div className="font-sans text-sm font-semibold text-text">SuperLiora</div>
              <div className="text-xs text-muted">Blood Moon terminal harness</div>
            </div>
          </div>
          <nav aria-label="Footer" className="flex flex-wrap items-center gap-x-5 gap-y-2 text-sm text-muted">
            <a href="https://github.com/claudianus/superliora" className="transition hover:text-cyan">
              {t.footer.github}
            </a>
            <a
              href={lang === 'ko' ? `${base}en/` : base}
              className="transition hover:text-cyan"
            >
              {lang === 'ko' ? t.footer.english : t.footer.korean}
            </a>
            <a
              href="https://github.com/claudianus/superliora/tree/main/docs"
              className="transition hover:text-cyan"
            >
              {t.footer.docs}
            </a>
            <a href="https://github.com/claudianus/superliora/issues" className="transition hover:text-cyan">
              {t.footer.issues}
            </a>
            <a
              href="https://github.com/claudianus/superliora/blob/main/SECURITY.md"
              className="transition hover:text-cyan"
            >
              {t.footer.security}
            </a>
          </nav>
        </div>
        <div className="flex flex-col justify-between gap-2 border-t border-line/70 pt-6 text-xs text-muted sm:flex-row">
          <div>{t.footer.copyright}</div>
          <div className="font-mono">v0.20.1 · #E63946</div>
        </div>
      </div>
    </footer>
  );
}

export function App() {
  const initialLang = getInitialLang();
  return (
    <I18nProvider initialLang={initialLang}>
      <div className="grain mesh-bg min-h-[100dvh] text-text">
        <SkipLink />
        <Navbar />
        <Sections />
        <Footer />
      </div>
    </I18nProvider>
  );
}

export default App;
