import type { ComponentType } from "react";
import { Activity, ArrowRight, Command, Compass, Gauge, HeartPulse, Route } from "lucide-react";
import { useLocale } from "../i18n";
import { Reveal, SectionHead } from "./shared";
import { cn } from "../utils/cn";

const icons: Record<string, ComponentType<{ className?: string }>> = {
  command: Command,
  "heart-pulse": HeartPulse,
  route: Route,
  activity: Activity,
  gauge: Gauge,
  compass: Compass,
};

const stepTone: Record<string, string> = {
  red: "border-red/50 text-red",
  gold: "border-gold/50 text-gold",
  mint: "border-mint/50 text-mint",
};

export default function Systems() {
  const { t } = useLocale();

  return (
    <section id="systems" className="relative scroll-mt-20 border-t border-line py-28 sm:py-36">
      <div className="mx-auto max-w-6xl px-5">
        <SectionHead eyebrow={t.systems.eyebrow} title={t.systems.title} lede={t.systems.lede} />

        <div className="mt-14 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {t.systems.cards.map((c, i) => {
            const Icon = icons[c.icon] ?? Command;
            return (
              <Reveal key={c.no} i={i % 3}>
                <article className="group flex h-full flex-col rounded-2xl border border-line bg-panel p-7 transition-colors duration-500 hover:border-gold/35">
                  <div className="flex items-center justify-between">
                    <span className="font-[family-name:var(--font-mono)] text-[10.5px] tracking-[0.22em] text-faint">
                      {c.no}
                    </span>
                    <span className="flex size-9 items-center justify-center rounded-lg border border-line bg-black/30 text-gold transition-transform duration-500 group-hover:-rotate-6 group-hover:scale-105">
                      <Icon className="size-4" />
                    </span>
                  </div>
                  <h3 className="mt-6 font-[family-name:var(--font-display)] text-[19px] font-semibold tracking-[-0.01em] text-ink">
                    {c.title}
                  </h3>
                  <p className="mt-3 flex-1 text-[13.5px] leading-[1.8] text-dim">{c.body}</p>
                  <p className="mt-6 border-t border-line pt-4 font-[family-name:var(--font-mono)] text-[10.5px] leading-relaxed text-faint">
                    {c.foot}
                  </p>
                </article>
              </Reveal>
            );
          })}
        </div>

        {/* Never-Halt chain */}
        <Reveal i={1}>
          <div className="mt-5 overflow-hidden rounded-2xl border border-line bg-panel">
            <div className="flex items-center justify-between border-b border-line px-6 py-3.5">
              <p className="font-[family-name:var(--font-mono)] text-[10.5px] tracking-[0.2em] text-faint uppercase">
                {t.systems.failover.label}
              </p>
              <span className="flex items-center gap-2 font-[family-name:var(--font-mono)] text-[10px] text-gold">
                <HeartPulse className="size-3.5" />
                Never-Halt
              </span>
            </div>
            <div className="grid gap-px bg-line sm:grid-cols-4">
              {t.systems.failover.steps.map((s, i) => (
                <div key={s.tag} className="relative bg-panel px-5 py-5">
                  <div className={cn("inline-flex items-center gap-2 rounded border px-2 py-0.5 font-[family-name:var(--font-mono)] text-[10px]", stepTone[s.cls])}>
                    {s.tag}
                  </div>
                  <p className="mt-3 font-[family-name:var(--font-mono)] text-[11.5px] leading-relaxed text-dim">
                    {s.text}
                  </p>
                  {i < t.systems.failover.steps.length - 1 && (
                    <ArrowRight className="absolute top-1/2 -right-2.5 z-10 hidden size-4 -translate-y-1/2 rounded-full border border-line bg-panel p-0.5 text-gold sm:block" />
                  )}
                </div>
              ))}
            </div>
          </div>
        </Reveal>

        {/* provider marquee */}
        <Reveal i={2}>
          <p className="mt-14 mb-5 text-center font-[family-name:var(--font-mono)] text-[10.5px] tracking-[0.2em] text-faint uppercase">
            {t.systems.providersLabel}
          </p>
        </Reveal>
        <div className="relative -mx-5 overflow-hidden" style={{ maskImage: "linear-gradient(90deg,transparent,black 12%,black 88%,transparent)" }}>
          <div className="marq flex w-max gap-3 pr-3">
            {[...t.systems.providers, ...t.systems.providers].map((p, i) => (
              <span
                key={`${p}-${i}`}
                className="flex shrink-0 items-center gap-2.5 rounded-full border border-line bg-panel px-5 py-2.5 font-[family-name:var(--font-mono)] text-[12px] text-dim"
              >
                <span className="size-1.5 rounded-full bg-mint/80" />
                {p}
              </span>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}
