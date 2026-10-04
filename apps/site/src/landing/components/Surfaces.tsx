import { useState, type ReactNode } from "react";
import { Check, TerminalSquare } from "lucide-react";
import { useLocale } from "../i18n";
import { Reveal, SectionHead } from "./shared";
import { cn } from "../utils/cn";

const KW = "text-violet";
const STR = "text-primary";
const TY = "text-azure";
const FN = "text-ink";
const CM = "text-faint";
const PL = "text-dim";

const P = ({ c, children }: { c: string; children: ReactNode }) => <span className={c}>{children}</span>;

/* prompt() is an admission ACK; closing before turn.ended would cancel the turn. */
function SdkCode() {
  return (
    <pre className="overflow-x-auto font-[family-name:var(--font-mono)] text-[11.5px] leading-[1.75]">
      <code>
        <P c={KW}>import</P> <P c={PL}>{"{ createLioraHarness }"}</P> <P c={KW}>from</P> <P c={STR}>"@superliora/sdk"</P>
        <P c={PL}>;</P>
        {"\n\n"}
        <P c={KW}>const</P> <P c={FN}>liora</P> <P c={PL}>=</P> <P c={FN}>createLioraHarness</P>
        <P c={PL}>({"{ homeDir: "}</P>
        <P c={TY}>process</P>
        <P c={PL}>.env.</P>
        <P c={STR}>SUPERLIORA_HOME</P>
        <P c={PL}>{" });"}</P>
        {"\n"}
        <P c={KW}>const</P> <P c={FN}>session</P> <P c={PL}>=</P> <P c={KW}>await</P> <P c={FN}>liora.createSession</P>
        <P c={PL}>({"{ workDir: "}</P>
        <P c={TY}>process</P>
        <P c={PL}>{".cwd() });"}</P>
        {"\n\n"}
        <P c={KW}>const</P> <P c={FN}>ended</P> <P c={PL}>=</P> <P c={KW}>new</P> <P c={TY}>Promise</P>
        <P c={PL}>{"<void>((resolve) =>"}</P>
        {"\n  "}
        <P c={FN}>session.onEvent</P>
        <P c={PL}>{"((e) => {"}</P>
        {"\n    "}
        <P c={KW}>if</P> <P c={PL}>(e.type ===</P> <P c={STR}>"turn.ended"</P> <P c={PL}>&amp;&amp; e.agentId ===</P> <P c={STR}>"main"</P>
        <P c={PL}>{") resolve();"}</P>
        {"\n  "}
        <P c={PL}>{"}),"}</P>
        {"\n"}
        <P c={PL}>);</P>
        {"\n\n"}
        <P c={KW}>await</P> <P c={FN}>session.prompt</P>
        <P c={PL}>(</P>
        <P c={STR}>"Cap the webhook retry backoff"</P>
        <P c={PL}>);</P> <P c={CM}>// accepted, not finished</P>
        {"\n"}
        <P c={KW}>await</P> <P c={FN}>ended</P>
        <P c={PL}>;</P>
        {"\n"}
        <P c={KW}>await</P> <P c={FN}>liora.close</P>
        <P c={PL}>();</P>
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
                    ? "border-primary bg-primary text-black font-semibold"
                    : "border-line bg-panel text-dim hover:border-primary/40 hover:text-ink",
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
                  <TerminalSquare className="size-4 text-primary" />
                  {t.surfaces.cliLabel}
                </p>
                <div className="divide-y divide-line">
                  {t.surfaces.cli.map((c) => (
                    <div key={c.cmd} className="grid gap-1 py-3 sm:grid-cols-[300px_1fr] sm:gap-6">
                      <code className="font-[family-name:var(--font-mono)] text-[12.5px] text-primary">{c.cmd}</code>
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
                        <span className={l.p === "$" ? "text-primary" : "text-faint"}>{l.p} </span>
                        <span className={l.p === "$" ? "text-ink" : "text-dim"}>{l.text}</span>
                      </p>
                    ))}
                  </div>
                </div>
              </div>
            )}

            {/* SDK */}
            {tab === 2 && (
              <div className="grid gap-10 lg:grid-cols-[0.8fr_1.2fr]">
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
                  <p className="mt-6 rounded-lg border border-line bg-black/20 px-3.5 py-2.5 text-[12.5px] leading-6 text-faint">{t.surfaces.sdk.note}</p>
                  <div className="mt-6 flex flex-wrap gap-2">
                    {["@superliora/sdk", "createLioraHarness", "Session"].map((chip) => (
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
                      {t.surfaces.ide.lines.map((line) =>
                        line.startsWith("$") ? (
                          <p key={line}>
                            <span className="text-primary">$ </span>
                            <span className="text-ink">{line.slice(2)}</span>
                          </p>
                        ) : (
                          <p key={line} className="text-faint">
                            {line}
                          </p>
                        ),
                      )}
                    </div>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {["Zed", "JetBrains", "Bash", "SessionControl"].map((chip) => (
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
