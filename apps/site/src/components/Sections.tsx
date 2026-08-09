import { useI18n } from '../i18n';
import { CopyButton } from './CopyButton';
import { Reveal } from './Reveal';
import { TheatrePlayer } from '../theatre/Player';

function Eyebrow({ children }: { children: React.ReactNode }) {
  return (
    <div className="eyebrow mb-4">
      <span className="h-1.5 w-1.5 rounded-full bg-primary pulse-dot" aria-hidden="true" />
      {children}
    </div>
  );
}

export function Sections() {
  const { t, lang } = useI18n();
  const base = import.meta.env.BASE_URL ?? '/';
  const docsHref =
    lang === 'en' ? `${base}en/docs/getting-started.html` : `${base}docs/getting-started.html`;

  return (
    <main id="main">
      <section className="relative min-h-[100dvh] px-0 pb-16 pt-24 sm:px-6 lg:px-8">
        <div className="mx-auto max-w-7xl">
          <Reveal className="px-4 sm:px-0">
            <p className="font-sans text-sm font-semibold tracking-[0.2em] text-primary uppercase">
              {t.hero.brand}
            </p>
            <h1 className="mt-3 max-w-[18ch] font-sans text-4xl font-bold leading-[1.05] tracking-tight text-text sm:text-5xl lg:text-6xl text-balance">
              {t.hero.h1}
            </h1>
            <p className="mt-5 max-w-[58ch] text-lg leading-relaxed text-soft md:text-xl">{t.hero.lead}</p>
            <div className="mt-8 flex flex-wrap gap-3">
              <a href="#install" className="btn btn-primary inline-flex items-center rounded-md px-6 py-3">
                {t.hero.install}
              </a>
              <a
                href="https://github.com/claudianus/superliora"
                className="btn btn-secondary inline-flex items-center rounded-md px-6 py-3"
              >
                {t.hero.github}
              </a>
              <a href={docsHref} className="btn btn-secondary inline-flex items-center rounded-md px-6 py-3">
                {t.hero.docs}
              </a>
            </div>
          </Reveal>
          <Reveal stagger={2} className="mt-10 w-full sm:mt-12">
            <TheatrePlayer />
          </Reveal>
        </div>
      </section>

      <section id="how" className="section-pad border-t border-line">
        <div className="mx-auto max-w-7xl">
          <Reveal>
            <Eyebrow>{t.how.kicker}</Eyebrow>
            <h2 className="max-w-3xl font-sans text-3xl font-bold tracking-tight md:text-4xl text-balance">
              {t.how.title}
            </h2>
            <p className="mt-4 max-w-[65ch] text-lg text-soft">{t.how.body}</p>
          </Reveal>
          <ol className="mt-12 space-y-0 border-l border-line pl-6">
            {t.how.steps.map((step, i) => (
              <Reveal key={step.title} stagger={((i % 3) + 1) as 1 | 2 | 3} className="relative pb-10 last:pb-0">
                <span className="absolute -left-[1.6rem] top-1 flex h-5 w-5 -translate-x-1/2 items-center justify-center rounded-full border border-primary/40 bg-bg-2 font-mono text-[10px] text-primary">
                  {i + 1}
                </span>
                <h3 className="font-sans text-xl font-semibold text-text">{step.title}</h3>
                <p className="mt-2 max-w-[60ch] text-soft">{step.body}</p>
              </Reveal>
            ))}
          </ol>
        </div>
      </section>

      <section id="tower" className="section-pad border-t border-line">
        <div className="mx-auto max-w-7xl">
          <Reveal>
            <Eyebrow>{t.tower.kicker}</Eyebrow>
            <h2 className="max-w-3xl font-sans text-3xl font-bold tracking-tight md:text-4xl text-balance">
              {t.tower.title}
            </h2>
            <p className="mt-4 max-w-[65ch] text-lg text-soft">{t.tower.body}</p>
          </Reveal>
          <div className="mt-12 grid gap-8 sm:grid-cols-2 lg:grid-cols-4">
            {t.tower.items.map((item, i) => (
              <Reveal key={item.keys} stagger={((i % 3) + 1) as 1 | 2 | 3}>
                <kbd className="text-primary">{item.keys}</kbd>
                <h3 className="mt-3 font-sans text-lg font-semibold">{item.title}</h3>
                <p className="mt-2 text-sm leading-relaxed text-soft">{item.body}</p>
              </Reveal>
            ))}
          </div>
        </div>
      </section>

      <section id="install" className="section-pad border-t border-line">
        <div className="mx-auto max-w-7xl">
          <Reveal>
            <Eyebrow>{t.install.kicker}</Eyebrow>
            <h2 className="max-w-3xl font-sans text-3xl font-bold tracking-tight md:text-4xl text-balance">
              {t.install.title}
            </h2>
            <p className="mt-4 max-w-[65ch] text-lg text-soft">{t.install.body}</p>
            <p className="mt-2 font-mono text-xs text-muted">{t.install.requirements}</p>
          </Reveal>
          <div className="mt-10 space-y-4">
            {t.install.commands.map((cmd) => (
              <Reveal key={cmd.label}>
                <div className="text-sm font-medium text-soft">{cmd.label}</div>
                <div className="relative mt-2 overflow-x-auto rounded-md border border-line bg-bg-1 px-4 py-3 pr-20 font-mono text-sm text-text">
                  <code>{cmd.cmd}</code>
                  <CopyButton text={cmd.cmd} />
                </div>
              </Reveal>
            ))}
          </div>
          <Reveal className="mt-8">
            <a href={docsHref} className="btn btn-secondary inline-flex rounded-md px-5 py-2.5 text-sm font-semibold">
              {t.install.next}
            </a>
          </Reveal>
        </div>
      </section>
    </main>
  );
}
