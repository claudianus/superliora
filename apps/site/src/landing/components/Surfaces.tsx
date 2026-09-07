import { useState } from "react";
import { Check, TerminalSquare } from "lucide-react";
import { useLocale } from "../i18n";
import { Reveal, SectionHead } from "./shared";
import { cn } from "../utils/cn";

const KW = "text-violet";
const STR = "text-gold";
const TY = "text-azure";
const FN = "text-ink";
const CM = "text-faint";
const PL = "text-dim";

function SdkCode() {
  return (
    <pre className="overflow-x-auto font-[family-name:var(--font-mono)] text-[12px] leading-[1.75]">
      <code>
        <span className={KW}>import</span> <span className={PL}>{`{ LioraHarness }`}</span> <span className={KW}>from</span>{" "}
        <span className={STR}>"@superliora/sdk"</span>
        <span className={PL}>;</span>
        {"\n\n"}
        <span className={KW}>const</span> <span className={FN}>liora</span> <span className={PL}>=</span>{" "}
        <span className={KW}>await</span> <span className={TY}>LioraHarness</span>
        <span className={PL}>.</span>
        <span className={FN}>create</span>
        <span className={PL}>({`{ home: `}</span>
        <span className={TY}>process</span>
        <span className={PL}>.env.</span>
        <span className={STR}>SUPERLIORA_HOME</span> <span className={PL}>{`}`});</span>
        {"\n\n"}
        <span className={KW}>const</span> <span className={FN}>job</span> <span className={PL}>=</span> <span className={KW}>await</span>{" "}
        <span className={FN}>liora.jobs.create</span>
        <span className={PL}>({`{`}</span>
        {"\n  "}
        <span className={PL}>kind:</span> <span className={STR}>"implement"</span>
        <span className={PL}>,</span>
        {"\n  "}
        <span className={PL}>title:</span> <span className={STR}>"Bound webhook retries"</span>
        <span className={PL}>,</span>
        {"\n  "}
        <span className={PL}>ownershipPaths: [</span>
        <span className={STR}>"src/webhooks"</span>
        <span className={PL}>],</span>
        {"\n  "}
        <span className={PL}>contextPaths: [</span>
        <span className={STR}>"AGENTS.md"</span>
        <span className={PL}>],</span>
        {"\n"}
        <span className={PL}>{`}`});</span>
        {"\n\n"}
        <span className={KW}>for await</span> <span className={PL}>(</span>
        <span className={KW}>const</span> <span className={FN}>ev</span> <span className={KW}>of</span>{" "}
        <span className={FN}>job.stream</span>
        <span className={PL}>()) {`{`}</span>
        {"\n  "}
        <span className={KW}>if</span> <span className={PL}>(</span>
        <span className={FN}>ev.type</span> <span className={PL}>===</span> <span className={STR}>"tool_call"</span>
        <span className={PL}>)</span> <span className={FN}>render</span>
        <span className={PL}>(</span>
        <span className={FN}>ev</span>
        <span className={PL}>);</span>
        {"\n  "}
        <span className={KW}>if</span> <span className={PL}>(</span>
        <span className={FN}>ev.type</span> <span className={PL}>===</span> <span className={STR}>"needs_user"</span>
        <span className={PL}>)</span> <span className={KW}>await</span> <span className={FN}>job.answer</span>
        <span className={PL}>(</span>
        <span className={FN}>ask</span>
        <span className={PL}>(</span>
        <span className={FN}>ev</span>
        <span className={PL}>));</span>
        {"\n"}
        <span className={PL}>{`}`}</span>
        {"\n"}
        <span className={CM}>// → ACK job_x7f2p1q [queued] model=opencode-go/kimi-k3</span>
      </code>
    </pre>
  );
}

export default function Surfaces() {
  const { t } = useLocale();
  const [tab, setTab] = useState(0);

  return (
    <section id="surfaces" className="relative scroll-mt-20 border-t border-line py-28 sm:py-36">
      <div className="mx-auto max-w-6xl px-5">
        <SectionHead eyebrow={t.surfaces.eyebrow} title={t.surfaces.title} lede={t.surfaces.lede} />

        <Reveal i={2}>
          <div className="mt-12 flex flex-wrap gap-2">
            {t.surfaces.tabs.map((label, i) => (
              <button
                key={label}
                onClick={() => setTab(i)}
                className={cn(
                  "rounded-full border px-5 py-2 text-[13px] transition-all",
                  tab === i
                    ? "border-gold bg-gold text-black font-semibold"
                    : "border-line bg-panel text-dim hover:border-gold/40 hover:text-ink",
                )}
              >
                {label}
              </button>
            ))}
          </div>
        </Reveal>

        <Reveal i={3}>
          <div className="mt-6 min-h-[420px] rounded-2xl border border-line bg-panel p-6 sm:p-9">
            {/* Terminal */}
            {tab === 0 && (
              <div>
                <p className="mb-6 flex items-center gap-2 font-[family-name:var(--font-mono)] text-[11px] tracking-[0.18em] text-faint uppercase">
                  <TerminalSquare className="size-4 text-gold" />
                  argv keep-list
                </p>
                <div className="divide-y divide-line">
                  {t.surfaces.cli.map((c) => (
                    <div key={c.cmd} className="grid gap-1 py-3.5 sm:grid-cols-[280px_1fr] sm:gap-6">
                      <code className="font-[family-name:var(--font-mono)] text-[12.5px] text-gold">{c.cmd}</code>
                      <p className="text-[13.5px] text-dim">{c.desc}</p>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Server */}
            {tab === 1 && (
              <div className="grid gap-10 lg:grid-cols-2">
                <div>
                  <p className="font-[family-name:var(--font-display)] text-xl font-semibold text-ink">{t.surfaces.server.lead}</p>
                  <ul className="mt-7 space-y-4">
                    {t.surfaces.server.bullets.map((b) => (
                      <li key={b} className="flex gap-3 text-[14px] leading-7 text-dim">
                        <Check className="mt-1.5 size-4 shrink-0 text-mint" />
                        {b}
                      </li>
                    ))}
                  </ul>
                </div>
                <div className="tui scan overflow-hidden rounded-xl">
                  <div className="border-b border-line px-4 py-2">
                    <span className="font-[family-name:var(--font-mono)] text-[10.5px] text-faint">liora server</span>
                  </div>
                  <div className="space-y-1.5 px-4 py-4 font-[family-name:var(--font-mono)] text-[12px] leading-relaxed">
                    {t.surfaces.server.lines.map((l, i) => (
                      <p key={i}>
                        <span className={l.p === "$" ? "text-gold" : "text-faint"}>{l.p} </span>
                        <span className={l.p === "$" ? "text-ink" : "text-dim"}>{l.text}</span>
                      </p>
                    ))}
                  </div>
                </div>
              </div>
            )}

            {/* SDK */}
            {tab === 2 && (
              <div className="grid gap-10 lg:grid-cols-[1.15fr_0.85fr]">
                <div>
                  <p className="font-[family-name:var(--font-display)] text-xl font-semibold text-ink">{t.surfaces.sdk.lead}</p>
                  <ul className="mt-7 space-y-4">
                    {t.surfaces.sdk.bullets.map((b) => (
                      <li key={b} className="flex gap-3 text-[14px] leading-7 text-dim">
                        <Check className="mt-1.5 size-4 shrink-0 text-mint" />
                        {b}
                      </li>
                    ))}
                  </ul>
                  <div className="mt-8 flex flex-wrap gap-2">
                    {["@superliora/sdk", "LioraHarness", "Session"].map((chip) => (
                      <span key={chip} className="rounded-md border border-line bg-black/30 px-2.5 py-1.5 font-[family-name:var(--font-mono)] text-[11px] text-azure">
                        {chip}
                      </span>
                    ))}
                  </div>
                </div>
                <div className="tui scan overflow-hidden rounded-xl p-4">
                  <SdkCode />
                </div>
              </div>
            )}

            {/* IDE */}
            {tab === 3 && (
              <div className="grid gap-10 lg:grid-cols-2">
                <div>
                  <p className="font-[family-name:var(--font-display)] text-xl font-semibold text-ink">{t.surfaces.ide.lead}</p>
                  <ul className="mt-7 space-y-4">
                    {t.surfaces.ide.bullets.map((b) => (
                      <li key={b} className="flex gap-3 text-[14px] leading-7 text-dim">
                        <Check className="mt-1.5 size-4 shrink-0 text-mint" />
                        {b}
                      </li>
                    ))}
                  </ul>
                </div>
                <div className="space-y-4">
                  <div className="tui scan overflow-hidden rounded-xl">
                    <div className="border-b border-line px-4 py-2">
                      <span className="font-[family-name:var(--font-mono)] text-[10.5px] text-faint">terminal</span>
                    </div>
                    <div className="space-y-1.5 px-4 py-4 font-[family-name:var(--font-mono)] text-[12px]">
                      <p>
                        <span className="text-gold">$ </span>
                        <span className="text-ink">liora acp</span>
                      </p>
                      <p className="text-faint">→ acp: listening on stdio · agent-client-protocol v1</p>
                      <p className="text-faint">→ attach from Zed or JetBrains · same session, same jobs</p>
                    </div>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {["Zed", "JetBrains", "browser-use", "computer-use"].map((chip) => (
                      <span key={chip} className="rounded-full border border-line bg-panel px-4 py-2 font-[family-name:var(--font-mono)] text-[11.5px] text-dim">
                        {chip}
                      </span>
                    ))}
                  </div>
                </div>
              </div>
            )}
          </div>
        </Reveal>
      </div>
    </section>
  );
}
