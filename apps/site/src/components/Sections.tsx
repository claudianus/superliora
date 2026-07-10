import { useI18n } from '../i18n';
import { CopyButton } from './CopyButton';
import { Terminal } from './Terminal';
import { Reveal } from './Reveal';
import {
  ACPIcon,
  ArrowRightIcon,
  BrowserIcon,
  CogIcon,
  CommandIcon,
  ComputerIcon,
  DocsIcon,
  FeatureIcon,
  GithubIcon,
  GoalIcon,
  IncidentIcon,
  LearnIcon,
  MemoryIcon,
  MigrationIcon,
  PlanIcon,
  ProviderIcon,
  ResearchIcon,
  SwarmIcon,
  TUIIcon,
  VerifyIcon,
} from './Icons';

function Eyebrow({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={`mb-4 inline-flex items-center gap-2 rounded-full border border-cyan/30 bg-cyan/10 px-3 py-1 text-xs font-semibold tracking-wide text-cyan uppercase ${className}`}>
      <span className="h-1.5 w-1.5 rounded-full bg-cyan pulse-dot" aria-hidden="true" />
      {children}
    </div>
  );
}

function SectionHead({
  kicker,
  title,
  body,
}: {
  kicker: string;
  title: string;
  body?: string;
}) {
  return (
    <Reveal className="mx-auto mb-10 max-w-3xl text-center md:mb-12">
      <Eyebrow>{kicker}</Eyebrow>
      <h2 className="font-sans text-3xl font-bold leading-tight tracking-tight text-text md:text-4xl lg:text-5xl text-balance">
        {title}
      </h2>
      {body && <p className="mt-4 text-lg leading-relaxed text-soft md:text-xl">{body}</p>}
    </Reveal>
  );
}

function asset(path: string) {
  const base = import.meta.env.BASE_URL ?? '/';
  return `${base}assets/${path}`;
}

function HeroImage({
  src,
  webp,
  alt,
  eager = false,
  badge,
  imgClassName,
  wrapperClassName,
}: {
  src: string;
  webp: string;
  alt: string;
  eager?: boolean;
  badge?: React.ReactNode;
  imgClassName?: string;
  wrapperClassName?: string;
}) {
  const imgCls = imgClassName ?? 'h-auto w-full transition duration-700 group-hover:scale-[1.02]';
  return (
    <div className={`group relative overflow-hidden rounded-2xl border border-line bg-bg-2 shadow-lg card-hover ${wrapperClassName ?? ''}`}>
      <picture>
        <source srcSet={webp} type="image/webp" />
        <img
          src={src}
          alt={alt}
          width={1672}
          height={941}
          loading={eager ? 'eager' : 'lazy'}
          decoding="async"
          className={imgCls}
        />
      </picture>
      {badge && (
        <div className="pointer-events-none absolute left-4 top-4 rounded-full border border-white/10 bg-bg/80 px-3 py-1 text-xs font-medium text-text backdrop-blur">
          {badge}
        </div>
      )}
    </div>
  );
}

function SpotlightCard({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  const handleMove = (e: React.MouseEvent<HTMLDivElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const x = ((e.clientX - rect.left) / rect.width) * 100;
    const y = ((e.clientY - rect.top) / rect.height) * 100;
    e.currentTarget.style.setProperty('--x', `${x}%`);
    e.currentTarget.style.setProperty('--y', `${y}%`);
  };

  return (
    <div onMouseMove={handleMove} className={`spotlight ${className}`}>
      {children}
    </div>
  );
}

const problemIcons = [MigrationIcon, FeatureIcon, IncidentIcon, DocsIcon];
const capabilityIcons = [
  PlanIcon,
  ResearchIcon,
  GoalIcon,
  SwarmIcon,
  CogIcon,
  MemoryIcon,
  BrowserIcon,
  ComputerIcon,
  ProviderIcon,
  DocsIcon,
  TUIIcon,
  ACPIcon,
];
const workflowIcons = [PlanIcon, GoalIcon, ResearchIcon, SwarmIcon, VerifyIcon, LearnIcon];
const memoryMeta = [
  { border: 'border-t-cyan/40', iconBg: 'bg-cyan/10', text: 'text-cyan', Icon: MemoryIcon },
  { border: 'border-t-emerald/40', iconBg: 'bg-emerald/10', text: 'text-emerald', Icon: DocsIcon },
  { border: 'border-t-amber/40', iconBg: 'bg-amber/10', text: 'text-amber', Icon: CommandIcon },
];

export function Sections() {
  const { t } = useI18n();

  return (
    <main id="main">
      {/* Hero */}
      <section className="relative min-h-[80dvh] px-4 pb-16 pt-28 sm:px-6 lg:px-8">
        <div className="mx-auto max-w-7xl">
          <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
            <Reveal stagger={1} className="lg:col-span-7 lg:row-span-2 flex flex-col justify-between">
              <div>
                <Eyebrow>{t.hero.eyebrow}</Eyebrow>
                <h1 className="font-sans text-4xl font-bold leading-[1.05] tracking-tighter text-text sm:text-5xl lg:text-6xl xl:text-7xl text-balance">
                  {t.hero.h1}
                </h1>
                <p className="mt-6 max-w-[65ch] text-lg leading-relaxed text-soft">{t.hero.lead}</p>
                <div className="mt-8 flex flex-wrap gap-4">
                  <a
                    href="#install"
                    className="btn inline-flex items-center gap-2 rounded-full bg-cyan px-6 py-3 font-semibold text-bg shadow-lg shadow-cyan/20 hover:bg-cyan/90"
                  >
                    {t.hero.install}
                    <ArrowRightIcon className="h-4 w-4" />
                  </a>
                  <a
                    href="https://github.com/claudianus/superliora"
                    className="btn btn-secondary inline-flex items-center gap-2 rounded-full border border-line bg-bg-2 px-6 py-3 font-semibold text-text hover:border-cyan hover:text-cyan"
                  >
                    <GithubIcon className="h-4 w-4" />
                    {t.hero.github}
                  </a>
                </div>
                <div className="mt-10 flex flex-wrap items-center gap-4 sm:gap-8">
                  {t.hero.stats.map((stat) => (
                    <span key={stat} className="inline-flex items-center gap-2 text-sm font-semibold text-muted">
                      <span className="h-1.5 w-1.5 rounded-full bg-cyan" aria-hidden="true" />
                      {stat}
                    </span>
                  ))}
                </div>
              </div>

              <div className="mt-12 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
                {[
                  { icon: PlanIcon, label: 'UltraPlan', body: t.ultra.steps[0].body },
                  { icon: SwarmIcon, label: 'UltraSwarm', body: t.ultra.steps[3].body },
                  { icon: MemoryIcon, label: 'Liora Recall', body: t.memory.copyList[0].split(':')[1]?.trim() ?? t.memory.copyList[0] },
                  { icon: BrowserIcon, label: 'Browser-use', body: t.capabilities.items[6].body },
                ].map((chip) => (
                  <SpotlightCard key={chip.label} className="surface p-5 card-hover">
                    <div className="relative z-10">
                      <div className="mb-3 flex items-center gap-2 text-sm font-semibold text-text">
                        <chip.icon className="h-4 w-4 text-cyan" />
                        {chip.label}
                      </div>
                      <p className="text-sm leading-relaxed text-soft">{chip.body}</p>
                    </div>
                  </SpotlightCard>
                ))}
              </div>
            </Reveal>

            <Reveal stagger={2} className="lg:col-span-5 lg:row-span-2">
              <div className="hero-glow rounded-2xl">
                <HeroImage
                  src={asset('hero-command-center.png')}
                  webp={asset('hero-command-center.webp')}
                  alt="SuperLiora Bento command center: Harness, Terminal, Capabilities, Status"
                  eager
                  badge={
                    <span className="flex items-center gap-1.5">
                      <span className="h-1.5 w-1.5 rounded-full bg-emerald pulse-dot" />
                      SuperLiora 0.20.1
                    </span>
                  }
                />
              </div>
            </Reveal>
          </div>
        </div>
      </section>

      {/* Problem */}
      <section id="problem" className="px-4 py-20 sm:px-6 lg:px-8">
        <div className="mx-auto max-w-7xl">
          <SectionHead kicker={t.problem.kicker} title={t.problem.title} body={t.problem.body} />
          <div className="grid gap-5 md:grid-cols-2">
            {t.problem.cases.map((c, i) => {
              const Icon = problemIcons[i] ?? CogIcon;
              return (
                <SpotlightCard key={c.title} className="surface p-6 card-hover border-t-2 border-t-cyan/40">
                  <div className="relative z-10">
                    <div className="mb-4 inline-flex rounded-lg bg-cyan/10 p-2 text-cyan">
                      <Icon className="h-5 w-5" />
                    </div>
                    <h3 className="mb-2 font-sans text-lg font-semibold text-text">{c.title}</h3>
                    <p className="text-sm leading-relaxed text-soft">{c.body}</p>
                  </div>
                </SpotlightCard>
              );
            })}
          </div>
        </div>
      </section>

      {/* Solution / Terminal */}
      <section id="solution" className="px-4 py-20 sm:px-6 lg:px-8">
        <div className="mx-auto max-w-7xl">
          <SectionHead kicker={t.solution.kicker} title={t.solution.title} body={t.solution.body} />
          <Reveal className="mx-auto max-w-3xl">
            <Terminal steps={t.terminal} />
          </Reveal>
          <div className="mx-auto mt-6 flex max-w-3xl flex-wrap items-center justify-center gap-3 text-sm text-soft">
            <span className="inline-flex items-center gap-1.5 rounded-full border border-line bg-bg-2 px-3 py-1">
              <CommandIcon className="h-3.5 w-3.5 text-cyan" />
              <kbd>Shift</kbd> + <kbd>Tab</kbd>
            </span>
            <span>{t.solution.body}</span>
          </div>
        </div>
      </section>

      {/* Ultra workflow */}
      <section id="ultra" className="px-4 py-20 sm:px-6 lg:px-8">
        <div className="mx-auto max-w-7xl">
          <SectionHead kicker={t.ultra.kicker} title={t.ultra.title} body={t.ultra.body} />

          <div className="grid items-start gap-10 lg:grid-cols-12">
            <Reveal stagger={1} className="lg:col-span-5">
              <Eyebrow>{t.ultra.copyTitle}</Eyebrow>
              <p className="mt-4 text-lg leading-relaxed text-soft">{t.ultra.copyBody}</p>
              <ul className="mt-6 space-y-3 text-soft">
                {t.ultra.copyList.map((item) => (
                  <li key={item} className="flex gap-3">
                    <span className="text-cyan" aria-hidden="true">›</span>
                    <span>{item}</span>
                  </li>
                ))}
              </ul>
            </Reveal>
            <Reveal stagger={2} className="lg:col-span-7">
              <div className="grid gap-4 sm:grid-cols-2">
                {t.ultra.steps.map((s, i) => {
                  const Icon = workflowIcons[i] ?? CogIcon;
                  return (
                    <SpotlightCard key={s.title} className="surface p-5 card-hover">
                      <div className="relative z-10">
                        <div className="mb-3 flex items-center gap-3">
                          <div className="flex h-9 w-9 items-center justify-center rounded-full border border-line bg-bg-3 text-cyan">
                            <Icon className="h-4 w-4" />
                          </div>
                          <span className="font-mono text-xs text-muted">{s.num}</span>
                        </div>
                        <h3 className="font-sans text-lg font-semibold text-text">{s.title}</h3>
                        <p className="mt-1 text-sm leading-relaxed text-soft">{s.body}</p>
                      </div>
                    </SpotlightCard>
                  );
                })}
              </div>
            </Reveal>
          </div>
        </div>
      </section>

      {/* Harness */}
      <section id="harness" className="px-4 py-20 sm:px-6 lg:px-8">
        <div className="mx-auto max-w-7xl">
          <SectionHead kicker={t.harness.kicker} title={t.harness.title} body={t.harness.body} />
          <div className="grid items-center gap-10 lg:grid-cols-12">
            <Reveal stagger={1} className="lg:col-span-7">
              <div className="h-[360px] lg:h-[420px]">
                <HeroImage
                  src={asset('agent-cockpit.png')}
                  webp={asset('agent-cockpit.webp')}
                  alt="SuperLiora agent cockpit with session list, command log, and live status"
                  wrapperClassName="h-full"
                  imgClassName="h-full w-full object-cover object-[center_33%] transition duration-700 group-hover:scale-[1.02]"
                />
              </div>
            </Reveal>
            <Reveal stagger={2} className="lg:col-span-5">
              <h3 className="font-sans text-2xl font-bold tracking-tight text-text md:text-3xl">
                {t.harness.copyTitle}
              </h3>
              <p className="mt-4 text-lg leading-relaxed text-soft">{t.harness.copyBody}</p>
              <ul className="mt-6 space-y-3 text-soft">
                {t.harness.copyList.map((item) => (
                  <li key={item} className="flex gap-3">
                    <span className="text-cyan" aria-hidden="true">›</span>
                    <span>{item}</span>
                  </li>
                ))}
              </ul>
            </Reveal>
          </div>
        </div>
      </section>

      {/* Memory */}
      <section id="memory" className="px-4 py-20 sm:px-6 lg:px-8">
        <div className="mx-auto max-w-7xl">
          <SectionHead kicker={t.memory.kicker} title={t.memory.title} body={t.memory.body} />
          <div className="grid gap-6 sm:grid-cols-3">
            {t.memory.copyList.map((item, i) => {
              const [title, body] = item.split(':').map((s) => s.trim());
              const cfg = memoryMeta[i] ?? { border: 'border-t-cyan/40', iconBg: 'bg-cyan/10', text: 'text-cyan', Icon: CogIcon };
              return (
                <SpotlightCard key={title} className={`surface p-6 card-hover ${cfg.border}`}>
                  <div className="relative z-10">
                    <div className={`mb-4 inline-flex rounded-lg ${cfg.iconBg} p-2 ${cfg.text}`}>
                      <cfg.Icon className="h-5 w-5" />
                    </div>
                    <h3 className="font-sans text-lg font-semibold text-text">{title}</h3>
                    <p className="mt-2 text-sm leading-relaxed text-soft">{body}</p>
                  </div>
                </SpotlightCard>
              );
            })}
          </div>
        </div>
      </section>

      {/* Themes */}
      <section id="themes" className="px-4 py-20 sm:px-6 lg:px-8">
        <div className="mx-auto max-w-7xl">
          <SectionHead kicker={t.themes.kicker} title={t.themes.title} body={t.themes.body} />
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {t.themes.cards.map((card) => (
              <SpotlightCard key={card.title} className="surface p-5 card-hover">
                <div className="relative z-10">
                  <div className="mb-3 flex gap-1.5">
                    <span className="h-2 w-10 rounded-full bg-cyan" aria-hidden="true" />
                    <span className="h-2 w-8 rounded-full bg-violet" aria-hidden="true" />
                    <span className="h-2 w-6 rounded-full bg-amber" aria-hidden="true" />
                  </div>
                  <h3 className="font-sans text-lg font-semibold text-text">{card.title}</h3>
                  <p className="mt-1 text-sm leading-relaxed text-soft">{card.body}</p>
                </div>
              </SpotlightCard>
            ))}
          </div>
        </div>
      </section>

      {/* Capabilities */}
      <section id="capabilities" className="px-4 py-20 sm:px-6 lg:px-8">
        <div className="mx-auto max-w-7xl">
          <SectionHead kicker={t.capabilities.kicker} title={t.capabilities.title} />
          <div className="grid grid-cols-1 gap-5 md:grid-cols-4">
            {t.capabilities.items.map((item, i) => {
              const Icon = capabilityIcons[i] ?? CogIcon;
              const capabilitySpans = [2, 1, 1, 2, 1, 1, 2, 1, 1, 2, 1, 1];
              const span = capabilitySpans[i] ?? 1;
              return (
                <Reveal key={item.title} stagger={((i % 6) + 1) as 1 | 2 | 3 | 4 | 5 | 6}>
                  <SpotlightCard className={`surface p-6 card-hover ${span === 2 ? 'md:col-span-2' : ''}`}>
                    <div className="relative z-10">
                      <div className="mb-4 flex items-center justify-between">
                        <div className="inline-flex rounded-lg bg-cyan/10 p-2 text-cyan">
                          <Icon className="h-5 w-5" />
                        </div>
                        <span className="font-mono text-sm text-muted">{String(i + 1).padStart(2, '0')}</span>
                      </div>
                      <h3 className="font-sans text-lg font-semibold text-text">{item.title}</h3>
                      <p className="mt-2 text-sm leading-relaxed text-soft">{item.body}</p>
                    </div>
                  </SpotlightCard>
                </Reveal>
              );
            })}
          </div>
        </div>
      </section>

      {/* Install */}
      <section id="install" className="px-4 py-20 sm:px-6 lg:px-8">
        <div className="mx-auto max-w-7xl">
          <Reveal>
            <div className="surface p-8 sm:p-12">
              <div className="grid gap-10 lg:grid-cols-2">
                <div>
                  <Eyebrow>{t.install.kicker}</Eyebrow>
                  <h2 className="font-sans text-3xl font-bold tracking-tight text-text md:text-4xl text-balance">
                    {t.install.title}
                  </h2>
                  <p className="mt-4 max-w-xl text-lg leading-relaxed text-soft">{t.install.body}</p>
                  <a
                    href="https://github.com/claudianus/superliora"
                    className="btn mt-6 inline-flex items-center gap-2 rounded-full bg-cyan px-6 py-3 font-semibold text-bg shadow-lg shadow-cyan/20 hover:bg-cyan/90"
                  >
                    <GithubIcon className="h-4 w-4" />
                    {t.install.cta}
                  </a>
                </div>
                <div className="space-y-4">
                  {t.install.commands.map((c) => (
                    <div
                      key={c.label}
                      className="relative overflow-hidden rounded-xl border border-line bg-bg-1 p-4 font-mono text-sm text-text shimmer"
                    >
                      <CopyButton text={c.cmd} />
                      <span className="text-amber">$</span> {c.cmd}
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </Reveal>
        </div>
      </section>

      {/* CTA */}
      <section className="px-4 py-20 sm:px-6 lg:px-8">
        <div className="mx-auto max-w-3xl text-center">
          <Reveal>
            <div className="glass cta-glow relative overflow-hidden rounded-3xl p-10 sm:p-14">
              <h2 className="font-sans text-3xl font-bold tracking-tight text-text md:text-4xl lg:text-5xl text-balance">
                {t.cta.title}
              </h2>
              <p className="mt-4 text-lg leading-relaxed text-soft">{t.cta.body}</p>
              <div className="mt-8 flex flex-wrap justify-center gap-4">
                <a
                  href="#install"
                  className="btn inline-flex items-center gap-2 rounded-full bg-cyan px-6 py-3 font-semibold text-bg shadow-lg shadow-cyan/20 hover:bg-cyan/90"
                >
                  {t.cta.install}
                  <ArrowRightIcon className="h-4 w-4" />
                </a>
                <a
                  href="https://github.com/claudianus/superliora"
                  className="btn btn-secondary inline-flex items-center gap-2 rounded-full border border-line bg-bg-2 px-6 py-3 font-semibold text-text hover:border-cyan hover:text-cyan"
                >
                  <GithubIcon className="h-4 w-4" />
                  {t.cta.github}
                </a>
              </div>
            </div>
          </Reveal>
        </div>
      </section>
    </main>
  );
}

export default Sections;
