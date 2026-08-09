import { useI18n } from '../i18n';
import { CopyButton } from './CopyButton';
import { Reveal } from './Reveal';
import { ScrollLinkedStage } from '../theatre/Player';

export function Sections() {
  const { t, lang } = useI18n();
  const base = import.meta.env.BASE_URL ?? '/';
  const docsHref =
    lang === 'en' ? `${base}en/docs/getting-started.html` : `${base}docs/getting-started.html`;

  return (
    <main id="main">
      <div className="museum-pin">
        <div className="museum-pin__stage">
          <ScrollLinkedStage />
        </div>

        <section data-stage-hero className="museum-hero">
          <div className="museum-hero__veil" aria-hidden="true" />
          <div className="museum-hero__copy">
            <p className="hero-kicker font-sans font-semibold tracking-[0.18em] text-primary uppercase">
              {t.hero.brand}
            </p>
            <h1 className="hero-title mt-3 max-w-[16ch] font-sans font-bold tracking-tight text-text text-balance">
              {t.hero.h1}
            </h1>
            <p className="hero-lead mt-4 max-w-[36ch] leading-relaxed text-soft">
              {t.hero.lead}
            </p>
            <div className="hero-cta mt-6 flex flex-wrap gap-3 sm:mt-7">
              <a href="#install" className="btn btn-primary inline-flex min-h-11 items-center rounded-lg px-5 py-2.5 sm:px-6 sm:py-3">
                {t.hero.install}
              </a>
              <a
                href="https://github.com/claudianus/superliora"
                className="btn btn-secondary inline-flex min-h-11 items-center rounded-lg px-5 py-2.5 sm:px-6 sm:py-3"
              >
                {t.hero.github}
              </a>
              <a href={docsHref} className="btn btn-secondary inline-flex min-h-11 items-center rounded-lg px-5 py-2.5 sm:px-6 sm:py-3">
                {t.hero.docs}
              </a>
            </div>
          </div>
        </section>

        <section id="features" className="museum-features relative z-10">
          <div className="museum-features__panel section-pad">
            <Reveal className="max-w-xl">
              <p className="section-kicker text-sm font-semibold tracking-wide text-primary">{t.clusters.kicker}</p>
              <h2 className="section-title mt-3 font-sans font-bold tracking-tight text-balance">
                {t.clusters.title}
              </h2>
              <p className="section-body mt-4 text-soft">{t.clusters.body}</p>
            </Reveal>

            <div className="cluster-stack mt-10 space-y-14 sm:mt-12 lg:space-y-20">
              {t.clusters.items.map((cluster, i) => (
                <article
                  key={cluster.id}
                  id={cluster.id}
                  data-cluster={cluster.id}
                  className="cluster-reel"
                >
                  <Reveal stagger={((i % 3) + 1) as 1 | 2 | 3}>
                    <div className="font-mono text-xs text-primary/80">
                      {String(i + 1).padStart(2, '0')}
                    </div>
                    <h3 className="cluster-title mt-2 max-w-[20ch] font-sans font-semibold tracking-tight text-text">
                      {cluster.title}
                    </h3>
                    <p className="cluster-lead mt-3 max-w-[42ch] text-soft">{cluster.lead}</p>
                  </Reveal>
                  <div className="feature-rail mt-6" role="list">
                    {cluster.features.map((feature) => (
                      <div key={feature.id} className="feature-ribbon" role="listitem">
                        <div className="font-sans text-sm font-semibold text-text">{feature.title}</div>
                        <p className="mt-1 text-sm leading-relaxed text-soft">{feature.body}</p>
                      </div>
                    ))}
                  </div>
                </article>
              ))}
            </div>
          </div>
        </section>
      </div>

      <section id="how" className="section-pad border-t border-line bg-bg">
        <div className="mx-auto max-w-7xl">
          <Reveal className="max-w-2xl">
            <p className="section-kicker text-sm font-semibold tracking-wide text-primary">{t.how.kicker}</p>
            <h2 className="section-title mt-3 font-sans font-bold tracking-tight text-balance">
              {t.how.title}
            </h2>
            <p className="section-body mt-4 text-soft">{t.how.body}</p>
          </Reveal>
          <div className="mt-10 grid gap-6 sm:mt-12 md:grid-cols-2 xl:grid-cols-4">
            {t.how.steps.map((step, i) => (
              <Reveal key={step.title} stagger={((i % 3) + 1) as 1 | 2 | 3}>
                <div className="h-full border-t border-primary/40 pt-5">
                  <div className="font-mono text-xs text-muted">{String(i + 1).padStart(2, '0')}</div>
                  <h3 className="mt-3 font-sans text-lg font-semibold text-text md:text-xl">{step.title}</h3>
                  <p className="mt-2 text-sm leading-relaxed text-soft md:text-base">{step.body}</p>
                </div>
              </Reveal>
            ))}
          </div>
        </div>
      </section>

      <section id="tower" className="section-pad border-t border-line bg-bg">
        <div className="mx-auto max-w-7xl">
          <Reveal className="max-w-2xl">
            <p className="text-sm font-semibold tracking-wide text-primary">{t.tower.kicker}</p>
            <h2 className="mt-3 font-sans text-3xl font-bold tracking-tight md:text-4xl text-balance">
              {t.tower.title}
            </h2>
            <p className="mt-4 text-lg text-soft">{t.tower.body}</p>
          </Reveal>
          <div className="keys-strip mt-12">
            {t.tower.items.map((item) => (
              <Reveal key={item.keys} className="keys-strip__item">
                <kbd>{item.keys}</kbd>
                <div>
                  <h3 className="font-sans text-base font-semibold text-text">{item.title}</h3>
                  <p className="mt-1 text-sm text-soft">{item.body}</p>
                </div>
              </Reveal>
            ))}
          </div>
        </div>
      </section>

      <section id="install" className="section-pad border-t border-line bg-bg">
        <div className="mx-auto max-w-3xl">
          <Reveal>
            <p className="section-kicker text-sm font-semibold tracking-wide text-primary">{t.install.kicker}</p>
            <h2 className="section-title mt-3 font-sans font-bold tracking-tight text-balance">
              {t.install.title}
            </h2>
            <p className="section-body mt-4 text-soft">{t.install.body}</p>
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
