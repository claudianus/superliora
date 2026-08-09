import { useI18n } from '../i18n';
import { CopyButton } from './CopyButton';
import { Reveal } from './Reveal';
import { TheatrePlayer } from '../theatre/Player';

export function Sections() {
  const { t, lang } = useI18n();
  const base = import.meta.env.BASE_URL ?? '/';
  const docsHref =
    lang === 'en' ? `${base}en/docs/getting-started.html` : `${base}docs/getting-started.html`;

  return (
    <main id="main">
      <section className="relative overflow-hidden px-4 pb-16 pt-28 sm:px-6 lg:px-8 lg:pb-24 lg:pt-32">
        <div className="pointer-events-none absolute inset-0 -z-10 opacity-70">
          <div className="absolute -left-24 top-10 h-72 w-72 rounded-full bg-primary/10 blur-3xl" />
          <div className="absolute right-0 top-40 h-80 w-80 rounded-full bg-accent/10 blur-3xl" />
        </div>
        <div className="mx-auto grid max-w-7xl items-start gap-12 lg:grid-cols-[minmax(0,0.92fr)_minmax(0,1.08fr)] lg:gap-14">
          <Reveal className="lg:sticky lg:top-28 lg:self-start">
            <p className="font-sans text-sm font-semibold tracking-[0.18em] text-primary uppercase">
              {t.hero.brand}
            </p>
            <h1 className="mt-4 max-w-[14ch] font-sans text-[2.5rem] font-bold leading-[1.05] tracking-tight text-text sm:text-5xl lg:text-[3.4rem] text-balance">
              {t.hero.h1}
            </h1>
            <p className="mt-5 max-w-[36ch] text-lg leading-relaxed text-soft md:text-xl">{t.hero.lead}</p>
            <div className="mt-8 flex flex-wrap gap-3">
              <a href="#install" className="btn btn-primary inline-flex items-center rounded-lg px-6 py-3">
                {t.hero.install}
              </a>
              <a
                href="https://github.com/claudianus/superliora"
                className="btn btn-secondary inline-flex items-center rounded-lg px-6 py-3"
              >
                {t.hero.github}
              </a>
              <a href={docsHref} className="btn btn-secondary inline-flex items-center rounded-lg px-6 py-3">
                {t.hero.docs}
              </a>
            </div>
          </Reveal>
          <Reveal stagger={2} className="min-w-0">
            <TheatrePlayer />
          </Reveal>
        </div>
      </section>

      <section id="why" className="section-pad border-t border-line">
        <div className="mx-auto max-w-7xl">
          <Reveal className="max-w-2xl">
            <p className="text-sm font-semibold tracking-wide text-primary">{t.why.kicker}</p>
            <h2 className="mt-3 font-sans text-3xl font-bold tracking-tight md:text-4xl text-balance">
              {t.why.title}
            </h2>
            <p className="mt-4 text-lg text-soft">{t.why.body}</p>
          </Reveal>
          <div className="mt-12 grid gap-x-10 gap-y-12 sm:grid-cols-2">
            {t.why.items.map((item, i) => (
              <Reveal key={item.title} stagger={((i % 3) + 1) as 1 | 2 | 3}>
                <div className="font-mono text-xs text-primary/80">{String(i + 1).padStart(2, '0')}</div>
                <h3 className="mt-2 font-sans text-xl font-semibold text-text">{item.title}</h3>
                <p className="mt-2 max-w-[40ch] leading-relaxed text-soft">{item.body}</p>
              </Reveal>
            ))}
          </div>
        </div>
      </section>

      <section id="how" className="section-pad border-t border-line">
        <div className="mx-auto max-w-7xl">
          <Reveal className="max-w-2xl">
            <p className="text-sm font-semibold tracking-wide text-primary">{t.how.kicker}</p>
            <h2 className="mt-3 font-sans text-3xl font-bold tracking-tight md:text-4xl text-balance">
              {t.how.title}
            </h2>
            <p className="mt-4 text-lg text-soft">{t.how.body}</p>
          </Reveal>
          <div className="mt-12 grid gap-6 md:grid-cols-2 xl:grid-cols-4">
            {t.how.steps.map((step, i) => (
              <Reveal key={step.title} stagger={((i % 3) + 1) as 1 | 2 | 3}>
                <div className="h-full border-t border-primary/40 pt-5">
                  <div className="font-mono text-xs text-muted">{String(i + 1).padStart(2, '0')}</div>
                  <h3 className="mt-3 font-sans text-lg font-semibold text-text">{step.title}</h3>
                  <p className="mt-2 text-sm leading-relaxed text-soft">{step.body}</p>
                </div>
              </Reveal>
            ))}
          </div>
        </div>
      </section>

      <section id="tower" className="section-pad border-t border-line">
        <div className="mx-auto max-w-7xl">
          <Reveal className="max-w-2xl">
            <p className="text-sm font-semibold tracking-wide text-primary">{t.tower.kicker}</p>
            <h2 className="mt-3 font-sans text-3xl font-bold tracking-tight md:text-4xl text-balance">
              {t.tower.title}
            </h2>
            <p className="mt-4 text-lg text-soft">{t.tower.body}</p>
          </Reveal>
          <div className="mt-12 divide-y divide-line border-y border-line">
            {t.tower.items.map((item) => (
              <Reveal key={item.keys} className="grid gap-2 py-6 sm:grid-cols-[8rem_1fr] sm:items-baseline sm:gap-8">
                <kbd className="w-fit text-primary">{item.keys}</kbd>
                <div>
                  <h3 className="font-sans text-lg font-semibold text-text">{item.title}</h3>
                  <p className="mt-1 text-soft">{item.body}</p>
                </div>
              </Reveal>
            ))}
          </div>
        </div>
      </section>

      <section id="install" className="section-pad border-t border-line">
        <div className="mx-auto max-w-3xl">
          <Reveal>
            <p className="text-sm font-semibold tracking-wide text-primary">{t.install.kicker}</p>
            <h2 className="mt-3 font-sans text-3xl font-bold tracking-tight md:text-4xl text-balance">
              {t.install.title}
            </h2>
            <p className="mt-4 text-lg text-soft">{t.install.body}</p>
            <p className="mt-2 font-mono text-xs text-muted">{t.install.requirements}</p>
          </Reveal>
          <div className="mt-10 space-y-4">
            {t.install.commands.map((cmd) => (
              <Reveal key={cmd.label}>
                <div className="text-sm text-soft">{cmd.label}</div>
                <div className="relative mt-2 overflow-x-auto rounded-lg border border-line bg-bg-1 px-4 py-3.5 pr-20 font-mono text-sm text-text">
                  <code>{cmd.cmd}</code>
                  <CopyButton text={cmd.cmd} />
                </div>
              </Reveal>
            ))}
          </div>
          <Reveal className="mt-8">
            <a href={docsHref} className="btn btn-secondary inline-flex rounded-lg px-5 py-2.5 text-sm font-semibold">
              {t.install.next}
            </a>
          </Reveal>
        </div>
      </section>
    </main>
  );
}
