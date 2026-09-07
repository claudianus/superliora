import { useLocale } from "../i18n";
import { Reveal, SectionHead } from "./shared";

export default function Flow() {
  const { t } = useLocale();

  return (
    <section id="flow" className="staff-bg relative scroll-mt-20 py-28 sm:py-36">
      <div className="mx-auto max-w-6xl px-5">
        <SectionHead eyebrow={t.flow.eyebrow} title={t.flow.title} lede={t.flow.lede} />

        {/* progress rail */}
        <Reveal i={2} className="mt-14 hidden md:block">
          <div className="relative flex items-center justify-between">
            <div className="absolute inset-x-0 top-1/2 h-px -translate-y-1/2 bg-gradient-to-r from-transparent via-gold/40 to-transparent" />
            {t.flow.railLabels.map((label, i) => (
              <div key={label} className="relative flex items-center gap-2.5 bg-paper px-3 py-1">
                <span
                  className="size-[7px] rounded-full border border-gold/70"
                  style={{ background: i === 0 ? "var(--color-gold)" : "transparent" }}
                />
                <span className="font-[family-name:var(--font-mono)] text-[10.5px] tracking-[0.22em] text-dim uppercase">
                  {label}
                </span>
              </div>
            ))}
          </div>
        </Reveal>

        <div className="mt-12 grid gap-5 md:grid-cols-2">
          {t.flow.steps.map((s, i) => (
            <Reveal key={s.no} i={i} className={i % 2 === 1 ? "md:translate-y-10" : ""}>
              <article className="group relative h-full overflow-hidden rounded-2xl border border-line bg-panel p-7 transition-colors duration-500 hover:border-gold/35 sm:p-9">
                <span
                  aria-hidden
                  className="pointer-events-none absolute -top-7 right-4 font-[family-name:var(--font-display)] text-[120px] leading-none font-semibold text-transparent transition-colors duration-500 group-hover:text-gold/10 sm:text-[150px]"
                  style={{ WebkitTextStroke: "1px rgba(236,231,220,0.10)" }}
                >
                  {s.no}
                </span>
                <p className="font-[family-name:var(--font-mono)] text-[11px] tracking-[0.25em] text-gold">{s.no}</p>
                <h3 className="mt-4 font-[family-name:var(--font-display)] text-[22px] font-semibold tracking-[-0.01em] text-ink sm:text-2xl">
                  {s.title}
                </h3>
                <p className="mt-4 max-w-md text-[14.5px] leading-[1.8] text-dim">{s.body}</p>
                <p className="mt-6 inline-block rounded-md border border-line bg-black/30 px-2.5 py-1.5 font-[family-name:var(--font-mono)] text-[11px] text-faint">
                  {s.foot}
                </p>
              </article>
            </Reveal>
          ))}
        </div>
      </div>
    </section>
  );
}
