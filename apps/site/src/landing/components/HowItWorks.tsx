import { CornerDownRight } from "lucide-react";
import { useLocale } from "../i18n";
import { Reveal, SectionHead, icons } from "./shared";

function Drop({ className = "" }: { className?: string }) {
  return <div aria-hidden className={`mx-auto h-8 w-px bg-gradient-to-b from-primary/60 to-primary/15 ${className}`} />;
}

/* One trunk splitting into two branches — the conductor reaching both tools. */
function Split() {
  return (
    <div aria-hidden className="relative hidden h-10 md:block">
      <span className="absolute top-0 left-1/2 h-1/2 w-px -translate-x-1/2 bg-primary/50" />
      <span className="absolute top-1/2 right-1/4 left-1/4 h-px bg-primary/40" />
      <span className="absolute top-1/2 left-1/4 h-1/2 w-px bg-primary/40" />
      <span className="absolute top-1/2 right-1/4 h-1/2 w-px bg-primary/40" />
    </div>
  );
}

export default function HowItWorks() {
  const { t } = useLocale();
  const h = t.how;

  return (
    <section id="how" className="staff-bg relative scroll-mt-20 py-28 sm:py-36">
      <div className="mx-auto max-w-6xl px-5">
        <SectionHead eyebrow={h.eyebrow} title={h.title} lede={h.lede} />

        {/* the mechanism */}
        <div className="mx-auto mt-16 max-w-4xl">
          <Reveal>
            <div className="mx-auto flex w-fit max-w-full flex-col items-center gap-1.5 rounded-2xl border border-line bg-panel px-5 py-3 text-center">
              <span className="font-[family-name:var(--font-mono)] text-[10px] tracking-[0.24em] text-faint uppercase">{h.you}</span>
              <span className="text-[14px] text-ink">{h.youPrompt}</span>
            </div>
          </Reveal>
          <Drop />
          <Reveal i={1}>
            <div className="mx-auto max-w-xl rounded-2xl border border-primary/40 bg-primary/[0.05] px-6 py-4 text-center shadow-[0_0_60px_-24px_rgba(0,213,255,0.5)]">
              <p className="font-[family-name:var(--font-display)] text-[17px] font-semibold text-ink">{h.conductor.title}</p>
              <p className="mt-1.5 text-[13px] leading-6 text-dim">{h.conductor.body}</p>
            </div>
          </Reveal>
          <Split />
          <Drop className="md:hidden" />

          <div className="grid gap-5 md:grid-cols-2">
            {h.tools.map((tool, i) => (
              <Reveal key={tool.name} i={i + 2} className="min-w-0">
                <article className="flex h-full flex-col rounded-2xl border border-line bg-panel p-6">
                  <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <h3 className="font-[family-name:var(--font-mono)] text-[18px] font-semibold text-primary">{tool.name}</h3>
                    <span className="font-[family-name:var(--font-mono)] text-[10.5px] text-faint">{tool.tag}</span>
                  </div>
                  <p className="mt-3 text-[13.5px] leading-[1.75] text-dim">{tool.body}</p>
                  <pre className="tui mt-5 overflow-x-auto rounded-xl px-4 py-3 font-[family-name:var(--font-mono)] text-[11.5px] leading-[1.7] text-dim">
                    {tool.sample.map((line) => (
                      <span key={line} className={line.startsWith("→") ? "block text-azure" : "block"}>
                        {line}
                      </span>
                    ))}
                  </pre>
                  <p className="mt-auto flex items-center gap-2 pt-5 font-[family-name:var(--font-mono)] text-[11px] text-ink">
                    <CornerDownRight className="size-3.5 text-primary" />
                    {tool.lands}
                  </p>
                </article>
              </Reveal>
            ))}
          </div>

          {/* operator band: controls the model cannot reach */}
          <Reveal i={2}>
            <div className="mt-5 overflow-hidden rounded-2xl border border-dashed border-line-strong">
              <p className="border-b border-dashed border-line-strong px-6 py-3 font-[family-name:var(--font-mono)] text-[10.5px] tracking-[0.2em] text-faint uppercase">
                {h.operator.label}
              </p>
              <div className="grid gap-px bg-line/50 sm:grid-cols-2 lg:grid-cols-4">
                {h.operator.items.map((item) => {
                  const Icon = icons[item.icon];
                  return (
                    <div key={item.title} className="bg-paper px-5 py-5">
                      <p className="flex items-center gap-2 text-[13.5px] font-semibold text-ink">
                        <Icon className="size-4 text-mint" />
                        {item.title}
                      </p>
                      <p className="mt-2 text-[12.5px] leading-[1.7] text-dim">{item.body}</p>
                    </div>
                  );
                })}
              </div>
            </div>
          </Reveal>
        </div>

        {/* the loop, in four beats */}
        <div className="mt-20 grid gap-px overflow-hidden rounded-2xl border border-line bg-line sm:grid-cols-2 lg:grid-cols-4">
          {h.steps.map((s, i) => (
            <Reveal key={s.no} i={i} className="bg-panel">
              <article className="flex h-full flex-col p-6">
                <div className="flex items-center gap-3">
                  <span className="flex size-7 items-center justify-center rounded-full border border-primary/60 font-[family-name:var(--font-mono)] text-[11px] text-primary">
                    {s.no}
                  </span>
                  <h3 className="font-[family-name:var(--font-display)] text-[17px] font-semibold text-ink">{s.title}</h3>
                </div>
                <p className="mt-4 flex-1 text-[13px] leading-[1.75] text-dim">{s.body}</p>
                <p className="mt-5 font-[family-name:var(--font-mono)] text-[10.5px] text-faint">{s.foot}</p>
              </article>
            </Reveal>
          ))}
        </div>
      </div>
    </section>
  );
}
