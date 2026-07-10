import { I18nProvider, useI18n } from './i18n';
import { useTheme } from './hooks/useTheme';
import { Sections } from './components/Sections';
import { SunIcon, MoonIcon } from './components/Icons';

type Lang = 'ko' | 'en';

function getInitialLang(): Lang {
  const htmlLang = document.documentElement.lang;
  return htmlLang === 'en' ? 'en' : 'ko';
}

function SkipLink() {
  const { t } = useI18n();
  return (
    <a href="#main" className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50 focus:rounded-md focus:bg-cyan focus:px-4 focus:py-2 focus:text-bg focus:outline-none">
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

function Navbar() {
  const { lang, t } = useI18n();
  const base = import.meta.env.BASE_URL ?? '/';
  const koHref = `${base}`;
  const enHref = `${base}en/`;

  return (
    <header className="fixed left-0 right-0 top-0 z-40 border-b border-line/50 bg-bg/80 backdrop-blur">
      <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-3 sm:px-6 lg:px-8">
        <a href={base} className="flex items-center gap-2 font-sans text-xl font-bold text-text focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan focus-visible:ring-offset-2 focus-visible:ring-offset-bg">
          <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-bg-2 text-cyan">S</span>
          <span>SuperLiora</span>
        </a>
        <nav aria-label="Main" className="hidden items-center gap-6 text-sm font-medium text-soft md:flex">
          <a href="#harness" className="transition hover:text-cyan focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan focus-visible:ring-offset-2 focus-visible:ring-offset-bg">{t.nav.harness}</a>
          <a href="#ultra" className="transition hover:text-cyan focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan focus-visible:ring-offset-2 focus-visible:ring-offset-bg">{t.nav.ultra}</a>
          <a href="#memory" className="transition hover:text-cyan focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan focus-visible:ring-offset-2 focus-visible:ring-offset-bg">{t.nav.memory}</a>
          <a href="#themes" className="transition hover:text-cyan focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan focus-visible:ring-offset-2 focus-visible:ring-offset-bg">{t.nav.themes}</a>
          <a href="#install" className="transition hover:text-cyan focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan focus-visible:ring-offset-2 focus-visible:ring-offset-bg">{t.nav.install}</a>
        </nav>
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-1 rounded-full border border-line bg-bg-2 p-1 text-xs font-medium">
            <a href={koHref} aria-current={lang === 'ko' ? 'page' : undefined} className={`rounded-full px-2 py-1 transition ${lang === 'ko' ? 'bg-cyan text-bg' : 'text-soft hover:text-cyan'}`}>KR</a>
            <a href={enHref} aria-current={lang === 'en' ? 'page' : undefined} className={`rounded-full px-2 py-1 transition ${lang === 'en' ? 'bg-cyan text-bg' : 'text-soft hover:text-cyan'}`}>EN</a>
          </div>
          <ThemeToggle />
        </div>
      </div>
    </header>
  );
}

function Footer() {
  const { t, lang } = useI18n();
  const base = import.meta.env.BASE_URL ?? '/';
  return (
    <footer className="border-t border-line px-4 py-10 sm:px-6 lg:px-8">
      <div className="mx-auto flex max-w-6xl flex-col items-center justify-between gap-4 text-sm text-muted sm:flex-row">
        <div>{t.footer.copyright}</div>
        <nav aria-label="Footer" className="flex flex-wrap items-center gap-6">
          <a href="https://github.com/claudianus/superliora" className="transition hover:text-cyan">{t.footer.github}</a>
          <a href={lang === 'ko' ? `${base}en/` : base} className="transition hover:text-cyan">{t.footer.english}</a>
          <a href="https://github.com/claudianus/superliora/issues" className="transition hover:text-cyan">{t.footer.issues}</a>
          <a href="https://github.com/claudianus/superliora/blob/main/SECURITY.md" className="transition hover:text-cyan">{t.footer.security}</a>
        </nav>
      </div>
    </footer>
  );
}

export function App() {
  const initialLang = getInitialLang();
  return (
    <I18nProvider initialLang={initialLang}>
      <div className="grain mesh-bg min-h-screen text-text">
        <SkipLink />
        <Navbar />
        <Sections />
        <Footer />
      </div>
    </I18nProvider>
  );
}

export default App;
