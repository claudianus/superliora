import { useI18n } from '../i18n';
import { CopyButton } from './CopyButton';
import { Terminal } from './Terminal';
import { Reveal } from './Reveal';
import { HeroCommandCenter, AgentCockpit, WorkflowRail } from './Visuals';
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
    <div className={`eyebrow mb-4 ${className}`}>
      <span className="h-1.5 w-1.5 rounded-full bg-cyan pulse-dot" aria-hidden="true" />
      {children}
    </div>
  );
}

function SectionHead({
  kicker,
  title,
  body,
  align = 'center',
}: {
  kicker: string;
  title: string;
  body?: string;
  align?: 'center' | 'left';
}) {
  return (
    <Reveal
      className={`mb-10 max-w-3xl md:mb-12 ${align === 'center' ? 'mx-auto text-center' : ''}`}
    >
      <Eyebrow>{kicker}</Eyebrow>
      <h2 className="font-sans text-3xl font-bold leading-tight tracking-tight text-text md:text-4xl lg:text-5xl text-balance">
        {title}
      </h2>
      {body && <p className="mt-4 max-w-[65ch] text-lg leading-relaxed text-soft md:text-xl">{body}</p>}
    </Reveal>
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
const workflowIcons = [ResearchIcon, PlanIcon, GoalIcon, SwarmIcon, VerifyIcon, LearnIcon];
const memoryIcons = [CogIcon, MemoryIcon, DocsIcon];

export function Sections() {
  const { t } = useI18n();

  return (
    <main id="main">
      {/* Hero */}
      <section className="relative min-h-[100dvh] px-4 pb-20 pt-28 sm:px-6 lg:px-8">
        <div className="mx-auto max-w-7xl">
          <div className="grid grid-cols-1 items-stretch gap-8 lg:grid-cols-12">
            <Reveal stagger={1} className="flex flex-col justify-between lg:col-span-7">
              <div>
                <Eyebrow>{t.hero.eyebrow}</Eyebrow>
                <h1 className="max-w-[16ch] font-sans text-4xl font-bold leading-[1.02] tracking-tighter text-text sm:text-5xl lg:text-6xl xl:text-[4.25rem] text-balance">
                  {t.hero.h1}
                </h1>
                <p className="mt-6 max-w-[62ch] text-lg leading-relaxed text-soft md:text-xl">
                  {t.hero.lead}
                </p>
                <div className="mt-8 flex flex-wrap gap-3">
                  <a
                    href="#install"
                    className="btn btn-primary inline-flex items-center gap-2 rounded-full px-6 py-3 font-semibold"
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
                  <a
                    href="#ultra"
                    className="btn inline-flex items-center gap-2 rounded-full px-5 py-3 text-sm font-semibold text-soft transition hover:text-text"
                  >
                    {t.hero.secondary}
                  </a>
                </div>
              </div>

              <div className="mt-12 grid grid-cols-2 gap-3 sm:grid-cols-4">
                {t.hero.stats.map((stat) => (
                  <div key={stat.label} className="surface p-4">
                    <div className="font-mono text-xl font-semibold tracking-tight text-text sm:text-2xl">
                      {stat.value}
                    </div>
                    <div className="mt-1 text-[11px] uppercase tracking-[0.12em] text-muted">
                      {stat.label}
                    </div>
                  </div>
                ))}
              </div>
            </Reveal>

            <Reveal stagger={2} className="lg:col-span-5">
              <div className="hero-glow h-full">
                <HeroCommandCenter />
              </div>
            </Reveal>
          </div>

          <div className="mt-10 grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
            {t.hero.chips.map((chip, i) => {
              const Icon = [PlanIcon, SwarmIcon, MemoryIcon, BrowserIcon][i] ?? CogIcon;
              return (
                <Reveal key={chip.title} stagger={((i % 4) + 1) as 1 | 2 | 3 | 4}>
                  <SpotlightCard className="surface h-full p-5 card-hover">
                    <div className="relative z-10">
                      <div className="mb-3 flex items-center gap-2 text-sm font-semibold text-text">
                        <Icon className="h-4 w-4 text-cyan" />
                        {chip.title}
                      </div>
                      <p className="text-sm leading-relaxed text-soft">{chip.body}</p>
                    </div>
                  </SpotlightCard>
                </Reveal>
              );
            })}
          </div>
        </div>
      </section>

      {/* Problem */}
      <section id="problem" className="section-pad">
        <div className="mx-auto max-w-7xl">
          <SectionHead kicker={t.problem.kicker} title={t.problem.title} body={t.problem.body} />
          <div className="grid gap-4 md:grid-cols-2">
            {t.problem.cases.map((c, i) => {
              const Icon = problemIcons[i] ?? CogIcon;
              return (
                <SpotlightCard key={c.title} className="surface p-6 card-hover border-t border-t-cyan/35">
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
      <section id="solution" className="section-pad">
        <div className="mx-auto max-w-7xl">
          <div className="grid items-center gap-10 lg:grid-cols-12">
            <Reveal stagger={1} className="lg:col-span-5">
              <Eyebrow>{t.solution.kicker}</Eyebrow>
              <h2 className="font-sans text-3xl font-bold tracking-tight text-text md:text-4xl lg:text-5xl text-balance">
                {t.solution.title}
              </h2>
              <p className="mt-4 max-w-[55ch] text-lg leading-relaxed text-soft">{t.solution.body}</p>
              <div className="mt-6 inline-flex flex-wrap items-center gap-2 rounded-full border border-line bg-bg-2 px-4 py-2 text-sm text-soft">
                <CommandIcon className="h-3.5 w-3.5 text-cyan" />
                <span className="font-mono text-xs">{t.solution.note}</span>
              </div>
            </Reveal>
            <Reveal stagger={2} className="lg:col-span-7">
              <Terminal steps={t.terminal} />
            </Reveal>
          </div>
        </div>
      </section>

      {/* Ultra workflow */}
      <section id="ultra" className="section-pad">
        <div className="mx-auto max-w-7xl">
          <SectionHead kicker={t.ultra.kicker} title={t.ultra.title} body={t.ultra.body} />

          <Reveal className="mb-10">
            <WorkflowRail steps={t.ultra.steps} />
          </Reveal>

          <div className="grid items-start gap-8 lg:grid-cols-12">
            <Reveal stagger={1} className="lg:col-span-5">
              <div className="surface p-7">
                <Eyebrow>{t.ultra.copyTitle}</Eyebrow>
                <p className="mt-4 text-lg leading-relaxed text-soft">{t.ultra.copyBody}</p>
                <ul className="mt-6 space-y-3 text-soft">
                  {t.ultra.copyList.map((item) => (
                    <li key={item} className="flex gap-3 text-sm leading-relaxed">
                      <span className="mt-1 text-cyan" aria-hidden="true">
                        ›
                      </span>
                      <span>{item}</span>
                    </li>
                  ))}
                </ul>
              </div>
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
      <section id="harness" className="section-pad">
        <div className="mx-auto max-w-7xl">
          <SectionHead kicker={t.harness.kicker} title={t.harness.title} body={t.harness.body} />
          <div className="grid items-center gap-10 lg:grid-cols-12">
            <Reveal stagger={1} className="lg:col-span-7">
              <div className="h-[360px] lg:h-[420px]">
                <AgentCockpit />
              </div>
            </Reveal>
            <Reveal stagger={2} className="lg:col-span-5">
              <h3 className="font-sans text-2xl font-bold tracking-tight text-text md:text-3xl">
                {t.harness.copyTitle}
              </h3>
              <p className="mt-4 text-lg leading-relaxed text-soft">{t.harness.copyBody}</p>
              <ul className="mt-6 space-y-3 text-soft">
                {t.harness.copyList.map((item) => (
                  <li key={item} className="flex gap-3 text-sm leading-relaxed">
                    <span className="mt-1 text-cyan" aria-hidden="true">
                      ›
                    </span>
                    <span>{item}</span>
                  </li>
                ))}
              </ul>
            </Reveal>
          </div>
        </div>
      </section>

      {/* Memory */}
      <section id="memory" className="section-pad">
        <div className="mx-auto max-w-7xl">
          <SectionHead kicker={t.memory.kicker} title={t.memory.title} body={t.memory.body} />
          <div className="grid gap-5 lg:grid-cols-3">
            {t.memory.cards.map((card, i) => {
              const Icon = memoryIcons[i] ?? CogIcon;
              const accents = [
                'border-t-cyan/40',
                'border-t-emerald/40',
                'border-t-amber/40',
              ];
              return (
                <SpotlightCard key={card.title} className={`surface p-6 card-hover border-t-2 ${accents[i]}`}>
                  <div className="relative z-10">
                    <div className="mb-4 inline-flex rounded-lg bg-cyan/10 p-2 text-cyan">
                      <Icon className="h-5 w-5" />
                    </div>
                    <h3 className="font-sans text-lg font-semibold text-text">{card.title}</h3>
                    <p className="mt-2 text-sm leading-relaxed text-soft">{card.body}</p>
                  </div>
                </SpotlightCard>
              );
            })}
          </div>
        </div>
      </section>

      {/* Themes */}
      <section id="themes" className="section-pad">
        <div className="mx-auto max-w-7xl">
          <SectionHead kicker={t.themes.kicker} title={t.themes.title} body={t.themes.body} />
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {t.themes.cards.map((card) => (
              <SpotlightCard key={card.title} className="surface p-5 card-hover">
                <div className="relative z-10">
                  <div className="mb-4 flex gap-1.5">
                    {card.swatches.map((hex) => (
                      <span
                        key={hex}
                        className="h-7 w-7 rounded-full border border-white/10 shadow-sm"
                        style={{ backgroundColor: hex }}
                        title={hex}
                      />
                    ))}
                  </div>
                  <h3 className="font-sans text-lg font-semibold text-text">{card.title}</h3>
                  <p className="mt-1 text-sm leading-relaxed text-soft">{card.body}</p>
                </div>
              </SpotlightCard>
            ))}
          </div>
        </div>
      </section>

      {/* Capabilities bento */}
      <section id="capabilities" className="section-pad">
        <div className="mx-auto max-w-7xl">
          <SectionHead
            kicker={t.capabilities.kicker}
            title={t.capabilities.title}
            body={t.capabilities.body}
          />
          <div className="grid auto-rows-fr grid-cols-1 gap-4 md:grid-cols-6">
            {t.capabilities.items.map((item, i) => {
              const Icon = capabilityIcons[i] ?? CogIcon;
              // Mixed spans — avoid equal 3-col stock layout
              const spanClass = [
                'md:col-span-3',
                'md:col-span-3',
                'md:col-span-2',
                'md:col-span-4',
                'md:col-span-4',
                'md:col-span-2',
                'md:col-span-3',
                'md:col-span-3',
                'md:col-span-2',
                'md:col-span-2',
                'md:col-span-2',
                'md:col-span-6',
              ][i] ?? 'md:col-span-2';
              return (
                <Reveal key={item.title} stagger={((i % 6) + 1) as 1 | 2 | 3 | 4 | 5 | 6} className={spanClass}>
                  <SpotlightCard className="surface h-full p-6 card-hover">
                    <div className="relative z-10 flex h-full flex-col">
                      <div className="mb-4 flex items-center justify-between gap-3">
                        <div className="inline-flex rounded-lg bg-cyan/10 p-2 text-cyan">
                          <Icon className="h-5 w-5" />
                        </div>
                        <span className="rounded-full border border-line bg-bg-3 px-2.5 py-0.5 font-mono text-[10px] uppercase tracking-[0.14em] text-muted">
                          {item.tag}
                        </span>
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
      <section id="install" className="section-pad">
        <div className="mx-auto max-w-7xl">
          <Reveal>
            <div className="surface overflow-hidden p-8 sm:p-12">
              <div className="grid gap-10 lg:grid-cols-2">
                <div>
                  <Eyebrow>{t.install.kicker}</Eyebrow>
                  <h2 className="font-sans text-3xl font-bold tracking-tight text-text md:text-4xl text-balance">
                    {t.install.title}
                  </h2>
                  <p className="mt-4 max-w-xl text-lg leading-relaxed text-soft">{t.install.body}</p>
                  <p className="mt-3 font-mono text-xs text-muted">{t.install.requirements}</p>
                  <a
                    href="https://github.com/claudianus/superliora"
                    className="btn btn-primary mt-6 inline-flex items-center gap-2 rounded-full px-6 py-3 font-semibold"
                  >
                    <GithubIcon className="h-4 w-4" />
                    {t.install.cta}
                  </a>
                </div>
                <div className="space-y-3">
                  {t.install.commands.map((c) => (
                    <div
                      key={c.label}
                      className="relative overflow-hidden rounded-xl border border-line bg-bg-1 p-4 shimmer"
                    >
                      <div className="mb-2 flex items-center justify-between gap-3">
                        <span className="font-mono text-[11px] uppercase tracking-[0.12em] text-muted">
                          {c.label}
                        </span>
                        <CopyButton text={c.cmd} />
                      </div>
                      <div className="pr-10 font-mono text-sm leading-relaxed text-text">
                        <span className="text-amber">$</span> {c.cmd}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </Reveal>
        </div>
      </section>

      {/* CTA */}
      <section className="section-pad pt-0">
        <div className="mx-auto max-w-4xl text-center">
          <Reveal>
            <div className="glass cta-glow relative overflow-hidden rounded-3xl p-10 sm:p-14">
              <div className="pointer-events-none absolute -left-10 top-0 h-40 w-40 rounded-full bg-cyan/15 blur-3xl" />
              <div className="pointer-events-none absolute -right-8 bottom-0 h-36 w-36 rounded-full bg-rose/10 blur-3xl" />
              <h2 className="relative font-sans text-3xl font-bold tracking-tight text-text md:text-4xl lg:text-5xl text-balance">
                {t.cta.title}
              </h2>
              <p className="relative mx-auto mt-4 max-w-[55ch] text-lg leading-relaxed text-soft">
                {t.cta.body}
              </p>
              <div className="relative mt-8 flex flex-wrap justify-center gap-4">
                <a
                  href="#install"
                  className="btn btn-primary inline-flex items-center gap-2 rounded-full px-6 py-3 font-semibold"
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
