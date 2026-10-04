import { ArrowRight } from "lucide-react";
import { useLocale } from "../i18n";
import { PROVIDER_CATALOG } from "../../data/provider-catalog.generated";
import { Reveal, SectionHead, fill, icons } from "./shared";

export default function Features() {
  const { t, locale } = useLocale();
  const f = t.features;
  const fmt = new Intl.NumberFormat(locale === "ko" ? "ko-KR" : "en-US");
  const chips = PROVIDER_CATALOG.providers;
  const rest = PROVIDER_CATALOG.providerCount - chips.length;

  return (
    <section id="features" className="relative scroll-mt-20 border-t border-line py-28 sm:py-36">
      <div className="mx-auto max-w-6xl px-5">
        <SectionHead eyebrow={f.eyebrow} title={f.title} lede={f.lede} />

        <div className="mt-14 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {f.cards.map((c, i) => {
            const Icon = icons[c.icon];
            return (
              <Reveal key={c.title} i={i % 3}>
                <article className="group flex h-full flex-col rounded-2xl border border-line bg-panel p-7 transition-colors duration-500 hover:border-primary/35">
                  <span className="flex size-9 items-center justify-center rounded-lg border border-line bg-black/30 text-primary transition-transform duration-500 group-hover:-rotate-6 group-hover:scale-105">
                    <Icon className="size-4" />
                  </span>
                  <h3 className="mt-6 font-[family-name:var(--font-display)] text-[19px] font-semibold tracking-[-0.01em] text-ink">{c.title}</h3>
                  <p className="mt-3 flex-1 text-[13.5px] leading-[1.8] text-dim">{c.body}</p>
                  <p className="mt-6 border-t border-line pt-4 font-[family-name:var(--font-mono)] text-[10.5px] leading-relaxed text-faint">{c.foot}</p>
                </article>
              </Reveal>
            );
          })}
        </div>

        {/* native Job lifecycle */}
        <Reveal i={1}>
          <div className="mt-5 overflow-hidden rounded-2xl border border-line bg-panel">
            <div className="flex items-center justify-between border-b border-line px-6 py-3.5">
              <p className="font-[family-name:var(--font-mono)] text-[10.5px] tracking-[0.2em] text-faint uppercase">{f.lifecycle.label}</p>
              <span className="font-[family-name:var(--font-mono)] text-[10px] text-mint">{f.lifecycle.badge}</span>
            </div>
            <div className="grid gap-px bg-line sm:grid-cols-2 lg:grid-cols-5">
              {f.lifecycle.steps.map((s, i) => (
                <div key={s.tag} className="relative bg-panel px-5 py-5">
                  <span
                    className={
                      i === f.lifecycle.steps.length - 1
                        ? "inline-flex rounded border border-mint/50 px-2 py-0.5 font-[family-name:var(--font-mono)] text-[10px] text-mint"
                        : "inline-flex rounded border border-primary/50 px-2 py-0.5 font-[family-name:var(--font-mono)] text-[10px] text-primary"
                    }
                  >
                    {s.tag}
                  </span>
                  <p className="mt-3 font-[family-name:var(--font-mono)] text-[11.5px] leading-relaxed text-dim">{s.text}</p>
                  {i < f.lifecycle.steps.length - 1 && (
                    <ArrowRight className="absolute top-1/2 -right-2.5 z-10 hidden size-4 -translate-y-1/2 rounded-full border border-line bg-panel p-0.5 text-primary lg:block" />
                  )}
                </div>
              ))}
            </div>
          </div>
        </Reveal>

        {/* provider strip — generated from the models.dev catalog /login reads */}
        <Reveal i={2}>
          <p className="mt-16 mb-2 text-center font-[family-name:var(--font-mono)] text-[10.5px] tracking-[0.2em] text-faint uppercase">
            {f.providers.label}
          </p>
          <p className="mb-5 text-center font-[family-name:var(--font-mono)] text-[11px] text-dim">
            {fill(f.providers.note, {
              providers: fmt.format(PROVIDER_CATALOG.providerCount),
              models: fmt.format(PROVIDER_CATALOG.modelCount),
              date: PROVIDER_CATALOG.snapshotDate,
            })}
          </p>
        </Reveal>
        <div className="relative -mx-5 overflow-hidden" style={{ maskImage: "linear-gradient(90deg,transparent,black 12%,black 88%,transparent)" }}>
          <div className="marq flex w-max">
            {[0, 1].map((copy) => (
              <div key={copy} className="flex shrink-0 gap-3 pr-3" aria-hidden={copy === 1}>
                {chips.map((chip) => (
                  <span
                    key={chip.name}
                    className="flex shrink-0 items-center gap-2.5 rounded-full border border-line bg-panel px-5 py-2.5 font-[family-name:var(--font-mono)] text-[12px] text-dim"
                  >
                    <span className="size-1.5 rounded-full bg-mint/80" />
                    {chip.name}
                    <span className="text-faint">{chip.models}</span>
                  </span>
                ))}
                <span className="flex shrink-0 items-center rounded-full border border-dashed border-line px-5 py-2.5 font-[family-name:var(--font-mono)] text-[12px] text-faint">
                  {fill(f.providers.more, { n: fmt.format(rest) })}
                </span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}
