import { getLandingManifest } from '../landing';
import { useI18n } from '../i18n';
import { landingDocsHref } from '../lib/locale';
import { CopyButton } from './CopyButton';
import { ProductFrame } from './ProductFrame';
import { Reveal } from './Reveal';

export function Sections() {
  const { t, lang } = useI18n();
  const manifest = getLandingManifest(lang);
  const base = import.meta.env.BASE_URL ?? '/';
  const docsHref = landingDocsHref(lang, base);

  return (
    <main id="main" data-stage="editorial">
      <section className="hero-band" data-landing="hero">
        <div className="hero-layout">
          <Reveal className="hero-copy" eager>
            <p className="hero-kicker font-sans font-semibold tracking-[0.18em] text-primary uppercase">
              {t.hero.eyebrow}
            </p>
            <h1 className="hero-title mt-4 font-sans font-bold tracking-tight text-text text-balance">
              {t.hero.h1}
            </h1>
            <p className="hero-lead mt-5 max-w-[36ch] leading-relaxed text-soft">{t.hero.lead}</p>
            <div className="hero-command mt-6" aria-label="Quick start command">
              <span className="hero-command__pulse" aria-hidden="true" />
              <code>{t.hero.command}</code>
              <span className="hero-command__cursor" aria-hidden="true" />
            </div>
            <div className="hero-cta mt-8 flex flex-wrap items-center gap-3">
              <a
                href="#install"
                data-cta="install"
                className="btn btn-primary btn-pulse inline-flex min-h-11 items-center rounded-lg px-5 py-2.5 sm:px-6 sm:py-3"
              >
                {t.hero.install}
              </a>
              <a
                href="https://github.com/claudianus/superliora"
                className="btn btn-secondary inline-flex min-h-11 items-center rounded-lg px-5 py-2.5 sm:px-6 sm:py-3"
              >
                {t.hero.github}
              </a>
              <a href={docsHref} className="hero-cta__docs">
                {t.hero.docs}
              </a>
            </div>
          </Reveal>
          <Reveal className="hero-visual" eager>
            <ProductFrame />
          </Reveal>
        </div>
        <Reveal className="hero-proof-wrap" eager>
          <div className="hero-proof" aria-label="Product architecture">
            {t.hero.proof.map((item, i) => (
              <div key={item.value} className="hero-proof__item">
                <span className="hero-proof__index">0{i + 1}</span>
                <div>
                  <strong>{item.value}</strong>
                  <span>{item.label}</span>
                </div>
              </div>
            ))}
          </div>
        </Reveal>
      </section>

      <section id="features" className="section-pad section-band section-band--features border-t border-line" data-landing="features">
        <div className="mx-auto max-w-7xl">
          <Reveal className="max-w-2xl">
            <p className="section-kicker text-sm font-semibold tracking-wide text-primary">{t.clusters.kicker}</p>
            <h2 className="section-title mt-3 font-sans font-bold tracking-tight text-balance">
              {t.clusters.title}
            </h2>
            <p className="section-body mt-4 text-soft">{t.clusters.body}</p>
          </Reveal>
          <div className="pillar-grid mt-12">
            {t.clusters.items.map((cluster, i) => (
              <article key={cluster.id} id={cluster.id} className="pillar">
                <div className="pillar__index">{String(i + 1).padStart(2, '0')}</div>
                <h3 className="pillar__title">{cluster.title}</h3>
                <p className="pillar__lead">{cluster.lead}</p>
                <ul className="pillar__list">
                  {cluster.features.map((feature) => (
                    <li key={feature.id}>
                      <strong>{feature.title}</strong>
                      <span>{feature.body}</span>
                    </li>
                  ))}
                </ul>
              </article>
            ))}
          </div>
        </div>
      </section>

      <section id="usage" className="section-pad section-band section-band--usage border-t border-line" data-landing="usage">
        <div className="mx-auto max-w-7xl">
          <Reveal className="max-w-2xl">
            <p className="section-kicker text-sm font-semibold tracking-wide text-primary">{t.usage.kicker}</p>
            <h2 className="section-title mt-3 font-sans font-bold tracking-tight text-balance">
              {t.usage.title}
            </h2>
            <p className="section-body mt-4 text-soft">{t.usage.body}</p>
          </Reveal>
          <ol className="usage-table mt-10">
            {manifest.usage.map((item, i) => (
              <li key={item.id} className="usage-table__row" data-usage={item.id}>
                <div className="usage-table__index">{String(i + 1).padStart(2, '0')}</div>
                <code className="usage-table__cmd">{item.cmd}</code>
                <div className="usage-table__copy">
                  <h3>{item.title}</h3>
                  <p>{item.body}</p>
                </div>
              </li>
            ))}
          </ol>
        </div>
      </section>

      <section id="workflow" className="section-pad section-band section-band--workflow border-t border-line" data-landing="workflow">
        <div className="mx-auto max-w-7xl">
          <Reveal className="max-w-2xl">
            <p className="section-kicker text-sm font-semibold tracking-wide text-primary">{t.workflow.kicker}</p>
            <h2 className="section-title mt-3 font-sans font-bold tracking-tight text-balance">
              {t.workflow.title}
            </h2>
            <p className="section-body mt-4 text-soft">{t.workflow.body}</p>
          </Reveal>
          <ol className="workflow-cinema mt-12">
            {manifest.workflow.map((step, i) => (
              <li key={step.id} className="workflow-cinema__step" data-workflow={step.id}>
                <div className="workflow-cinema__n">{String(i + 1).padStart(2, '0')}</div>
                <h3 className="workflow-cinema__title">{step.title}</h3>
                <p className="workflow-cinema__body">{step.body}</p>
              </li>
            ))}
          </ol>
          <div className="keys-strip mt-12">
            {t.tower.items.map((item) => (
              <div key={item.keys} className="keys-strip__item">
                <kbd>{item.keys}</kbd>
                <div>
                  <h3 className="font-sans text-base font-semibold text-text">{item.title}</h3>
                  <p className="mt-1 text-sm text-soft">{item.body}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section id="install" className="section-pad section-band section-band--install border-t border-line" data-landing="install">
        <div className="install-panel mx-auto max-w-7xl">
          <Reveal className="install-panel__copy">
            <p className="section-kicker text-sm font-semibold tracking-wide text-primary">{t.install.kicker}</p>
            <h2 className="section-title mt-3 font-sans font-bold tracking-tight text-balance">
              {t.install.title}
            </h2>
            <p className="section-body mt-4 text-soft">{t.install.body}</p>
            <p className="install-req mt-4 font-mono text-sm text-primary">{t.install.requirements}</p>
          </Reveal>
          <div className="install-panel__commands">
            {t.install.commands.map((cmd) => (
              <Reveal key={cmd.label}>
                <div className="install-slab">
                  <div className="install-slab__label">{cmd.label}</div>
                  <div className="install-slab__code">
                    <code>{cmd.cmd}</code>
                    <CopyButton
                      text={cmd.cmd}
                      copyLabel={t.copy.label}
                      copiedLabel={t.copy.doneLabel}
                      idleText={t.copy.idle}
                      doneText={t.copy.done}
                    />
                  </div>
                </div>
              </Reveal>
            ))}
            <Reveal>
              <a href={docsHref} className="btn btn-secondary inline-flex rounded-lg px-5 py-2.5 text-sm font-semibold">
                {t.install.next}
              </a>
            </Reveal>
          </div>
        </div>
      </section>
    </main>
  );
}
