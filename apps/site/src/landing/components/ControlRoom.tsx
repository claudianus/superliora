import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { CornerDownLeft, MousePointerClick, Search } from "lucide-react";
import { useLocale } from "../i18n";
import { KeyCap, Reveal, SectionHead } from "./shared";
import { toneClass, type Span } from "../tui/session";
import { cn } from "../utils/cn";

type Overlay = "none" | "deck" | "inbox" | "hub" | "quota" | "plan";

interface Job {
  id: string;
  kind: string;
  title: { ko: string; en: string };
  state: "queued" | "running" | "needs_user" | "done";
  model: string;
  owns: string;
  progress: number;
  verify?: string;
  sha?: string;
}

const seedJobs: Job[] = [
  { id: "job_1x9m4qt", kind: "implement", title: { ko: "웹훅 재시도 상한 + 실패 테스트", en: "Bound webhook retries + failure test" }, state: "running", model: "opencode-go/kimi-k3", owns: "src/webhooks", progress: 63 },
  { id: "job_4dd81x0", kind: "implement", title: { ko: "enqueue 멱등성 키", en: "Idempotency keys on enqueue" }, state: "needs_user", model: "opencode-go/kimi-k3", owns: "src/queue", progress: 41 },
  { id: "job_9z2k7aa", kind: "explore", title: { ko: "결제 경로 접점 지도", en: "Map billing touchpoints" }, state: "done", model: "opencode-go/qwen3.8-flash", owns: "src/billing", progress: 100, verify: "green", sha: "9be31d7" },
  { id: "job_77ac2mb", kind: "review", title: { ko: "스냅샷 커밋 정책 점검", en: "Audit snapshot commit policy" }, state: "queued", model: "groq/llama-4.1-scout", owns: "packages/agent-core", progress: 0 },
];

const baseTranscript: Span[][] = [
  [["◆ ", "primary"], ["ACK ", "faint"], ["job_1x9m4qt", "azure"], [" [running] kind=implement model=", "dim"], ["opencode-go/kimi-k3", "primary"]],
  [["◆ ", "primary"], ["ACK ", "faint"], ["job_4dd81x0", "azure"], [" [needs_user] ", "dim"], ["1 question in inbox", "primary"]],
  [["  ✓ ", "mint"], ["job_9z2k7aa", "azure"], [" done · verify=green · sha 9be31d7", "faint"]],
];

function subseq(q: string, s: string) {
  q = q.toLowerCase();
  s = s.toLowerCase();
  let i = 0;
  for (const ch of s) if (ch === q[i]) i++;
  return i >= q.length;
}

const stateTone: Record<string, string> = {
  queued: "text-faint",
  running: "text-primary",
  needs_user: "text-azure",
  done: "text-mint",
};
const stateDot: Record<string, string> = {
  queued: "bg-faint",
  running: "bg-primary animate-pulse",
  needs_user: "bg-azure animate-pulse",
  done: "bg-mint",
};

export default function ControlRoom() {
  const { locale, t } = useLocale();
  const [attach, setAttach] = useState(false);
  const [overlay, setOverlay] = useState<Overlay>("none");
  const [jobs, setJobs] = useState<Job[]>(seedJobs);
  const [inbox, setInbox] = useState<"open" | "answered" | "empty">("open");
  const [planOn, setPlanOn] = useState(false);
  const [hubQ, setHubQ] = useState("");
  const [hubIdx, setHubIdx] = useState(0);
  const [log, setLog] = useState<Span[][]>(baseTranscript);
  const boxRef = useRef<HTMLDivElement>(null);
  const hubInputRef = useRef<HTMLInputElement>(null);

  const push = useCallback((spans: Span[]) => setLog((l) => [...l.slice(-7), spans]), []);

  const toggle = useCallback(
    (o: Overlay) => {
      setOverlay((cur) => (cur === o ? "none" : o));
      if (o === "hub") {
        setHubQ("");
        setHubIdx(0);
        setTimeout(() => hubInputRef.current?.focus(), 60);
      } else if (boxRef.current && attach) {
        boxRef.current.focus({ preventScroll: true });
      }
    },
    [attach],
  );

  const answer = (opt: string) => {
    if (inbox !== "open") return;
    setInbox("answered");
    push([
      ["◆ ", "primary"],
      [locale === "ko" ? "인박스에 답변 — " : "inbox answered — ", "primary"],
      [opt, "w"],
    ]);
    // job resumes, then completes
    setJobs((js) => js.map((j) => (j.id === "job_4dd81x0" ? { ...j, state: "running", progress: 55 } : j)));
    const iv = setInterval(() => {
      setJobs((js) =>
        js.map((j) => (j.id === "job_4dd81x0" ? { ...j, progress: Math.min(100, j.progress + 9) } : j)),
      );
    }, 240);
    setTimeout(() => {
      clearInterval(iv);
      setJobs((js) =>
        js.map((j) =>
          j.id === "job_4dd81x0" ? { ...j, state: "done", progress: 100, verify: "green", sha: "c07f12e" } : j,
        ),
      );
      push([
        ["  ✓ ", "mint"],
        ["job_4dd81x0", "azure"],
        [" done · verify=green · sha c07f12e", "faint"],
      ]);
    }, 3600);
    setTimeout(() => setOverlay("none"), 1500);
  };

  const onKey = useCallback(
    (e: KeyboardEvent) => {
      const k = e.key.toLowerCase();
      if (e.altKey && (k === "j" || e.code === "KeyJ")) return e.preventDefault(), toggle("deck");
      if (e.altKey && (k === "i" || e.code === "KeyI")) return e.preventDefault(), toggle("inbox");
      if ((e.ctrlKey || e.metaKey) && (k === "k" || e.code === "Space"))
        return e.preventDefault(), toggle("hub");
      if (e.key === "Escape") return setOverlay("none");
      if (overlay === "hub") return; // arrows handled by input
      if (e.key === "?") return toggle("hub");
      if (k === "q") return toggle("quota");
      if (k === "p") {
        setPlanOn((p) => !p);
        return toggle("plan");
      }
    },
    [overlay, toggle],
  );

  /* keyboard attach / detach */
  useEffect(() => {
    const off = (e: MouseEvent) => {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setAttach(false);
    };
    document.addEventListener("mousedown", off);
    return () => document.removeEventListener("mousedown", off);
  }, []);

  const hubItems = t.demo.hub.items;
  const filtered = useMemo(() => {
    const q = hubQ.trim();
    if (!q) return hubItems;
    return hubItems.filter((it) => subseq(q, `${it.label} ${it.hint} ${it.kw}`));
  }, [hubQ, hubItems]);

  const hubEnter = (idx: number) => {
    const it = filtered[idx];
    if (!it) return;
    if (it.hint === "Alt+J") toggle("deck");
    else if (it.hint === "Alt+I") toggle("inbox");
    else if (it.hint === "/quota") toggle("quota");
    else if (it.hint === "/plan") {
      setPlanOn(true);
      toggle("plan");
    } else if (it.label.includes("언어") || it.label.toLowerCase().includes("language")) {
      toggle("none");
    } else toggle("none");
  };

  const running = jobs.find((j) => j.state === "running");

  return (
    <section id="demo" className="relative scroll-mt-20 border-t border-line py-28 sm:py-36">
      <div className="mx-auto max-w-6xl px-5">
        <div className="grid items-start gap-14 lg:grid-cols-[0.9fr_1.1fr]">
          {/* left copy */}
          <div className="lg:sticky lg:top-28">
            <SectionHead eyebrow={t.demo.eyebrow} title={t.demo.title} lede={t.demo.lede} />
            <Reveal i={3}>
              <ul className="mt-9 space-y-1.5">
                {t.demo.keys.map((k) => (
                  <li key={k.action}>
                    <button
                      onClick={() => {
                        setAttach(true);
                        if (k.action === "plan") setPlanOn(true);
                        toggle(k.action as Overlay);
                      }}
                      className={cn(
                        "flex w-full items-center gap-4 rounded-xl border px-4 py-3 text-left transition-all",
                        overlay === k.action
                          ? "border-primary/60 bg-primary/[0.07]"
                          : "border-line bg-panel hover:border-primary/30",
                      )}
                    >
                      <KeyCap className="min-w-[64px] text-center">{k.chord}</KeyCap>
                      <span className="text-[13.5px] text-dim">{k.label}</span>
                      <span
                        className={cn(
                          "ml-auto size-1.5 rounded-full transition-colors",
                          overlay === k.action ? "bg-primary" : "bg-transparent",
                        )}
                      />
                    </button>
                  </li>
                ))}
              </ul>
            </Reveal>
            <Reveal i={4}>
              <p className="mt-6 flex items-center gap-2 font-[family-name:var(--font-mono)] text-[10.5px] text-faint">
                <MousePointerClick className="size-3.5" />
                {attach ? t.demo.focusedHint : t.demo.focusHint}
              </p>
            </Reveal>
          </div>

          {/* console */}
          <Reveal i={1}>
            <div
              ref={boxRef}
              tabIndex={0}
              role="application"
              aria-label="SuperLiora console"
              onKeyDown={onKey}
              onMouseDown={() => setAttach(true)}
              className={cn(
                "tui scan relative flex h-[560px] cursor-text flex-col overflow-hidden rounded-2xl outline-none transition-shadow",
                attach && "shadow-[0_0_0_1px_rgba(0,213,255,0.5),0_30px_80px_-20px_rgba(0,0,0,0.8)]",
              )}
            >
              {/* titlebar */}
              <div className="relative flex items-center gap-2 border-b border-line px-4 py-2.5">
                <span className="size-2.5 rounded-full bg-line-strong" />
                <span className="size-2.5 rounded-full bg-line-strong" />
                <span className="size-2.5 rounded-full bg-primary/70" />
                <span className="ml-3 font-[family-name:var(--font-mono)] text-[11px] text-faint">
                  liora — ~/projects/paygate
                </span>
                <span className="ml-auto font-[family-name:var(--font-mono)] text-[10px] tracking-wider text-faint uppercase">
                  {attach ? (locale === "ko" ? "키보드 연결됨" : "keys live") : (locale === "ko" ? "클릭하여 연결" : "click to connect")}
                </span>
              </div>

              {/* transcript */}
              <div className="relative flex-1 overflow-hidden px-4 pt-4 pb-14 font-[family-name:var(--font-mono)] text-[12.5px] leading-[1.7] sm:px-5">
                {log.map((spans, i) => (
                  <div key={i} className="whitespace-pre-wrap break-words">
                    {spans.map((s, j) => (
                      <span key={j} className={toneClass[s[1]]}>
                        {s[0]}
                      </span>
                    ))}
                  </div>
                ))}
                {running && (
                  <div className="mt-1 animate-pulse whitespace-pre-wrap">
                    <span className="text-primary">  ⠿ </span>
                    <span className="text-azure">{running.id}</span>
                    <span className="text-dim"> {running.title[locale]}</span>
                    <span className="text-faint"> · {running.progress}%</span>
                  </div>
                )}
                <div className="mt-6">
                  <span className="text-faint">{t.demo.transcriptNote}</span>
                </div>
              </div>

              {/* ===== overlays ===== */}
              {/* Job Deck */}
              <OverlayShell on={overlay === "deck"} side="right" label={`${t.demo.deck.title} — ${t.demo.deck.subtitle}`} onClose={() => setOverlay("none")}>
                <div className="space-y-2.5">
                  {jobs.map((j) => (
                    <div key={j.id} className="rounded-lg border border-line bg-black/40 p-3">
                      <div className="flex items-center gap-2">
                        <span className={cn("size-1.5 rounded-full", stateDot[j.state])} />
                        <span className="font-[family-name:var(--font-mono)] text-[11px] text-azure">{j.id}</span>
                        <span className={cn("ml-auto font-[family-name:var(--font-mono)] text-[10px]", stateTone[j.state])}>
                          {t.demo.deck.states[j.state]}
                        </span>
                      </div>
                      <p className="mt-1.5 text-[12.5px] text-ink">{j.title[locale]}</p>
                      <p className="mt-1 font-[family-name:var(--font-mono)] text-[10px] text-faint">
                        {j.kind} · {j.model}
                      </p>
                      <p className="mt-0.5 font-[family-name:var(--font-mono)] text-[10px] text-faint">
                        {t.demo.deck.owns}: {j.owns}
                      </p>
                      {j.state === "running" || j.state === "needs_user" ? (
                        <div className="mt-2 h-1 overflow-hidden rounded-full bg-white/5">
                          <div className="h-full rounded-full bg-primary transition-all duration-300" style={{ width: `${j.progress}%` }} />
                        </div>
                      ) : null}
                      {j.state === "needs_user" && (
                        <button
                          onClick={() => toggle("inbox")}
                          className="mt-2.5 rounded-md border border-azure/40 bg-azure/10 px-2.5 py-1 font-[family-name:var(--font-mono)] text-[10.5px] text-azure transition-colors hover:bg-azure/20"
                        >
                          ↳ {t.demo.keys[1].label} (Alt+I)
                        </button>
                      )}
                      {j.state === "done" && (
                        <p className="mt-2 font-[family-name:var(--font-mono)] text-[10px] text-mint">
                          {t.demo.deck.ledger}: {t.demo.deck.verifyOk} · {j.sha}
                        </p>
                      )}
                    </div>
                  ))}
                </div>
              </OverlayShell>

              {/* Inbox */}
              <OverlayShell on={overlay === "inbox"} side="center" label={`${t.demo.inbox.title} — ${t.demo.inbox.subtitle}`} onClose={() => setOverlay("none")}>
                {inbox === "open" ? (
                  <div className="rounded-lg border border-line bg-black/40 p-4">
                    <p className="font-[family-name:var(--font-mono)] text-[10px] tracking-wider text-azure">
                      {t.demo.inbox.from}
                    </p>
                    <p className="mt-3 text-[13px] leading-6 text-ink">{t.demo.inbox.question}</p>
                    <div className="mt-4 flex flex-col gap-2">
                      {t.demo.inbox.options.map((opt) => (
                        <button
                          key={opt}
                          onClick={() => answer(opt)}
                          className="flex items-center justify-between rounded-lg border border-line bg-white/[0.03] px-3.5 py-2.5 text-left text-[12.5px] text-dim transition-colors hover:border-primary/50 hover:text-ink"
                        >
                          {opt}
                          <CornerDownLeft className="size-3.5 opacity-50" />
                        </button>
                      ))}
                    </div>
                  </div>
                ) : inbox === "answered" ? (
                  <div className="rounded-lg border border-mint/30 bg-mint/[0.06] p-4">
                    <p className="flex items-center gap-2 text-[12.5px] text-mint">
                      <span className="inline-block size-1.5 rounded-full bg-mint" />
                      {t.demo.inbox.answered}
                    </p>
                  </div>
                ) : (
                  <p className="p-4 text-[12.5px] text-faint">{t.demo.inbox.empty}</p>
                )}
              </OverlayShell>

              {/* Command Hub */}
              <OverlayShell on={overlay === "hub"} side="center" label="Command Hub" onClose={() => setOverlay("none")} wide>
                <div className="flex items-center gap-2.5 border-b border-line px-4 py-3">
                  <Search className="size-3.5 text-faint" />
                  <input
                    ref={hubInputRef}
                    value={hubQ}
                    onChange={(e) => {
                      setHubQ(e.target.value);
                      setHubIdx(0);
                    }}
                    onKeyDown={(e) => {
                      if (e.key === "ArrowDown") {
                        e.preventDefault();
                        setHubIdx((i) => Math.min(filtered.length - 1, i + 1));
                      } else if (e.key === "ArrowUp") {
                        e.preventDefault();
                        setHubIdx((i) => Math.max(0, i - 1));
                      } else if (e.key === "Enter") {
                        hubEnter(hubIdx);
                      } else if (e.key === "Escape") {
                        setOverlay("none");
                      }
                      e.stopPropagation();
                    }}
                    placeholder={t.demo.hub.placeholder}
                    className="w-full bg-transparent font-[family-name:var(--font-mono)] text-[12.5px] text-ink outline-none placeholder:text-faint"
                  />
                </div>
                <div className="tui-lines max-h-[280px] overflow-y-auto p-2">
                  {filtered.length === 0 && <p className="px-3 py-4 text-[12px] text-faint">{t.demo.hub.noMatch}</p>}
                  {filtered.map((it, i) => (
                    <button
                      key={it.label}
                      onMouseEnter={() => setHubIdx(i)}
                      onClick={() => hubEnter(i)}
                      className={cn(
                        "flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left",
                        hubIdx === i ? "bg-primary/[0.09]" : "",
                      )}
                    >
                      <span className={cn("size-1 rounded-full", hubIdx === i ? "bg-primary" : "bg-white/15")} />
                      <span className="text-[12.5px] text-ink">{it.label}</span>
                      <span className="ml-auto font-[family-name:var(--font-mono)] text-[10.5px] text-faint">{it.hint}</span>
                    </button>
                  ))}
                </div>
              </OverlayShell>

              {/* Quota */}
              <OverlayShell on={overlay === "quota"} side="left" label={t.demo.quota.title} onClose={() => setOverlay("none")}>
                <div className="space-y-3 p-1">
                  {t.demo.quota.rows.map((r) => (
                    <div key={r.provider}>
                      <div className="flex items-baseline justify-between gap-2">
                        <p className="text-[12px] text-ink">{r.provider}</p>
                        <p className="tick-num font-[family-name:var(--font-mono)] text-[11px] text-primary">{r.pct}%</p>
                      </div>
                      <p className="font-[family-name:var(--font-mono)] text-[10px] text-faint">{r.detail}</p>
                      <div className="mt-1.5 h-1 overflow-hidden rounded-full bg-white/5">
                        <div className="h-full rounded-full bg-gradient-to-r from-primary-deep to-primary" style={{ width: `${r.pct}%` }} />
                      </div>
                    </div>
                  ))}
                  <p className="pt-1 font-[family-name:var(--font-mono)] text-[9.5px] leading-relaxed text-faint">{t.demo.quota.note}</p>
                </div>
              </OverlayShell>

              {/* Plan mode */}
              <OverlayShell on={overlay === "plan"} side="right" label={t.demo.plan.title} onClose={() => setOverlay("none")}>
                <div className="rounded-lg border border-line bg-black/40 p-4">
                  <p className="font-[family-name:var(--font-mono)] text-[11px] text-violet">{t.demo.plan.unspecified}</p>
                  <ul className="mt-3 space-y-2">
                    {t.demo.plan.items.map((it) => (
                      <li key={it} className="flex gap-2.5 text-[12.5px] leading-6 text-dim">
                        <span className="mt-2.5 size-1 shrink-0 rounded-full bg-violet/70" />
                        {it}
                      </li>
                    ))}
                  </ul>
                  <p className="mt-4 border-t border-line pt-3 text-[11.5px] leading-5 text-faint">{t.demo.plan.handoff}</p>
                </div>
              </OverlayShell>

              {/* status bar */}
              <div className="absolute inset-x-0 bottom-0 flex flex-wrap items-center gap-x-4 gap-y-1 border-t border-line bg-sunken/95 px-4 py-2 font-[family-name:var(--font-mono)] text-[10.5px] backdrop-blur sm:px-5">
                <span className={cn("flex items-center gap-1.5", planOn ? "text-violet" : "text-primary")}>
                  <span className={cn("inline-block size-1.5 animate-pulse rounded-full", planOn ? "bg-violet" : "bg-primary")} />
                  {planOn ? "PLAN" : "BUILD"}
                </span>
                <span className="text-dim">main*</span>
                <span className="hidden text-faint sm:inline">opencode-go/kimi-k3</span>
                {inbox === "open" && <span className="rounded bg-primary/15 px-1.5 py-0.5 text-primary">▣1 inbox</span>}
                <span className="ml-auto text-faint">{t.tui.hints}</span>
              </div>
            </div>
          </Reveal>
        </div>
      </div>
    </section>
  );
}

/* ---------- overlay shell ---------- */
function OverlayShell({
  on,
  side,
  label,
  onClose,
  children,
  wide,
}: {
  on: boolean;
  side: "left" | "right" | "center";
  label: string;
  onClose: () => void;
  children: ReactNode;
  wide?: boolean;
}) {
  return (
    <div
      className={cn(
        "ov absolute z-20 overflow-hidden rounded-xl border border-line bg-panel/97 shadow-[0_24px_70px_-20px_rgba(0,0,0,0.9)] backdrop-blur-xl",
        on && "on",
        side === "right" && "top-12 right-3 bottom-14 w-[min(330px,86%)] overflow-y-auto",
        side === "left" && "bottom-14 left-3 w-[min(320px,86%)]",
        side === "center" && (wide ? "top-12 inset-x-0 mx-auto w-[min(430px,92%)]" : "top-14 inset-x-0 mx-auto w-[min(400px,92%)]"),
      )}
    >
      <div className="sticky top-0 z-10 flex items-center justify-between border-b border-line bg-raise px-4 py-2.5">
        <p className="font-[family-name:var(--font-mono)] text-[10px] tracking-[0.18em] text-faint uppercase">{label}</p>
        <button
          onClick={onClose}
          className="rounded-md border border-line bg-white/[0.04] px-2.5 py-1 font-[family-name:var(--font-mono)] text-[10px] text-faint transition-colors hover:border-primary/50 hover:text-ink"
        >
          esc
        </button>
      </div>
      <div className="p-3.5">{children}</div>
    </div>
  );
}
