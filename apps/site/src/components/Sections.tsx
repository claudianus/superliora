import { getLandingManifest } from '../landing';
import { useI18n } from '../i18n';
import { BentoGrid } from './BentoGrid';
import { CopyButton } from './CopyButton';
import { ProductFrame } from './ProductFrame';
import { Reveal } from './Reveal';
import { TiltFrame } from './TiltFrame';
import { ClusterVisual, HowFlowVisual, TowerHubVisual, UsageVisual } from './tui/ClusterVisual';

export function Sections() {
  const { t, lang } = useI18n();
  const manifest = getLandingManifest(lang);
  const base = import.meta.env.BASE_URL ?? '/';
  const docsHref =
    lang === 'en' ? `${base}en/docs/getting-started.html` : `${base}docs/getting-started.html`;

  return (
    <main id="main">
      <section className="hero-band" data-landing="hero">
        <div className="hero-aurora" aria-hidden="true" />
        <div className="hero-layout">
          <Reveal className="hero-copy">
            <p className="hero-kicker font-sans font-semibold tracking-[0.18em] text-primary uppercase">
              {t.hero.eyebrow}
            </p>
            <h1 className="hero-title mt-4 max-w-[16ch] font-sans font-bold tracking-tight text-text text-balance">
              {t.hero.h1}
            </h1>
            <p className="hero-lead mt-5 max-w-[38ch] leading-relaxed text-soft">{t.hero.lead}</p>
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
          <Reveal className="hero-visual" stagger={2}>
            <TiltFrame>
              <ProductFrame />
            </TiltFrame>
          </Reveal>
        </div>
        <Reveal className="hero-proof-wrap" stagger={3}>
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
        <nav className="topic-rail" aria-label={lang === 'ko' ? '랜딩 목차' : 'On this page'}>
          {manifest.nav.map((item) => (
            <a key={item.id} href={item.href} className="topic-rail__chip">
              {item.label}
            </a>
          ))}
        </nav>
      </section>

      <section id="features" className="section-pad border-t border-line bg-bg" data-landing="features">
        <div className="mx-auto max-w-7xl">
          <Reveal className="max-w-2xl">
            <p className="section-kicker text-sm font-semibold tracking-wide text-primary">{t.clusters.kicker}</p>
            <h2 className="section-title mt-3 font-sans font-bold tracking-tight text-balance">
              {t.clusters.title}
            </h2>
            <p className="section-body mt-4 text-soft">{t.clusters.body}</p>
          </Reveal>

          <div className="cluster-stack mt-12 space-y-20 sm:mt-14 lg:space-y-28">
            {t.clusters.items.map((cluster, i) => (
              <article key={cluster.id} id={cluster.id} className="cluster-block">
                <div className={`cluster-block__top${i % 2 === 1 ? ' cluster-block__top--flip' : ''}`}>
                  <Reveal className="cluster-block__copy" stagger={((i % 3) + 1) as 1 | 2 | 3}>
                    <div className="font-mono text-xs text-primary/80">{String(i + 1).padStart(2, '0')}</div>
                    <h3 className="cluster-title mt-2 max-w-[20ch] font-sans font-semibold tracking-tight text-text">
                      {cluster.title}
                    </h3>
                    <p className="cluster-lead mt-3 max-w-[42ch] text-soft">{cluster.lead}</p>
                  </Reveal>
                  <Reveal className="cluster-block__visual" stagger={(((i + 1) % 3) + 1) as 1 | 2 | 3}>
                    <TiltFrame>
                      <ClusterVisual clusterId={cluster.id} />
                    </TiltFrame>
                  </Reveal>
                </div>
                <Reveal className="cluster-block__bento mt-8" stagger={3}>
                  <BentoGrid features={cluster.features} />
                </Reveal>
              </article>
            ))}
          </div>
        </div>
      </section>

      <section id="usage" className="section-pad border-t border-line bg-bg" data-landing="usage">
        <div className="mx-auto max-w-7xl">
          <div className="usage-grid">
            <Reveal className="usage-grid__copy">
              <p className="section-kicker text-sm font-semibold tracking-wide text-primary">{t.usage.kicker}</p>
              <h2 className="section-title mt-3 font-sans font-bold tracking-tight text-balance">
                {t.usage.title}
              </h2>
              <p className="section-body mt-4 text-soft">{t.usage.body}</p>
              <ol className="usage-list mt-10">
                {manifest.usage.map((item, i) => (
                  <li key={item.id} className="usage-card" data-usage={item.id}>
                    <div className="usage-card__index">{String(i + 1).padStart(2, '0')}</div>
                    <div className="usage-card__body">
                      <code className="usage-card__cmd">{item.cmd}</code>
                      <h3 className="usage-card__title">{item.title}</h3>
                      <p className="usage-card__text">{item.body}</p>
                    </div>
                  </li>
                ))}
              </ol>
            </Reveal>
            <Reveal className="usage-grid__visual" stagger={2}>
              <TiltFrame>
                <UsageVisual />
              </TiltFrame>
            </Reveal>
          </div>
        </div>
      </section>

      <section id="workflow" className="section-pad border-t border-line bg-bg" data-landing="workflow">
        <div className="mx-auto max-w-7xl">
          <div className="how-grid">
            <Reveal className="how-grid__copy">
              <p className="section-kicker text-sm font-semibold tracking-wide text-primary">{t.workflow.kicker}</p>
              <h2 className="section-title mt-3 font-sans font-bold tracking-tight text-balance">
                {t.workflow.title}
              </h2>
              <p className="section-body mt-4 text-soft">{t.workflow.body}</p>
              <ol className="workflow-rail mt-10">
                {manifest.workflow.map((step, i) => (
                  <li key={step.id} className="workflow-rail__step" data-workflow={step.id}>
                    <div className="workflow-rail__num">{String(i + 1).padStart(2, '0')}</div>
                    <div>
                      <h3 className="font-sans text-lg font-semibold text-text">{step.title}</h3>
                      <p className="mt-2 text-sm leading-relaxed text-soft">{step.body}</p>
                    </div>
                  </li>
                ))}
              </ol>
            </Reveal>
            <Reveal className="how-grid__visual" stagger={2}>
              <TiltFrame>
                <HowFlowVisual />
              </TiltFrame>
            </Reveal>
          </div>
        </div>
      </section>

      <section id="tower" className="section-pad border-t border-line bg-bg">
        <div className="mx-auto max-w-7xl">
          <div className="tower-grid">
            <Reveal className="tower-grid__visual">
              <TiltFrame>
                <TowerHubVisual />
              </TiltFrame>
            </Reveal>
            <Reveal className="tower-grid__copy" stagger={2}>
              <p className="section-kicker text-sm font-semibold tracking-wide text-primary">{t.tower.kicker}</p>
              <h2 className="section-title mt-3 font-sans font-bold tracking-tight text-balance">
                {t.tower.title}
              </h2>
              <p className="section-body mt-4 text-soft">{t.tower.body}</p>
              <div className="keys-strip mt-10">
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
            </Reveal>
          </div>
        </div>
      </section>

      <section id="install" className="section-pad border-t border-line bg-bg" data-landing="install">
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
