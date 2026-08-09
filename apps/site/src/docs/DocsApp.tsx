import { useEffect } from 'react';
import { I18nProvider, useI18n } from '../i18n';
import { useTheme } from '../hooks/useTheme';
import type { DocSlug } from '../i18n/translations';

function resolveSlug(): DocSlug {
  const raw = document.documentElement.dataset.doc ?? 'getting-started';
  const allowed: DocSlug[] = [
    'getting-started',
    'how-conductor-works',
    'jobs',
    'control-tower',
    'reference',
  ];
  return (allowed.includes(raw as DocSlug) ? raw : 'getting-started') as DocSlug;
}

function getInitialLang(): 'ko' | 'en' {
  return document.documentElement.lang === 'en' ? 'en' : 'ko';
}

function DocsBody() {
  const { t, lang } = useI18n();
  const { theme, toggle } = useTheme();
  const slug = resolveSlug();
  const page = t.docs[slug];
  const base = import.meta.env.BASE_URL ?? '/';
  const homeHref = lang === 'en' ? `${base}en/` : base;
  const docsBase = lang === 'en' ? `${base}en/docs/` : `${base}docs/`;
  const otherLangHref =
    lang === 'en' ? `${base}docs/${slug}.html` : `${base}en/docs/${slug}.html`;

  useEffect(() => {
    document.title = `${page.title} · SuperLiora`;
    const meta = document.querySelector('meta[name="description"]');
    if (meta) meta.setAttribute('content', page.lead);
  }, [page]);

  return (
    <div className="grain mesh-bg min-h-[100dvh] text-text">
      <header className="border-b border-line bg-bg/70 backdrop-blur-xl">
        <div className="mx-auto flex max-w-5xl items-center justify-between gap-4 px-4 py-3 sm:px-6">
          <a href={homeHref} className="font-sans text-sm font-bold text-text">
            SuperLiora <span className="font-normal text-muted">/ {t.docsShell.onThisSite}</span>
          </a>
          <div className="flex items-center gap-2">
            <a href={otherLangHref} className="text-xs text-soft hover:text-primary">
              {lang === 'ko' ? t.footer.english : t.footer.korean}
            </a>
            <button
              type="button"
              onClick={toggle}
              className="rounded-md border border-line bg-bg-2 px-2 py-1 text-xs text-soft"
            >
              {theme === 'dark' ? 'Light' : 'Dark'}
            </button>
          </div>
        </div>
      </header>

      <div className="mx-auto grid max-w-5xl gap-10 px-4 py-10 sm:px-6 lg:grid-cols-[220px_1fr]">
        <aside>
          <a href={homeHref} className="text-sm text-primary hover:underline">
            ← {t.docsShell.home}
          </a>
          <nav className="mt-6 flex flex-col gap-1" aria-label="Docs">
            {t.docsNav.map((item) => (
              <a
                key={item.slug}
                href={`${docsBase}${item.slug}.html`}
                aria-current={item.slug === slug ? 'page' : undefined}
                className={`rounded-md px-3 py-2 text-sm transition ${
                  item.slug === slug
                    ? 'bg-bg-2 font-semibold text-primary'
                    : 'text-soft hover:bg-bg-2 hover:text-text'
                }`}
              >
                {item.label}
              </a>
            ))}
          </nav>
        </aside>

        <article>
          <h1 className="font-sans text-3xl font-bold tracking-tight md:text-4xl">{page.title}</h1>
          <p className="mt-3 text-lg text-soft">{page.lead}</p>
          <div className="mt-10 space-y-10">
            {page.sections.map((section) => (
              <section key={section.heading}>
                <h2 className="font-sans text-xl font-semibold text-text">{section.heading}</h2>
                <p className="mt-2 leading-relaxed text-soft">{section.body}</p>
                {section.code && (
                  <pre className="mt-4 overflow-x-auto rounded-md border border-line bg-bg-1 p-4 font-mono text-sm text-text">
                    <code>{section.code}</code>
                  </pre>
                )}
              </section>
            ))}
          </div>
        </article>
      </div>
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
