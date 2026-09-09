import { useEffect, useState, type ReactNode } from 'react';
import {
  ArrowLeft,
  ArrowRight,
  ArrowUpRight,
  Check,
  ChevronRight,
  Copy,
  Info,
  Moon,
  Sun,
} from 'lucide-react';
import { I18nProvider, useI18n } from '../i18n';
import { useTheme } from '../hooks/useTheme';
import type { DocSection, DocSlug, Translation } from '../i18n/translations';
import { KeyCap, Reveal, useCopy } from '../landing/components/shared';
import { cn } from '../landing/utils/cn';
import { splitRichText } from './richtext';

const SLUGS: DocSlug[] = [
  'getting-started',
  'how-conductor-works',
  'jobs',
  'control-tower',
  'reference',
];

function resolveSlug(): DocSlug {
  const raw = document.documentElement.dataset.doc ?? 'getting-started';
  return (SLUGS.includes(raw as DocSlug) ? raw : 'getting-started') as DocSlug;
}

function getInitialLang(): 'ko' | 'en' {
  return document.documentElement.lang === 'en' ? 'en' : 'ko';
}

function sectionId(index: number): string {
  return `sec-${String(index + 1)}`;
}

/* ------------------------------------------------------------------ */
/* Brand marks (same glyphs as the landing header, decoupled module)   */
/* ------------------------------------------------------------------ */

function GithubIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 16 16" fill="currentColor" className={className} aria-hidden>
      <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27s1.36.09 2 .27c1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.01 8.01 0 0 0 16 8c0-4.42-3.58-8-8-8Z" />
    </svg>
  );
}

function Wordmark({ className }: { className?: string }) {
  return (
    <span className={cn('flex items-center gap-2.5', className)}>
      <svg viewBox="0 0 32 32" className="size-[18px]" aria-hidden>
        <path
          d="M16 3v6M16 23v6M3 16h6M23 16h6M7.8 7.8l4.2 4.2M20 20l4.2 4.2M24.2 7.8L20 12M12 20l-4.2 4.2"
          stroke="currentColor"
          strokeWidth="2.6"
          strokeLinecap="round"
          className="text-primary"
        />
      </svg>
      <span className="font-[family-name:var(--font-mono)] text-[15px] font-medium tracking-tight text-ink">
        superliora
      </span>
    </span>
  );
}

/* ------------------------------------------------------------------ */
/* Inline rich text: kbd chords, slash/cli commands, idents            */
/* ------------------------------------------------------------------ */

function RichText({ text }: { text: string }) {
  const tokens = splitRichText(text);
  const out: ReactNode[] = tokens.map((token, i) => {
    if (token.kind === 'kbd') return <KeyCap key={i}>{token.text}</KeyCap>;
    if (token.kind === 'cmd') {
      return (
        <code
          key={i}
          className="rounded-md border border-primary/25 bg-primary/[0.07] px-1.5 py-0.5 font-[family-name:var(--font-mono)] text-[0.82em] break-words text-primary"
        >
          {token.text}
        </code>
      );
    }
    if (token.kind === 'mono') {
      return (
        <code
          key={i}
          className="rounded-md border border-line bg-sunken/60 px-1.5 py-0.5 font-[family-name:var(--font-mono)] text-[0.82em] break-words text-dim"
        >
          {token.text}
        </code>
      );
    }
    return token.text;
  });
  return <>{out}</>;
}

/* ------------------------------------------------------------------ */
/* Terminal blocks                                                     */
/* ------------------------------------------------------------------ */

function CodeLines({ code }: { code: string }) {
  return (
    <>
      {code.split('\n').map((line, i) => {
        const firstSpace = line.search(/\s/);
        const head = firstSpace === -1 ? line : line.slice(0, firstSpace);
        const tail = firstSpace === -1 ? '' : line.slice(firstSpace);
        return (
          <div key={i} className="whitespace-pre-wrap break-all">
            <span className="text-primary">{head}</span>
            <span className="text-ink/90">{tail}</span>
          </div>
        );
      })}
    </>
  );
}

function CodeBlock({
  label,
  code,
  copyText,
  copiedText,
}: {
  label: string;
  code: string;
  copyText: string;
  copiedText: string;
}) {
  const { copied, copy } = useCopy();
  return (
    <div className="scan group overflow-hidden rounded-xl border border-line bg-panel transition-colors hover:border-primary/40">
      <div className="flex items-center justify-between border-b border-line px-4 py-2.5">
        <span className="flex items-center gap-2 font-[family-name:var(--font-mono)] text-[10.5px] tracking-wider text-faint uppercase">
          <span className="size-1.5 rounded-full bg-primary/70" />
          {label}
        </span>
        <button
          type="button"
          onClick={() => void copy(code)}
          className="flex items-center gap-1.5 rounded-md border border-line px-2.5 py-1 text-[11px] text-dim transition-colors hover:border-primary/50 hover:text-ink"
        >
          {copied ? <Check className="size-3 text-mint" /> : <Copy className="size-3" />}
          {copied ? copiedText : copyText}
        </button>
      </div>
      <div className="docs-code overflow-x-auto px-4 py-4 font-[family-name:var(--font-mono)] text-[12.5px] leading-[1.8] sm:px-5">
        <CodeLines code={code} />
      </div>
    </div>
  );
}

function TabsBlock({
  tabs,
  copyText,
  copiedText,
}: {
  tabs: { label: string; code: string }[];
  copyText: string;
  copiedText: string;
}) {
  const [tab, setTab] = useState(0);
  const current = tabs[Math.min(tab, tabs.length - 1)];
  return (
    <div>
      <div className="flex flex-wrap gap-2" role="tablist" aria-label="platform">
        {tabs.map((t, i) => (
          <button
            key={t.label}
            role="tab"
            aria-selected={tab === i}
            onClick={() => setTab(i)}
            className={cn(
              'rounded-full border px-4 py-1.5 font-[family-name:var(--font-mono)] text-[12px] transition-all',
              tab === i
                ? 'border-primary bg-primary/10 text-primary'
                : 'border-line text-faint hover:border-primary/40 hover:text-dim',
            )}
          >
            {t.label}
          </button>
        ))}
      </div>
      <div className="mt-4">
        <CodeBlock label={current.label} code={current.code} copyText={copyText} copiedText={copiedText} />
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Header                                                              */
/* ------------------------------------------------------------------ */

function DocsHeader({
  t,
  lang,
  slug,
  homeHref,
  docsBase,
  otherLangHref,
}: {
  t: Translation;
  lang: 'ko' | 'en';
  slug: DocSlug;
  homeHref: string;
  docsBase: string;
  otherLangHref: string;
}) {
  const { theme, toggle } = useTheme();
  const [scrolled, setScrolled] = useState(false);
  const [prog, setProg] = useState(0);

  useEffect(() => {
    const onScroll = () => {
      setScrolled(window.scrollY > 24);
      const h = document.documentElement;
      const max = h.scrollHeight - h.clientHeight;
      setProg(max > 0 ? Math.min(1, h.scrollTop / max) : 0);
    };
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  return (
    <header
      className={cn(
        'fixed inset-x-0 top-0 z-50 transition-all duration-500',
        scrolled ? 'border-b border-line bg-paper/80 backdrop-blur-xl' : 'bg-transparent',
      )}
    >
      <div className="mx-auto flex h-[60px] max-w-6xl items-center gap-4 px-5">
        <a href={homeHref} className="shrink-0" aria-label="SuperLiora home">
          <Wordmark />
        </a>
        <span className="hidden font-[family-name:var(--font-mono)] text-[10.5px] tracking-[0.18em] text-faint uppercase sm:inline">
          / {t.docsShell.onThisSite}
        </span>

        <nav className="ml-2 hidden items-center gap-1 lg:flex" aria-label={t.docsShell.guide}>
          {t.docsNav.map((n) => (
            <a
              key={n.slug}
              href={`${docsBase}${n.slug}.html`}
              aria-current={n.slug === slug ? 'page' : undefined}
              className={cn(
                'rounded-md px-3 py-1.5 text-[13px] transition-colors',
                n.slug === slug ? 'text-primary' : 'text-dim hover:bg-white/[0.04] hover:text-ink',
              )}
            >
              {n.label}
            </a>
          ))}
        </nav>

        <div className="ml-auto flex items-center gap-2.5">
          <div className="flex items-center rounded-full border border-line p-0.5" role="group" aria-label="language">
            <a
              href={lang === 'ko' ? `${docsBase}${slug}.html` : otherLangHref}
              aria-current={lang === 'ko' ? 'page' : undefined}
              className={cn(
                'rounded-full px-2.5 py-1 font-[family-name:var(--font-mono)] text-[10.5px] tracking-wide transition-all',
                lang === 'ko' ? 'bg-primary text-black' : 'text-faint hover:text-dim',
              )}
            >
              한
            </a>
            <a
              href={lang === 'en' ? `${docsBase}${slug}.html` : otherLangHref}
              aria-current={lang === 'en' ? 'page' : undefined}
              className={cn(
                'rounded-full px-2.5 py-1 font-[family-name:var(--font-mono)] text-[10.5px] tracking-wide transition-all',
                lang === 'en' ? 'bg-primary text-black' : 'text-faint hover:text-dim',
              )}
            >
              EN
            </a>
          </div>

          <button
            type="button"
            onClick={toggle}
            aria-pressed={theme === 'dark'}
            aria-label={theme === 'dark' ? t.theme.toLight : t.theme.toDark}
            title={theme === 'dark' ? t.theme.light : t.theme.dark}
            className="flex size-[34px] items-center justify-center rounded-full border border-line text-dim transition-colors hover:border-primary/50 hover:text-ink"
          >
            {theme === 'dark' ? <Sun className="size-4" /> : <Moon className="size-4" />}
          </button>

          <a
            href="https://github.com/claudianus/superliora"
            target="_blank"
            rel="noreferrer"
            className="flex items-center gap-2 rounded-full border border-line px-3.5 py-1.5 text-[12.5px] text-dim transition-colors hover:border-primary/50 hover:text-ink"
          >
            <GithubIcon className="size-3.5" />
            <span className="hidden sm:inline">{t.footer.github}</span>
          </a>
        </div>
      </div>
      {/* scroll progress bar */}
      <div className="absolute inset-x-0 bottom-0 h-[2px]">
        <div
          className="h-full bg-gradient-to-r from-primary-deep to-primary transition-[width] duration-150 ease-out"
          style={{ width: `${prog * 100}%` }}
        />
      </div>
    </header>
  );
}

/* ------------------------------------------------------------------ */
/* Sections                                                            */
/* ------------------------------------------------------------------ */

function DocSectionBlock({
  section,
  index,
  t,
}: {
  section: DocSection;
  index: number;
  t: Translation;
}) {
  const id = sectionId(index);
  const no = String(index + 1).padStart(2, '0');
  return (
    <section id={id} aria-labelledby={`${id}-h`} className="docs-section scroll-mt-24">
      <Reveal>
        <p className="font-[family-name:var(--font-mono)] text-[11px] tracking-[0.28em] text-primary uppercase">
          {no}
        </p>
        <h2
          id={`${id}-h`}
          className="group mt-3 flex items-center gap-2 font-[family-name:var(--font-display)] text-[26px] leading-tight font-semibold tracking-[-0.01em] text-ink sm:text-3xl"
        >
          {section.heading}
          <a
            href={`#${id}`}
            aria-label={section.heading}
            className="text-faint opacity-0 transition-opacity group-hover:opacity-100 hover:text-primary focus-visible:opacity-100"
          >
            #
          </a>
        </h2>
      </Reveal>
      <Reveal i={1}>
        <p className="mt-4 max-w-2xl text-[15px] leading-[1.85] text-dim">
          <RichText text={section.body} />
        </p>
      </Reveal>
      {section.list && (
        <Reveal i={2}>
          <ul className="mt-6 space-y-2.5">
            {section.list.map((item, li) => (
              <li
                key={li}
                className="flex gap-3.5 rounded-xl border border-line bg-panel px-4 py-3.5 transition-colors hover:border-primary/35 sm:px-5"
              >
                <span className="tick-num mt-0.5 shrink-0 font-[family-name:var(--font-mono)] text-[11px] text-primary">
                  {String(li + 1).padStart(2, '0')}
                </span>
                <span className="text-[14px] leading-[1.75] text-dim">
                  <RichText text={item} />
                </span>
              </li>
            ))}
          </ul>
        </Reveal>
      )}
      {(section.tabs ?? section.code) && (
        <Reveal i={2}>
          <div className="mt-6">
            {section.tabs ? (
              <TabsBlock tabs={section.tabs} copyText={t.docsShell.copy} copiedText={t.docsShell.copied} />
            ) : (
              <CodeBlock
                label={section.codeLabel ?? t.docsShell.terminal}
                code={section.code ?? ''}
                copyText={t.docsShell.copy}
                copiedText={t.docsShell.copied}
              />
            )}
          </div>
        </Reveal>
      )}
      {section.note && (
        <Reveal i={2}>
          <aside className="mt-6 flex gap-3 rounded-xl border border-primary/25 bg-primary/[0.05] px-4 py-3.5 sm:px-5">
            <Info className="mt-0.5 size-4 shrink-0 text-primary" />
            <p className="text-[13.5px] leading-[1.75] text-dim">
              <RichText text={section.note} />
            </p>
          </aside>
        </Reveal>
      )}
    </section>
  );
}

/* ------------------------------------------------------------------ */
/* Footer                                                              */
/* ------------------------------------------------------------------ */

function DocsFooter({
  t,
  docsBase,
  homeHref,
}: {
  t: Translation;
  docsBase: string;
  homeHref: string;
}) {
  return (
    <footer className="relative overflow-hidden border-t border-line">
      <div className="mx-auto max-w-6xl px-5 pt-20 pb-10">
        <div className="grid gap-14 lg:grid-cols-[1.2fr_1fr]">
          <div>
            <a href={homeHref} className="inline-block">
              <Wordmark />
            </a>
            <p className="mt-6 max-w-sm font-[family-name:var(--font-display)] text-2xl leading-snug font-medium tracking-[-0.01em] text-ink">
              {t.footer.tagline}
            </p>
          </div>

          <div className="grid grid-cols-2 gap-8">
            <div>
              <p className="font-[family-name:var(--font-mono)] text-[10.5px] tracking-[0.22em] text-faint uppercase">
                {t.docsShell.onThisSite}
              </p>
              <ul className="mt-4 space-y-2.5">
                {t.docsNav.map((n) => (
                  <li key={n.slug}>
                    <a
                      href={`${docsBase}${n.slug}.html`}
                      className="group inline-flex items-center gap-1 text-[13.5px] text-dim transition-colors hover:text-primary"
                    >
                      {n.label}
                      <ArrowUpRight className="size-3 opacity-0 transition-opacity group-hover:opacity-100" />
                    </a>
                  </li>
                ))}
              </ul>
            </div>
            <div>
              <p className="font-[family-name:var(--font-mono)] text-[10.5px] tracking-[0.22em] text-faint uppercase">
                {t.footer.github}
              </p>
              <ul className="mt-4 space-y-2.5">
                {[
                  { label: t.footer.github, href: 'https://github.com/claudianus/superliora' },
                  { label: t.footer.issues, href: 'https://github.com/claudianus/superliora/issues' },
                  { label: t.footer.security, href: 'https://github.com/claudianus/superliora/blob/main/SECURITY.md' },
                ].map((l) => (
                  <li key={l.href}>
                    <a
                      href={l.href}
                      target="_blank"
                      rel="noreferrer"
                      className="group inline-flex items-center gap-1 text-[13.5px] text-dim transition-colors hover:text-primary"
                    >
                      {l.label}
                      <ArrowUpRight className="size-3 opacity-0 transition-opacity group-hover:opacity-100" />
                    </a>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </div>

        <Reveal>
          <div className="mt-16 overflow-hidden select-none" aria-hidden>
            <p className="outline-word font-[family-name:var(--font-display)] text-[13vw] leading-[0.95] font-bold tracking-[-0.04em] whitespace-nowrap lg:text-[150px]">
              superliora
            </p>
          </div>
        </Reveal>

        <div className="mt-10 flex flex-col gap-3 border-t border-line pt-8 sm:flex-row sm:items-center sm:justify-between">
          <p className="font-[family-name:var(--font-mono)] text-[10.5px] text-faint">{t.footer.copyright}</p>
          <a
            href={homeHref}
            className="flex items-center gap-1.5 font-[family-name:var(--font-mono)] text-[10.5px] text-faint transition-colors hover:text-primary"
          >
            <ArrowLeft className="size-3" />
            {t.docsShell.home}
          </a>
        </div>
      </div>
    </footer>
  );
}

/* ------------------------------------------------------------------ */
/* Page                                                                */
/* ------------------------------------------------------------------ */

function readingMinutes(t: Translation, slug: DocSlug): number {
  const page = t.docs[slug];
  const chars = page.sections
    .map((s) => `${s.heading} ${s.body} ${(s.list ?? []).join(' ')} ${s.note ?? ''}`)
    .join(' ').length;
  return Math.max(1, Math.round(chars / 600));
}

function DocsBody() {
  const { t, lang } = useI18n();
  const slug = resolveSlug();
  const page = t.docs[slug];
  const pageIndex = Math.max(0, SLUGS.indexOf(slug));
  const base = import.meta.env.BASE_URL ?? '/';
  const homeHref = lang === 'en' ? `${base}en/` : base;
  const docsBase = lang === 'en' ? `${base}en/docs/` : `${base}docs/`;
  const otherLangHref = lang === 'en' ? `${base}docs/${slug}.html` : `${base}en/docs/${slug}.html`;
  const prev = pageIndex > 0 ? t.docsNav[pageIndex - 1] : undefined;
  const next = pageIndex < t.docsNav.length - 1 ? t.docsNav[pageIndex + 1] : undefined;
  const [activeSection, setActiveSection] = useState(0);

  useEffect(() => {
    document.title = `${page.title} · SuperLiora`;
    const meta = document.querySelector('meta[name="description"]');
    if (meta) meta.setAttribute('content', page.lead);
  }, [page]);

  useEffect(() => {
    const targets = page.sections.map((_, i) => document.getElementById(sectionId(i))).filter(Boolean);
    if (targets.length === 0) return;
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (e.isIntersecting) {
            const idx = Number(e.target.id.replace('sec-', '')) - 1;
            if (Number.isFinite(idx)) setActiveSection(idx);
          }
        }
      },
      { rootMargin: '-30% 0px -60% 0px', threshold: 0 },
    );
    for (const el of targets) io.observe(el!);
    return () => io.disconnect();
  }, [page]);

  return (
    <div className="noise min-h-screen bg-paper text-ink">
      <a
        href="#docs-article"
        className="sr-only focus:not-sr-only focus:absolute focus:top-2 focus:left-2 focus:z-[70] focus:rounded-md focus:border focus:border-primary focus:bg-panel focus:px-3 focus:py-2 focus:text-[13px] focus:text-ink"
      >
        {t.skip}
      </a>
      <DocsHeader
        t={t}
        lang={lang}
        slug={slug}
        homeHref={homeHref}
        docsBase={docsBase}
        otherLangHref={otherLangHref}
      />

      {/* hero */}
      <section className="relative overflow-hidden pt-[60px]">
        <div className="grid-bg absolute inset-0" />
        <div
          className="pointer-events-none absolute -top-40 left-1/2 h-[420px] w-[900px] -translate-x-1/2 rounded-full opacity-60"
          style={{ background: 'radial-gradient(ellipse at center, rgba(0,213,255,0.10), transparent 62%)' }}
        />
        <div className="relative mx-auto max-w-6xl px-5">
          <div className="relative mx-auto mt-10 h-px max-w-3xl bg-line">
            <span className="beat-dot absolute -top-[2.5px] left-0 size-[6px] rounded-full bg-primary shadow-[0_0_12px_rgba(0,213,255,0.9)]" />
          </div>

          <div className="pt-12 pb-10 sm:pt-16">
            <Reveal>
              <nav
                aria-label="breadcrumb"
                className="flex items-center gap-2 font-[family-name:var(--font-mono)] text-[11px] tracking-[0.18em] text-faint uppercase"
              >
                <a href={homeHref} className="transition-colors hover:text-primary">
                  {t.docsShell.home}
                </a>
                <ChevronRight className="size-3" />
                <span>{t.docsShell.onThisSite}</span>
                <ChevronRight className="size-3" />
                <span className="text-primary">
                  {String(pageIndex + 1).padStart(2, '0')} {t.docsShell.of} {String(t.docsNav.length).padStart(2, '0')}
                </span>
              </nav>
            </Reveal>
            <Reveal i={1}>
              <h1 className="mt-6 max-w-3xl font-[family-name:var(--font-display)] text-[38px] leading-[1.05] font-semibold tracking-[-0.028em] sm:text-6xl">
                {page.title}
              </h1>
            </Reveal>
            <Reveal i={2}>
              <p className="mt-5 max-w-2xl text-[15.5px] leading-[1.75] text-dim sm:text-[16.5px]">{page.lead}</p>
            </Reveal>
            <Reveal i={3}>
              <div className="mt-6 flex flex-wrap items-center gap-2 font-[family-name:var(--font-mono)] text-[10.5px] text-faint">
                <span className="rounded border border-line px-1.5 py-0.5">
                  {readingMinutes(t, slug)} {t.docsShell.minRead}
                </span>
                <a
                  href={otherLangHref}
                  className="rounded border border-line px-1.5 py-0.5 transition-colors hover:border-primary/50 hover:text-primary"
                >
                  {lang === 'ko' ? t.footer.english : t.footer.korean}
                </a>
              </div>
            </Reveal>
          </div>

          {/* mobile + tablet page rail (the sidebar takes over on lg) */}
          <Reveal i={2} className="pb-8 lg:hidden">
            <nav aria-label={t.docsShell.guide} className="docs-chip-rail -mx-5 flex gap-2 overflow-x-auto px-5 pb-1">
              {t.docsNav.map((n, i) => (
                <a
                  key={n.slug}
                  href={`${docsBase}${n.slug}.html`}
                  aria-current={n.slug === slug ? 'page' : undefined}
                  className={cn(
                    'flex shrink-0 items-center gap-2 rounded-full border px-4 py-2 text-[12.5px] whitespace-nowrap transition-all',
                    n.slug === slug
                      ? 'border-primary bg-primary/10 text-primary'
                      : 'border-line text-faint hover:border-primary/40 hover:text-dim',
                  )}
                >
                  <span className="tick-num font-[family-name:var(--font-mono)] text-[10.5px]">
                    {String(i + 1).padStart(2, '0')}
                  </span>
                  {n.label}
                </a>
              ))}
            </nav>
          </Reveal>
        </div>
      </section>

      {/* body */}
      <main className="relative mx-auto max-w-6xl px-5 pb-28">
        <div className="grid gap-12 lg:grid-cols-[240px_minmax(0,1fr)] xl:grid-cols-[240px_minmax(0,1fr)_190px]">
          {/* left sidebar */}
          <aside className="hidden lg:block">
            <div className="docs-rail sticky top-[84px] max-h-[calc(100dvh-100px)] overflow-y-auto pr-2 pb-8">
              <p className="font-[family-name:var(--font-mono)] text-[10.5px] tracking-[0.22em] text-faint uppercase">
                {t.docsShell.guide}
              </p>
              <nav aria-label={t.docsShell.guide} className="mt-4 space-y-1">
                {t.docsNav.map((n, i) => (
                  <a
                    key={n.slug}
                    href={`${docsBase}${n.slug}.html`}
                    aria-current={n.slug === slug ? 'page' : undefined}
                    className={cn(
                      'group relative flex items-center gap-3 rounded-xl border px-4 py-3 text-left transition-all',
                      n.slug === slug
                        ? 'border-primary/60 bg-primary/[0.07]'
                        : 'border-transparent hover:border-line hover:bg-panel',
                    )}
                  >
                    <span
                      className={cn(
                        'tick-num font-[family-name:var(--font-mono)] text-[10.5px]',
                        n.slug === slug ? 'text-primary' : 'text-faint',
                      )}
                    >
                      {String(i + 1).padStart(2, '0')}
                    </span>
                    <span className={cn('text-[13.5px]', n.slug === slug ? 'text-ink' : 'text-dim group-hover:text-ink')}>
                      {n.label}
                    </span>
                    <span
                      className={cn(
                        'ml-auto size-1.5 rounded-full transition-colors',
                        n.slug === slug ? 'bg-primary' : 'bg-transparent group-hover:bg-line-strong',
                      )}
                    />
                  </a>
                ))}
              </nav>
              <div className="hr-fade my-6" />
              <a
                href={homeHref}
                className="flex items-center gap-2 text-[13px] text-faint transition-colors hover:text-primary"
              >
                <ArrowLeft className="size-3.5" />
                {t.docsShell.home}
              </a>
            </div>
          </aside>

          {/* article */}
          <article id="docs-article" className="min-w-0">
            <div className="space-y-16 sm:space-y-20">
              {page.sections.map((section, i) => (
                <DocSectionBlock key={section.heading} section={section} index={i} t={t} />
              ))}
            </div>

            {/* pager */}
            <nav aria-label="pages" className="mt-20 grid gap-4 sm:grid-cols-2">
              {prev ? (
                <Reveal className="h-full">
                  <a
                    href={`${docsBase}${prev.slug}.html`}
                    className="group flex h-full flex-col gap-2 rounded-2xl border border-line bg-panel p-6 transition-colors hover:border-primary/35"
                  >
                    <span className="flex items-center gap-1.5 font-[family-name:var(--font-mono)] text-[10.5px] tracking-[0.2em] text-faint uppercase">
                      <ArrowLeft className="size-3.5 transition-transform group-hover:-translate-x-0.5" />
                      {t.docsShell.prev}
                    </span>
                    <span className="font-[family-name:var(--font-display)] text-lg font-semibold text-ink group-hover:text-primary">
                      {t.docs[prev.slug].title}
                    </span>
                  </a>
                </Reveal>
              ) : (
                <span className="hidden sm:block" />
              )}
              {next && (
                <Reveal i={1} className="h-full">
                  <a
                    href={`${docsBase}${next.slug}.html`}
                    className="group flex h-full flex-col items-end gap-2 rounded-2xl border border-line bg-panel p-6 text-right transition-colors hover:border-primary/35"
                  >
                    <span className="flex items-center gap-1.5 font-[family-name:var(--font-mono)] text-[10.5px] tracking-[0.2em] text-faint uppercase">
                      {t.docsShell.next}
                      <ArrowRight className="size-3.5 transition-transform group-hover:translate-x-0.5" />
                    </span>
                    <span className="font-[family-name:var(--font-display)] text-lg font-semibold text-ink group-hover:text-primary">
                      {t.docs[next.slug].title}
                    </span>
                  </a>
                </Reveal>
              )}
            </nav>
          </article>

          {/* right TOC */}
          <aside className="hidden xl:block">
            <div className="docs-rail sticky top-[84px] max-h-[calc(100dvh-100px)] overflow-y-auto pb-8">
              <p className="font-[family-name:var(--font-mono)] text-[10.5px] tracking-[0.22em] text-faint uppercase">
                {t.docsShell.toc}
              </p>
              <nav aria-label={t.docsShell.toc} className="mt-4 space-y-0.5 border-l border-line">
                {page.sections.map((s, i) => (
                  <a
                    key={s.heading}
                    href={`#${sectionId(i)}`}
                    aria-current={activeSection === i ? 'true' : undefined}
                    className={cn(
                      '-ml-px block border-l-2 py-1.5 pr-2 pl-4 text-[12.5px] transition-colors',
                      activeSection === i
                        ? 'border-primary text-ink'
                        : 'border-transparent text-faint hover:text-dim',
                    )}
                  >
                    {s.heading}
                  </a>
                ))}
              </nav>
            </div>
          </aside>
        </div>
      </main>

      <DocsFooter t={t} docsBase={docsBase} homeHref={homeHref} />
    </div>
  );
}

export function DocsApp() {
  return (
    <I18nProvider initialLang={getInitialLang()}>
      <DocsBody />
    </I18nProvider>
  );
}
