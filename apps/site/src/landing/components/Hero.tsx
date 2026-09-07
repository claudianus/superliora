import { ArrowUpRight, Check, Copy } from "lucide-react";
import { useLocale } from "../i18n";
import { Reveal, useCopy } from "./shared";
import TuiEmulator from "../tui/TuiEmulator";

export default function Hero() {
  const { t } = useLocale();
  const { copied, copy } = useCopy();

  return (
    <section id="top" className="relative overflow-hidden pt-[60px]">
      {/* backdrop */}
      <div className="grid-bg absolute inset-0" />
      <div
        className="pointer-events-none absolute -top-40 left-1/2 h-[560px] w-[900px] -translate-x-1/2 rounded-full opacity-60"
        style={{ background: "radial-gradient(ellipse at center, rgba(242,185,75,0.10), transparent 62%)" }}
      />

      <div className="relative mx-auto max-w-6xl px-5">
        {/* baton beat divider */}
        <div className="relative mx-auto mt-10 h-px max-w-3xl bg-line">
          <span className="beat-dot absolute -top-[2.5px] left-0 size-[6px] rounded-full bg-gold shadow-[0_0_12px_rgba(242,185,75,0.9)]" />
        </div>

        <div className="pt-14 pb-10 text-center sm:pt-20">
          <Reveal>
            <p className="font-[family-name:var(--font-mono)] text-[11px] tracking-[0.3em] text-gold uppercase">
              {t.hero.eyebrow}
            </p>
          </Reveal>

          <Reveal i={1}>
            <h1 className="mx-auto mt-6 max-w-4xl font-[family-name:var(--font-display)] text-[42px] leading-[1.05] font-semibold tracking-[-0.028em] text-ink sm:text-6xl md:text-[72px]">
              {t.hero.titleA}
              <br />
              <span className="gold-text">{t.hero.titleB}</span>
            </h1>
          </Reveal>

          <Reveal i={2}>
            <p className="mx-auto mt-7 max-w-2xl text-[15.5px] leading-[1.75] text-dim sm:text-[16.5px]">
              {t.hero.sub}
            </p>
          </Reveal>

          {/* install bar */}
          <Reveal i={3}>
            <div className="mx-auto mt-10 max-w-2xl">
              <p className="mb-2.5 text-left font-[family-name:var(--font-mono)] text-[10.5px] tracking-[0.2em] text-faint uppercase">
                {t.hero.installLabel}
              </p>
              <div className="group flex items-stretch overflow-hidden rounded-xl border border-line bg-panel/90 shadow-[0_20px_60px_-30px_rgba(0,0,0,0.9)] transition-colors hover:border-gold/40">
                <div className="flex min-w-0 flex-1 items-center gap-2.5 px-4 py-3.5">
                  <span className="shrink-0 font-[family-name:var(--font-mono)] text-[13px] text-gold">$</span>
                  <code className="truncate font-[family-name:var(--font-mono)] text-[12.5px] text-ink/90">
                    {t.hero.installCmd}
                  </code>
                </div>
                <button
                  onClick={() => void copy(t.hero.installCmd)}
                  className="flex w-[86px] shrink-0 items-center justify-center gap-1.5 border-l border-line bg-white/[0.03] text-[12px] text-dim transition-colors hover:bg-gold hover:text-black"
                >
                  {copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
                  {copied ? t.hero.copied : t.hero.copy}
                </button>
              </div>
              <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
                <p className="font-[family-name:var(--font-mono)] text-[10.5px] text-faint">{t.hero.nodeNote}</p>
                <div className="flex items-center gap-1.5">
                  {t.hero.platforms.map((p) => (
                    <span
                      key={p}
                      className="rounded border border-line px-1.5 py-0.5 font-[family-name:var(--font-mono)] text-[10px] text-faint"
                    >
                      {p}
                    </span>
                  ))}
                </div>
              </div>
            </div>
          </Reveal>

          <Reveal i={4}>
            <div className="mt-8 flex items-center justify-center gap-3">
              <a
                href="#install"
                className="btn-gold rounded-full px-6 py-3 text-[13.5px] font-semibold text-black transition-transform hover:scale-[1.02]"
              >
                {t.hero.cta1}
              </a>
              <a
                href="https://github.com/claudianus/superliora"
                target="_blank"
                rel="noreferrer"
                className="flex items-center gap-1.5 rounded-full border border-line px-6 py-3 text-[13.5px] text-dim transition-colors hover:border-gold/50 hover:text-ink"
              >
                {t.hero.cta2}
                <ArrowUpRight className="size-3.5" />
              </a>
            </div>
          </Reveal>
        </div>

        {/* the terminal */}
        <Reveal i={2} className="relative">
          <div className="floaty relative mx-auto max-w-[880px]">
            <div
              className="pointer-events-none absolute -inset-8 rounded-[32px] opacity-70 blur-2xl"
              style={{ background: "radial-gradient(50% 50% at 50% 50%, rgba(242,185,75,0.09), transparent 70%)" }}
            />
            <TuiEmulator className="relative" />
            <p className="mt-4 text-center font-[family-name:var(--font-mono)] text-[10.5px] tracking-wide text-faint">
              {t.tui.replayNote}
            </p>
          </div>
        </Reveal>

        {/* stats */}
        <div className="mt-16 grid grid-cols-2 gap-px overflow-hidden rounded-2xl border border-line bg-line sm:mt-20 lg:grid-cols-4">
          {t.hero.stats.map((s, i) => (
            <Reveal key={s.k} i={i} className="bg-panel">
              <div className="px-6 py-6">
                <p className="font-[family-name:var(--font-mono)] text-[10.5px] tracking-[0.18em] text-faint uppercase">
                  {s.k}
                </p>
                <p className="mt-2 font-[family-name:var(--font-mono)] text-[17px] text-ink">{s.v}</p>
              </div>
            </Reveal>
          ))}
        </div>
      </div>
    </section>
  );
}
