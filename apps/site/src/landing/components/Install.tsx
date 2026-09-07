import { useState } from "react";
import { ArrowRight, Check, Copy } from "lucide-react";
import { useLocale } from "../i18n";
import { Reveal, SectionHead, useCopy } from "./shared";
import { cn } from "../utils/cn";

export default function Install() {
  const { t } = useLocale();
  const [tab, setTab] = useState(0);
  const { copied, copy } = useCopy();

  return (
    <section id="install" className="relative scroll-mt-20 border-t border-line py-28 sm:py-36">
      <div
        className="pointer-events-none absolute inset-x-0 top-0 h-px"
        style={{ background: "linear-gradient(90deg,transparent,rgba(242,185,75,0.4),transparent)" }}
      />
      <div className="mx-auto max-w-6xl px-5">
        <SectionHead eyebrow={t.install.eyebrow} title={t.install.title} lede={t.install.lede} align="center" />

        <Reveal i={2}>
          <div className="mx-auto mt-12 max-w-3xl">
            <div className="flex flex-wrap justify-center gap-2">
              {t.install.tabs.map((label, i) => (
                <button
                  key={label}
                  onClick={() => setTab(i)}
                  className={cn(
                    "rounded-full border px-4.5 py-2 font-[family-name:var(--font-mono)] text-[12px] transition-all",
                    tab === i
                      ? "border-gold bg-gold/10 text-gold"
                      : "border-line text-faint hover:border-gold/40 hover:text-dim",
                  )}
                >
                  {label}
                </button>
              ))}
            </div>

            <div className="group mt-5 overflow-hidden rounded-xl border border-line bg-panel transition-colors hover:border-gold/40">
              <div className="flex items-center justify-between border-b border-line px-4 py-2.5">
                <span className="font-[family-name:var(--font-mono)] text-[10.5px] tracking-wider text-faint uppercase">
                  {t.install.cmds[tab].label}
                </span>
                <button
                  onClick={() => void copy(t.install.cmds[tab].code)}
                  className="flex items-center gap-1.5 rounded-md border border-line px-2.5 py-1 text-[11px] text-dim transition-colors hover:border-gold/50 hover:text-ink"
                >
                  {copied ? <Check className="size-3 text-mint" /> : <Copy className="size-3" />}
                  {copied ? t.install.copied : t.install.copy}
                </button>
              </div>
              <div className="flex items-start gap-3 px-4 py-4 sm:px-5">
                <span className="pt-0.5 font-[family-name:var(--font-mono)] text-[13px] text-gold">$</span>
                <code className="font-[family-name:var(--font-mono)] text-[12px] leading-[1.8] break-all text-ink/90 sm:text-[12.5px]">
                  {t.install.cmds[tab].code}
                </code>
              </div>
            </div>

            {/* after steps */}
            <div className="mt-8 flex flex-col items-center gap-3 sm:flex-row sm:justify-center">
              <span className="font-[family-name:var(--font-mono)] text-[10.5px] tracking-[0.2em] text-faint uppercase">
                {t.install.afterTitle}
              </span>
              <div className="flex flex-wrap items-center justify-center gap-2">
                {t.install.afterSteps.map((s, i) => (
                  <span key={s} className="flex items-center gap-2">
                    <span className="rounded-md border border-line bg-black/30 px-2.5 py-1.5 font-[family-name:var(--font-mono)] text-[11.5px] text-dim">
                      <span className="mr-1.5 text-gold">{i + 1}</span>
                      {s}
                    </span>
                    {i < t.install.afterSteps.length - 1 && <ArrowRight className="size-3.5 text-faint" />}
                  </span>
                ))}
              </div>
            </div>
          </div>
        </Reveal>

        <div className="mt-14 grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
          {t.install.notes.map((n, i) => (
            <Reveal key={n.title} i={i}>
              <article className="h-full rounded-2xl border border-line bg-panel p-6">
                <p className="font-[family-name:var(--font-mono)] text-[11px] tracking-wide text-gold">{n.title}</p>
                <p className="mt-3 text-[13px] leading-[1.75] text-dim">{n.body}</p>
              </article>
            </Reveal>
          ))}
        </div>
      </div>
    </section>
  );
}
