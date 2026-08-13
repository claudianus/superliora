import { useEffect, useState } from 'react';
import { getLandingManifest } from './landing';
import { I18nProvider, useI18n } from './i18n';
import { useTheme } from './hooks/useTheme';
import { LivingField } from './components/LivingField';
import { NoirField } from './components/NoirField';
import { PointerField } from './components/PointerField';
import { Sections } from './components/Sections';

type Lang = 'ko' | 'en';

function getInitialLang(): Lang {
  return document.documentElement.lang === 'en' ? 'en' : 'ko';
}

function ScrollProgress() {
  const [progress, setProgress] = useState(0);

  useEffect(() => {
    const onScroll = () => {
      const max = document.documentElement.scrollHeight - window.innerHeight;
      setProgress(max <= 0 ? 0 : Math.min(1, window.scrollY / max));
    };
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => {
      window.removeEventListener('scroll', onScroll);
    };
  }, []);

  return (
    <div className="scroll-progress" aria-hidden="true">
      <span style={{ transform: `scaleX(${progress})` }} />
    </div>
  );
}

function SkipLink() {
  const { t } = useI18n();
  return (
    <a
      href="#main"
      className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50 focus:rounded-md focus:bg-primary focus:px-4 focus:py-2 focus:text-bg-1"
    >
      {t.skip}
    </a>
  );
}

function ThemeToggle() {
  const { theme, toggle } = useTheme();
  const { t } = useI18n();
  return (
    <button
      type="button"
      onClick={toggle}
      aria-pressed={theme === 'dark'}
      aria-label={theme === 'dark' ? t.theme.toLight : t.theme.toDark}
      className="rounded-md border border-line bg-bg-2 px-2.5 py-1.5 text-xs font-medium text-soft transition hover:border-primary hover:text-primary"
    >
      {theme === 'dark' ? t.theme.light : t.theme.dark}
    </button>
  );
}

function BrandMark() {
  return (
    <span className="relative flex h-8 w-8 items-center justify-center overflow-hidden rounded-md border border-primary/40 bg-bg-2">
      <span className="absolute inset-0 bg-gradient-to-br from-primary/30 via-transparent to-accent/20" />
      <span className="relative font-mono text-sm font-bold text-primary">S</span>
    </span>
  );
}

function Navbar() {
  const { lang, t } = useI18n();
  const manifest = getLandingManifest(lang);
  const base = import.meta.env.BASE_URL ?? '/';
  const koHref = `${base}`;
  const enHref = `${base}en/`;
  const docsHref =
    lang === 'en' ? `${base}en/docs/getting-started.html` : `${base}docs/getting-started.html`;
  const [scrolled, setScrolled] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [activeSection, setActiveSection] = useState<string>('');

  useEffect(() => {
    const onScroll = () => {
      setScrolled(window.scrollY > 12);
    };
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => {
      window.removeEventListener('scroll', onScroll);
    };
  }, []);

  useEffect(() => {
    if (!menuOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setMenuOpen(false);
    };
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    window.addEventListener('keydown', onKey);
    return () => {
      document.body.style.overflow = prev;
      window.removeEventListener('keydown', onKey);
    };
  }, [menuOpen]);

  useEffect(() => {
    const ids = getLandingManifest(lang).nav.map((item) => item.id);
    const nodes = ids
      .map((id) => document.getElementById(id))
      .filter((el): el is HTMLElement => el !== null);
    if (nodes.length === 0) return;
    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries
          .filter((entry) => entry.isIntersecting)
          .sort((a, b) => b.intersectionRatio - a.intersectionRatio)[0];
        if (visible?.target.id) setActiveSection(visible.target.id);
      },
      { rootMargin: '-28% 0px -55% 0px', threshold: [0.15, 0.35, 0.6] },
    );
    for (const node of nodes) observer.observe(node);
    return () => {
      observer.disconnect();
    };
  }, [lang]);

  const links = [
    ...manifest.nav.map((item) => ({ href: item.href, label: item.label, id: item.id })),
    { href: docsHref, label: t.nav.docs, id: 'docs' },
  ];

  const closeMenu = () => {
    setMenuOpen(false);
  };

  return (
    <header
      className={`nav-shell fixed left-0 right-0 top-0 z-40 border-b border-transparent backdrop-blur-xl ${scrolled || menuOpen ? 'scrolled' : 'bg-bg/40'}`}
    >
      <div className="nav-bar mx-auto flex max-w-[90rem] items-center justify-between gap-3 px-4 py-3 sm:px-6 lg:px-8">
        <a href={base} className="flex min-w-0 items-center gap-2.5 font-sans text-lg font-bold tracking-tight text-text">
          <BrandMark />
          <span className="truncate">SuperLiora</span>
        </a>
        <nav aria-label="Main" className="hidden items-center gap-0.5 text-sm font-medium lg:flex">
          {links.map((link) => (
            <a
              key={link.href}
              href={link.href}
              aria-current={link.id === activeSection ? 'location' : undefined}
              className={`rounded-md px-2.5 py-1.5 transition hover:bg-bg-2 hover:text-text ${
                link.id === activeSection ? 'bg-bg-2 text-primary' : 'text-text/80'
              }`}
            >
              {link.label}
            </a>
          ))}
        </nav>
        <div className="flex items-center gap-2">
          <div className="flex items-center gap-1 rounded-md border border-line bg-bg-2 p-1 text-xs font-medium">
            <a
              href={koHref}
              aria-current={lang === 'ko' ? 'page' : undefined}
              className={`rounded px-2.5 py-1 transition ${lang === 'ko' ? 'bg-primary text-bg-1' : 'text-soft hover:text-primary'}`}
            >
              KR
            </a>
            <a
              href={enHref}
              aria-current={lang === 'en' ? 'page' : undefined}
              className={`rounded px-2.5 py-1 transition ${lang === 'en' ? 'bg-primary text-bg-1' : 'text-soft hover:text-primary'}`}
            >
              EN
            </a>
          </div>
          <ThemeToggle />
          <button
            type="button"
            className="nav-burger lg:hidden"
            data-nav-toggle
            aria-controls="mobile-nav"
            aria-expanded={menuOpen}
            aria-label={menuOpen ? t.nav.menuClose : t.nav.menuOpen}
            onClick={() => {
              setMenuOpen((open) => !open);
            }}
          >
            <span className="nav-burger__lines" data-open={menuOpen ? 'true' : 'false'} aria-hidden="true">
              <span />
              <span />
              <span />
            </span>
          </button>
        </div>
      </div>
      <div
        id="mobile-nav"
        className={`nav-drawer lg:hidden ${menuOpen ? 'nav-drawer--open' : ''}`}
        aria-hidden={!menuOpen}
      >
        <nav aria-label="Mobile" className="nav-drawer__panel" inert={!menuOpen ? true : undefined}>
          {links.map((link) => (
            <a
              key={link.href}
              href={link.href}
              className="nav-drawer__link"
              tabIndex={menuOpen ? 0 : -1}
              onClick={closeMenu}
            >
              {link.label}
            </a>
          ))}
        </nav>
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
              <div className="text-xs text-muted">{t.footer.tagline}</div>
            </div>
          </div>
          <nav aria-label="Footer" className="flex flex-wrap items-center gap-x-5 gap-y-2 text-sm text-muted">
            <a href="https://github.com/claudianus/superliora" className="transition hover:text-primary">
              {t.footer.github}
            </a>
            <a href={lang === 'ko' ? `${base}en/` : base} className="transition hover:text-primary">
              {lang === 'ko' ? t.footer.english : t.footer.korean}
            </a>
            <a
              href={lang === 'en' ? `${base}en/docs/getting-started.html` : `${base}docs/getting-started.html`}
              className="transition hover:text-primary"
            >
              {t.footer.docs}
            </a>
            <a href="https://github.com/claudianus/superliora/issues" className="transition hover:text-primary">
              {t.footer.issues}
            </a>
            <a
              href="https://github.com/claudianus/superliora/blob/main/SECURITY.md"
              className="transition hover:text-primary"
            >
              {t.footer.security}
            </a>
          </nav>
        </div>
        <div className="flex flex-col justify-between gap-2 border-t border-line/70 pt-6 text-xs text-muted sm:flex-row">
          <div>{t.footer.copyright}</div>
          <div className="font-mono">Neon Noir · #00D5FF</div>
        </div>
      </div>
    </footer>
  );
}

export function App() {
  const initialLang = getInitialLang();
  return (
    <I18nProvider initialLang={initialLang}>
      <div className="grain mesh-bg stage-root min-h-[100dvh] text-text">
        <NoirField />
        <PointerField />
        <LivingField />
        <SkipLink />
        <ScrollProgress />
        <Navbar />
        <Sections />
        <Footer />
      </div>
    </I18nProvider>
  );
}

export default App;
