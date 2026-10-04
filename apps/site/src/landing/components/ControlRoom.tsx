import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { CornerDownLeft, MousePointerClick, Search } from "lucide-react";
import { useLocale } from "../i18n";
import type { Locale } from "../i18n/types";
import { KeyCap, Reveal, SectionHead } from "./shared";
import { toneClass, type Span } from "../tui/session";
import { cn } from "../utils/cn";

type Overlay = "none" | "deck" | "inbox" | "hub" | "quota";
type DockMode = "auto" | "pinned" | "hidden";
type JobState = "queued" | "running" | "needs_user" | "done";

interface Job {
  id: string;
  kind: string;
  title: Record<Locale, string>;
  state: JobState;
  model: string;
  progress: number;
}

/* Job kinds and states are the engine's own (job-store-key.ts); model ids exist on models.dev. */
const seedJobs: Job[] = [
  { id: "job_4dd81x0", kind: "implement", title: { ko: "enqueue 멱등성 키", en: "Idempotency keys on enqueue" }, state: "needs_user", model: "anthropic/claude-sonnet-5-5", progress: 41 },
  { id: "job_1x9m4qt", kind: "implement", title: { ko: "웹훅 재시도 상한 + 실패 테스트", en: "Bound webhook retries + failure test" }, state: "running", model: "opencode-go/kimi-k3", progress: 63 },
  { id: "job_77ac2mb", kind: "verify", title: { ko: "웹훅 테스트 실행 후 결과 보고", en: "Run webhook tests and report" }, state: "queued", model: "openai/gpt-5.6-sol", progress: 0 },
  { id: "job_9z2k7aa", kind: "explore", title: { ko: "결제 경로 접점 지도", en: "Map billing touchpoints" }, state: "done", model: "opencode-go/kimi-k3", progress: 100 },
];

/* Deck buckets, in the Deck's own order: blocked → remaining → done. */
const bucketOf = (s: JobState): "blocked" | "remaining" | "done" =>
  s === "needs_user" ? "blocked" : s === "done" ? "done" : "remaining";

function baseTranscript(locale: Locale): Span[][] {
  const ko = locale === "ko";
  return [
    [["❯ ", "primary"], ["/job create ", "w"], [ko ? "enqueue에 멱등성 키 추가" : "Add idempotency keys to enqueue", "w"]],
    [["◆ ", "primary"], ["job_4dd81x0", "azure"], [ko ? " 대기 · 전용 worktree" : " queued · own worktree", "dim"]],
    [["❯ ", "primary"], [ko ? "웹훅 재시도 간격에 상한을 두고, 어디서 호출하는지도 확인해 줘" : "Cap the webhook retry backoff, and check who calls it", "w"]],
    [["◆ ", "primary"], [ko ? "retry.ts는 여기서 고치고, 호출부 조사는 별도 세션에 맡길게요." : "I'll patch retry.ts here and hand the caller audit to a separate session.", "ink"]],
    [["  ✓ ", "mint"], ["Bash  ", "ink"], ['rg -n "backoff" src/webhooks', "dim"]],
    [["  ✓ ", "mint"], ["SessionControl  ", "ink"], ["spawn ", "dim"], [ko ? "“웹훅 호출부 조사”" : "“Audit webhook callers”", "dim"], [" → coord_7f2 · rev 1", "azure"]],
    [["◆ ", "primary"], ["job_4dd81x0", "azure"], [ko ? " 답변 필요 · Inbox에 질문 1건 (Alt+I)" : " needs you · 1 question in the Inbox (Alt+I)", "primary"]],
  ];
}

function subseq(q: string, s: string) {
  q = q.toLowerCase();
  s = s.toLowerCase();
  let i = 0;
  for (const ch of s) if (ch === q[i]) i++;
  return i >= q.length;
}

const stateTone: Record<JobState, string> = {
  queued: "text-faint",
  running: "text-primary",
  needs_user: "text-amber",
  done: "text-mint",
};
const stateDot: Record<JobState, string> = {
  queued: "bg-faint",
  running: "bg-primary animate-pulse",
  needs_user: "bg-amber animate-pulse",
  done: "bg-mint",
};

/* Footer quota colours: amber from 70 % used, red from 90 % (footer-badges.ts). */
const quotaTone = (remaining: number) => (remaining <= 10 ? "text-red" : remaining <= 30 ? "text-amber" : "text-primary");
const quotaBar = (remaining: number) =>
  remaining <= 10 ? "bg-red" : remaining <= 30 ? "bg-amber" : "bg-gradient-to-r from-primary-deep to-primary";

export default function ControlRoom() {
  const { locale, t } = useLocale();
  const d = t.demo;
  const [attach, setAttach] = useState(false);
  const [overlay, setOverlay] = useState<Overlay>("none");
  const [dock, setDock] = useState<DockMode>("auto");
  const [treeOpen, setTreeOpen] = useState(true);
  const [jobs, setJobs] = useState<Job[]>(seedJobs);
  const [inbox, setInbox] = useState<"open" | "answered" | "empty">("open");
  const [hubQ, setHubQ] = useState("");
  const [hubIdx, setHubIdx] = useState(0);
  const [prompt, setPrompt] = useState("");
  const [extra, setExtra] = useState<Span[][]>([]);
  const boxRef = useRef<HTMLDivElement>(null);
  const promptRef = useRef<HTMLInputElement>(null);
  const hubInputRef = useRef<HTMLInputElement>(null);
  const timers = useRef<number[]>([]);

  useEffect(() => () => timers.current.forEach((id) => window.clearTimeout(id)), []);
  // A locale switch restarts the scripted transcript in the new language.
  useEffect(() => setExtra([]), [locale]);

  const log = useMemo(() => [...baseTranscript(locale), ...extra].slice(-9), [locale, extra]);
  const push = useCallback((...lines: Span[][]) => setExtra((l) => [...l, ...lines]), []);

  const focusPrompt = () => window.setTimeout(() => promptRef.current?.focus({ preventScroll: true }), 30);

  const toggle = useCallback((o: Overlay) => {
    setOverlay((cur) => (cur === o ? "none" : o));
    if (o === "hub") {
      setHubQ("");
      setHubIdx(0);
      window.setTimeout(() => hubInputRef.current?.focus({ preventScroll: true }), 60);
    }
  }, []);

  const close = useCallback(() => {
    setOverlay("none");
    focusPrompt();
  }, []);

  const cycleDock = (to?: DockMode) => {
    const next = to ?? (dock === "auto" ? "pinned" : dock === "pinned" ? "hidden" : "auto");
    setDock(next);
    push([["◆ ", "primary"], ["Worker Dock → ", "dim"], [d.dock.modes[next], "w"]]);
  };

  /* The handed-off audit settles a few seconds after the visitor first engages. */
  const [auditDone, setAuditDone] = useState(false);
  const auditArmed = useRef(false);
  const engage = () => {
    setAttach(true);
    if (auditArmed.current) return;
    auditArmed.current = true;
    timers.current.push(
      window.setTimeout(() => {
        setAuditDone(true);
        setExtra((l) => [
          ...l,
          [
            ["  ✓ ", "mint"],
            ["coord_7f2", "azure"],
            [locale === "ko" ? " 완료 · 호출부 3곳 · 파일 수정 없음" : " finished · 3 callers · no files edited", "faint"],
          ],
        ]);
      }, 6000),
    );
  };

  const answer = (opt: string) => {
    if (inbox !== "open") return;
    setInbox("answered");
    push([["◆ ", "primary"], ["job_4dd81x0 ", "azure"], ["← ", "faint"], [opt, "w"]]);
    setJobs((js) => js.map((j) => (j.id === "job_4dd81x0" ? { ...j, state: "running", progress: 55 } : j)));
    const tick = window.setInterval(() => {
      setJobs((js) => js.map((j) => (j.id === "job_4dd81x0" ? { ...j, progress: Math.min(96, j.progress + 8) } : j)));
    }, 260);
    timers.current.push(
      window.setTimeout(() => setOverlay((o) => (o === "inbox" ? "none" : o)), 1400),
      window.setTimeout(() => {
        window.clearInterval(tick);
        setJobs((js) => js.map((j) => (j.id === "job_4dd81x0" ? { ...j, state: "done", progress: 100 } : j)));
        setInbox("empty");
        push([
          ["  ✓ ", "mint"],
          ["job_4dd81x0", "azure"],
          [locale === "ko" ? " 완료 · land 대기 (keep · apply · PR)" : " done · waiting for land (keep · apply · PR)", "faint"],
        ]);
      }, 3600),
    );
  };

  /* The same commands the TUI dispatches, for the handful this replica draws. */
  const run = (raw: string) => {
    const text = raw.trim();
    if (!text) return;
    const [head, sub, arg] = text.toLowerCase().split(/\s+/);
    push([["❯ ", "primary"], [text, "w"]]);
    const jobsCmd = head === "/jobs" || head === "/job";
    if (jobsCmd && (sub === "dock" || sub === "workers" || sub === "band")) {
      cycleDock(arg === "auto" || arg === "pinned" || arg === "hidden" ? arg : undefined);
    } else if (jobsCmd && (sub === "deck" || sub === "board" || sub === "monitor")) {
      setOverlay("deck");
    } else if (jobsCmd && sub === "inbox") {
      setOverlay("inbox");
    } else if ((head === "/jobs" && sub === undefined) || (jobsCmd && (sub === "list" || sub === "ls"))) {
      push(...jobs.map((j): Span[] => [["  ", "faint"], [j.id, "azure"], [` ${d.deck.states[j.state]} · `, "dim"], [j.title[locale], "ink"]]));
    } else if (head === "/quota") {
      setOverlay("quota");
    } else if (head === "/help" || head === "/h") {
      toggle("hub");
    } else if (head.startsWith("/")) {
      push([["  ", "faint"], [`${d.unknownCommand} ${head}${jobsCmd && sub ? ` ${sub}` : ""}`, "faint"]]);
    } else {
      push([["◆ ", "primary"], [d.demoReply, "dim"]]);
    }
  };

  const onKey = useCallback(
    (e: KeyboardEvent) => {
      const k = e.key.toLowerCase();
      // macOS Option+J types "∆", so match the physical key too.
      if (e.altKey && (k === "j" || e.code === "KeyJ")) return e.preventDefault(), toggle("deck");
      if (e.altKey && (k === "i" || e.code === "KeyI")) return e.preventDefault(), toggle("inbox");
      if (((e.ctrlKey || e.metaKey) && (k === "k" || e.code === "KeyK")) || (e.ctrlKey && e.code === "Space"))
        return e.preventDefault(), toggle("hub");
      if (e.key === "Escape") return close();
    },
    [toggle, close],
  );

  /* keyboard attach / detach */
  useEffect(() => {
    const off = (e: MouseEvent) => {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setAttach(false);
    };
    document.addEventListener("mousedown", off);
    return () => document.removeEventListener("mousedown", off);
  }, []);

  const hubItems = d.hub.items;
  const filtered = useMemo(() => {
    const q = hubQ.trim();
    if (!q) return hubItems;
    return hubItems.filter((it) => subseq(q, `${it.label} ${it.hint} ${it.kw}`));
  }, [hubQ, hubItems]);

  const hubEnter = (idx: number) => {
    const it = filtered[idx];
    if (!it) return;
    if (it.hint === "Alt+J") return setOverlay("deck");
    if (it.hint === "Alt+I") return setOverlay("inbox");
    setOverlay("none");
    run(it.hint);
    focusPrompt();
  };

  const counts = {
    running: jobs.filter((j) => j.state === "running").length,
    needs: jobs.filter((j) => j.state === "needs_user").length,
  };
  const ko = locale === "ko";
  const dockVisible = dock !== "hidden";

  const pressKey = (action: (typeof d.keys)[number]["action"]) => {
    engage();
    if (action === "dock") cycleDock();
    else toggle(action);
    if (action !== "hub") focusPrompt();
  };

  return (
    <section id="demo" className="relative scroll-mt-20 border-t border-line py-28 sm:py-36">
      <div className="mx-auto max-w-6xl px-5">
        <div className="grid items-start gap-14 lg:grid-cols-[0.85fr_1.15fr]">
          {/* left copy */}
          <div className="lg:sticky lg:top-28">
            <SectionHead eyebrow={d.eyebrow} title={d.title} lede={d.lede} />
            <Reveal i={3}>
              <ul className="mt-9 space-y-1.5">
                {d.keys.map((k) => {
                  const active = k.action === "dock" ? dock === "pinned" : overlay === k.action;
                  return (
                    <li key={k.action}>
                      <button
                        onClick={() => pressKey(k.action)}
                        className={cn(
                          "flex w-full items-center gap-4 rounded-xl border px-4 py-3 text-left transition-all",
                          active ? "border-primary/60 bg-primary/[0.07]" : "border-line bg-panel hover:border-primary/30",
                        )}
                      >
                        <KeyCap className="min-w-[84px] text-center">{k.chord}</KeyCap>
                        <span className="text-[13.5px] text-dim">{k.label}</span>
                        {k.note && <span className="font-[family-name:var(--font-mono)] text-[10px] text-faint">· {k.note}</span>}
                        {k.action === "dock" && (
                          <span className="ml-auto rounded border border-line px-1.5 py-0.5 font-[family-name:var(--font-mono)] text-[10px] text-primary">
                            {d.dock.modes[dock]}
                          </span>
                        )}
                        {k.action !== "dock" && (
                          <span className={cn("ml-auto size-1.5 rounded-full transition-colors", active ? "bg-primary" : "bg-transparent")} />
                        )}
                      </button>
                    </li>
                  );
                })}
              </ul>
            </Reveal>
            <Reveal i={4}>
              <p className="mt-6 flex items-center gap-2 font-[family-name:var(--font-mono)] text-[10.5px] text-faint">
                <MousePointerClick className="size-3.5" />
                {attach ? d.focusedHint : d.focusHint}
              </p>
            </Reveal>
          </div>

          {/* console */}
          <Reveal i={1}>
            <div
              ref={boxRef}
              role="application"
              aria-label="SuperLiora console"
              onKeyDown={onKey}
              onMouseDown={(e) => {
                engage();
                if (!(e.target as HTMLElement).closest("button, input")) focusPrompt();
              }}
              className={cn(
                "tui scan relative flex h-[600px] cursor-text flex-col overflow-hidden rounded-2xl outline-none transition-shadow",
                attach && "shadow-[0_0_0_1px_rgba(0,213,255,0.5),0_30px_80px_-20px_rgba(0,0,0,0.8)]",
              )}
            >
              {/* titlebar */}
              <div className="relative flex items-center gap-2 border-b border-line px-4 py-2.5">
                <span className="size-2.5 rounded-full bg-line-strong" />
                <span className="size-2.5 rounded-full bg-line-strong" />
                <span className="size-2.5 rounded-full bg-primary/70" />
                <span className="ml-3 truncate font-[family-name:var(--font-mono)] text-[11px] text-faint">liora — ~/work/paygate</span>
                <span className="ml-auto hidden font-[family-name:var(--font-mono)] text-[10px] tracking-wider text-faint uppercase sm:inline">
                  {attach ? (ko ? "키보드 연결됨" : "keys live") : ko ? "클릭하여 연결" : "click to connect"}
                </span>
              </div>

              {/* transcript */}
              <div className="relative flex flex-1 flex-col justify-end overflow-hidden px-4 pt-4 pb-3 font-[family-name:var(--font-mono)] text-[12px] leading-[1.7] sm:px-5">
                {log.map((spans, i) => (
                  <div key={`${i}-${spans[1]?.[0] ?? ""}`} className="whitespace-pre-wrap break-words">
                    {spans.map((s, j) => (
                      <span key={j} className={toneClass[s[1]]}>
                        {s[0]}
                      </span>
                    ))}
                  </div>
                ))}
                <p className="mt-3 text-[10.5px] text-faint">{d.transcriptNote}</p>
              </div>

              {/* Worker Dock band */}
              {dockVisible && (
                <div className="relative border-t border-line bg-sunken/60 px-4 py-2 font-[family-name:var(--font-mono)] text-[11px] sm:px-5">
                  <div className="mb-1 flex items-center gap-2 text-faint">
                    <span>{d.dock.title}</span>
                    <span className="rounded border border-line px-1 text-[9.5px]">{d.dock.modes[dock]}</span>
                    <span className="ml-auto hidden text-[10px] sm:inline">{d.dock.hint}</span>
                  </div>
                  <button className="flex w-full items-center gap-2 text-left" onClick={() => setTreeOpen((o) => !o)} aria-expanded={treeOpen}>
                    <span className="w-3 text-faint">{treeOpen ? "▾" : "▸"}</span>
                    <span className={auditDone ? "text-mint" : "text-primary"}>{auditDone ? "✓" : "●"}</span>
                    <span className="text-azure">coord_7f2</span>
                    <span className="truncate text-dim">{ko ? "웹훅 호출부 조사" : "Audit webhook callers"}</span>
                    <span className="ml-auto shrink-0 text-faint">
                      {auditDone ? (ko ? "완료" : "finished") : ko ? "실행 중 · 워커 2" : "running · 2 workers"}
                    </span>
                  </button>
                  {treeOpen && (
                    <div className="pl-5 text-faint">
                      <p className="flex gap-2">
                        <span>├</span>
                        <span className={auditDone ? "text-mint" : "text-primary"}>{auditDone ? "✓" : "●"}</span>
                        <span className="text-dim">{ko ? "queue/ 훑어보기" : "scan queue/"}</span>
                      </p>
                      <p className="flex gap-2">
                        <span>└</span>
                        <span className="text-mint">✓</span>
                        <span className="text-dim">{ko ? "billing/ 훑어보기" : "scan billing/"}</span>
                      </p>
                    </div>
                  )}
                </div>
              )}

              {/* prompt */}
              <div className="relative flex items-center gap-2 border-t border-line px-4 py-2.5 font-[family-name:var(--font-mono)] text-[12.5px] sm:px-5">
                <span className="text-primary">❯</span>
                <input
                  ref={promptRef}
                  value={prompt}
                  onChange={(e) => setPrompt(e.target.value)}
                  onFocus={engage}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      run(prompt);
                      setPrompt("");
                      return;
                    }
                    // Empty-prompt shortcuts, exactly as the TUI gates them.
                    if (prompt === "" && !e.altKey && !e.ctrlKey && !e.metaKey) {
                      if (e.key === "q" || e.key === "Q") return e.preventDefault(), toggle("quota");
                      if (e.key === "?") return e.preventDefault(), toggle("hub");
                    }
                  }}
                  placeholder={d.promptPlaceholder}
                  aria-label={d.promptPlaceholder}
                  className="w-full bg-transparent text-ink outline-none placeholder:text-faint/80"
                />
              </div>

              {/* footer — real slots: mode · jobs · model · cwd · git · quota */}
              <div className="relative flex flex-wrap items-center gap-x-4 gap-y-1 border-t border-line bg-sunken/95 px-4 py-2 font-[family-name:var(--font-mono)] text-[10.5px] sm:px-5">
                <span className="font-semibold text-amber">YOLO</span>
                <span className={cn(counts.needs > 0 ? "text-amber" : "text-dim")}>
                  Jobs {counts.running} {ko ? "실행" : "running"}
                  {counts.needs > 0 ? ` · ${counts.needs} ${ko ? "답변 필요" : counts.needs === 1 ? "needs you" : "need you"}` : ""}
                </span>
                <span className="hidden text-ink sm:inline">opencode-go/kimi-k3</span>
                <span className="hidden text-dim md:inline">main*</span>
                <span className="ml-auto flex items-center gap-1 text-dim">
                  <span className="text-mint">▤</span>82%
                </span>
              </div>

              {/* ===== overlays ===== */}
              <OverlayShell on={overlay === "deck"} side="right" label={`${d.deck.title} — ${d.deck.subtitle}`} onClose={close}>
                <div className="space-y-4">
                  {(["blocked", "remaining", "done"] as const).map((bucket) => {
                    const rows = jobs.filter((j) => bucketOf(j.state) === bucket);
                    if (rows.length === 0) return null;
                    return (
                      <div key={bucket}>
                        <p className="mb-1.5 font-[family-name:var(--font-mono)] text-[10px] tracking-[0.16em] text-faint uppercase">
                          {d.deck.groups[bucket]} · {rows.length}
                        </p>
                        <div className="space-y-2">
                          {rows.map((j) => (
                            <div key={j.id} className="rounded-lg border border-line bg-black/40 p-3">
                              <div className="flex items-center gap-2">
                                <span className={cn("size-1.5 rounded-full", stateDot[j.state])} />
                                <span className="font-[family-name:var(--font-mono)] text-[11px] text-azure">{j.id}</span>
                                <span className={cn("ml-auto font-[family-name:var(--font-mono)] text-[10px]", stateTone[j.state])}>
                                  {d.deck.states[j.state]}
                                </span>
                              </div>
                              <p className="mt-1.5 text-[12.5px] text-ink">{j.title[locale]}</p>
                              <p className="mt-1 font-[family-name:var(--font-mono)] text-[10px] text-faint">
                                {j.kind} · {j.model} · {d.deck.worktree}
                              </p>
                              {(j.state === "running" || j.state === "needs_user") && (
                                <div className="mt-2 h-1 overflow-hidden rounded-full bg-white/5">
                                  <div className="h-full rounded-full bg-primary transition-all duration-300" style={{ width: `${j.progress}%` }} />
                                </div>
                              )}
                              {j.state === "needs_user" && (
                                <button
                                  onClick={() => setOverlay("inbox")}
                                  className="mt-2.5 rounded-md border border-amber/40 bg-amber/10 px-2.5 py-1 font-[family-name:var(--font-mono)] text-[10.5px] text-amber transition-colors hover:bg-amber/20"
                                >
                                  {d.deck.answer}
                                </button>
                              )}
                            </div>
                          ))}
                        </div>
                      </div>
                    );
                  })}
                  <p className="border-t border-line pt-3 font-[family-name:var(--font-mono)] text-[9.5px] leading-relaxed text-faint">{d.deck.actions}</p>
                </div>
              </OverlayShell>

              <OverlayShell on={overlay === "inbox"} side="center" label={`${d.inbox.title} — ${d.inbox.subtitle}`} onClose={close}>
                {inbox === "open" ? (
                  <div className="rounded-lg border border-line bg-black/40 p-4">
                    <p className="font-[family-name:var(--font-mono)] text-[10px] tracking-wider text-amber">{d.inbox.from}</p>
                    <p className="mt-3 text-[13px] leading-6 text-ink">{d.inbox.question}</p>
                    <div className="mt-4 flex flex-col gap-2">
                      {d.inbox.options.map((opt) => (
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
                      {d.inbox.answered}
                    </p>
                  </div>
                ) : (
                  <p className="p-4 text-[12.5px] text-faint">{d.inbox.empty}</p>
                )}
              </OverlayShell>

              <OverlayShell on={overlay === "hub"} side="center" label="Command Hub" onClose={close} wide>
                <div className="-m-3.5">
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
                          close();
                        }
                        e.stopPropagation();
                      }}
                      placeholder={d.hub.placeholder}
                      className="w-full bg-transparent font-[family-name:var(--font-mono)] text-[12.5px] text-ink outline-none placeholder:text-faint"
                    />
                  </div>
                  <div className="tui-lines max-h-[300px] overflow-y-auto p-2">
                    {filtered.length === 0 && <p className="px-3 py-4 text-[12px] text-faint">{d.hub.noMatch}</p>}
                    {filtered.map((it, i) => (
                      <div key={it.label}>
                        {(i === 0 || filtered[i - 1].group !== it.group) && (
                          <p className="px-3 pt-2 pb-1 font-[family-name:var(--font-mono)] text-[9.5px] tracking-[0.16em] text-faint uppercase">
                            {d.hub.groups[it.group]}
                          </p>
                        )}
                        <button
                          onMouseEnter={() => setHubIdx(i)}
                          onClick={() => hubEnter(i)}
                          className={cn("flex w-full items-center gap-3 rounded-lg px-3 py-1.5 text-left", hubIdx === i ? "bg-primary/[0.09]" : "")}
                        >
                          <span className={cn("size-1 rounded-full", hubIdx === i ? "bg-primary" : "bg-white/15")} />
                          <span className="text-[12.5px] text-ink">{it.label}</span>
                          <span className="ml-auto font-[family-name:var(--font-mono)] text-[10.5px] text-faint">{it.hint}</span>
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              </OverlayShell>

              <OverlayShell on={overlay === "quota"} side="left" label={d.quota.title} onClose={close}>
                <div className="space-y-3 p-1">
                  {d.quota.rows.map((r) => (
                    <div key={r.provider}>
                      <div className="flex items-baseline justify-between gap-2">
                        <p className="text-[12px] text-ink">{r.provider}</p>
                        <p className={cn("tick-num font-[family-name:var(--font-mono)] text-[11px]", quotaTone(r.pct))}>{r.pct}%</p>
                      </div>
                      <p className="font-[family-name:var(--font-mono)] text-[10px] text-faint">{r.detail}</p>
                      <div className="mt-1.5 h-1 overflow-hidden rounded-full bg-white/5">
                        <div className={cn("h-full rounded-full", quotaBar(r.pct))} style={{ width: `${r.pct}%` }} />
                      </div>
                    </div>
                  ))}
                  <p className="pt-1 font-[family-name:var(--font-mono)] text-[9.5px] leading-relaxed text-faint">{d.quota.note}</p>
                </div>
              </OverlayShell>
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
      aria-hidden={!on}
      className={cn(
        "ov absolute z-20 overflow-hidden rounded-xl border border-line bg-panel/97 shadow-[0_24px_70px_-20px_rgba(0,0,0,0.9)] backdrop-blur-xl",
        on && "on",
        side === "right" && "top-12 right-3 bottom-24 w-[min(340px,88%)] overflow-y-auto",
        side === "left" && "bottom-24 left-3 w-[min(320px,86%)]",
        side === "center" && (wide ? "inset-x-0 top-12 mx-auto w-[min(440px,92%)]" : "inset-x-0 top-14 mx-auto w-[min(400px,92%)]"),
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
