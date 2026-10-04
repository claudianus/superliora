import { useEffect, useState } from "react";
import { ArrowUpRight, Check, Copy } from "lucide-react";
import { useLocale } from "../i18n";
import { INSTALL_PS, INSTALL_SH } from "../../content";
import { REPO_URL, Reveal, docsHref, fill, providerFloor, useCopy } from "./shared";
import { cn } from "../utils/cn";
import TuiEmulator from "../tui/TuiEmulator";

type Os = "unix" | "windows";

export default function Hero() {
  const { t, locale } = useLocale();
  const { copied, copy } = useCopy();
  const [os, setOs] = useState<Os>("unix");
  // Windows visitors land on the PowerShell line; everyone else keeps install.sh.
  useEffect(() => {
    if (/windows/i.test(navigator.userAgent)) setOs("windows");
  }, []);
  const installCmd = os === "windows" ? INSTALL_PS : INSTALL_SH;

  return (
    <section id="top" className="relative overflow-hidden pt-[60px]">
      {/* backdrop */}
      <div className="grid-bg absolute inset-0" />
      <div
        className="pointer-events-none absolute -top-40 left-1/2 h-[560px] w-[900px] -translate-x-1/2 rounded-full opacity-60"
        style={{ background: "radial-gradient(ellipse at center, rgba(0,213,255,0.10), transparent 62%)" }}
      />

      <div className="relative mx-auto max-w-6xl px-5">
        {/* accent divider */}
        <div className="relative mx-auto mt-10 h-px max-w-3xl bg-line">
          <span className="beat-dot absolute -top-[2.5px] left-0 size-[6px] rounded-full bg-primary shadow-[0_0_12px_rgba(0,213,255,0.9)]" />
        </div>

        <div className="pt-14 pb-10 text-center sm:pt-20">
          <Reveal>
            <p className="font-[family-name:var(--font-mono)] text-[11px] tracking-[0.18em] text-primary uppercase sm:tracking-[0.3em]">
              {t.hero.eyebrow}
            </p>
          </Reveal>

          <Reveal i={1}>
            <h1 className="mx-auto mt-6 max-w-4xl text-balance break-keep font-[family-name:var(--font-display)] text-[42px] leading-[1.05] font-semibold tracking-[-0.028em] text-ink sm:text-6xl md:text-[72px]">
              {t.hero.titleA}
              <br />
              <span className="brand-text">{t.hero.titleB}</span>
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
              <div className="mb-2.5 flex items-center gap-1" role="tablist" aria-label="OS">
                {(["unix", "windows"] as const).map((o) => (
                  <button
                    key={o}
                    role="tab"
                    aria-selected={os === o}
                    onClick={() => setOs(o)}
                    className={cn(
                      "rounded-md px-2.5 py-1 font-[family-name:var(--font-mono)] text-[10.5px] tracking-[0.12em] uppercase transition-colors",
                      os === o ? "bg-white/[0.06] text-primary" : "text-faint hover:text-dim",
                    )}
                  >
                    {t.hero.osTabs[o]}
                  </button>
                ))}
              </div>
              <div className="group flex items-stretch overflow-hidden rounded-xl border border-line bg-panel/90 shadow-[0_20px_60px_-30px_rgba(0,0,0,0.9)] transition-colors hover:border-primary/40">
                <div className="flex min-w-0 flex-1 items-center gap-2.5 px-4 py-3.5">
                  <span className="shrink-0 font-[family-name:var(--font-mono)] text-[13px] text-primary">{os === "windows" ? ">" : "$"}</span>
                  <code className="truncate font-[family-name:var(--font-mono)] text-[12.5px] text-ink/90">{installCmd}</code>
                </div>
                <button
                  onClick={() => void copy(installCmd)}
                  className="flex w-[86px] shrink-0 items-center justify-center gap-1.5 border-l border-line bg-white/[0.03] text-[12px] text-dim transition-colors hover:bg-primary hover:text-black"
                >
                  {copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
                  {copied ? t.hero.copied : t.hero.copy}
                </button>
              </div>
              <p className="mt-3 text-left font-[family-name:var(--font-mono)] text-[10.5px] leading-relaxed text-faint">
                {t.hero.installNote}
              </p>
            </div>
          </Reveal>

          <Reveal i={4}>
            <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
              <a
                href={docsHref(locale)}
                className="btn-primary rounded-full px-6 py-3 text-[13.5px] font-semibold text-black transition-transform hover:scale-[1.02]"
              >
                {t.hero.cta1}
              </a>
              <a
                href={REPO_URL}
                target="_blank"
                rel="noreferrer"
                className="flex items-center gap-1.5 rounded-full border border-line px-6 py-3 text-[13.5px] text-dim transition-colors hover:border-primary/50 hover:text-ink"
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
              style={{ background: "radial-gradient(50% 50% at 50% 50%, rgba(0,213,255,0.09), transparent 70%)" }}
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
                <p className="mt-2 font-[family-name:var(--font-mono)] text-[16px] text-ink">{fill(s.v, { providers: providerFloor() })}</p>
              </div>
            </Reveal>
          ))}
        </div>
      </div>
    </section>
  );
}
