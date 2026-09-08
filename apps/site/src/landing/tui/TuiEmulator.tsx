import { useEffect, useRef, useState } from "react";
import { useLocale } from "../i18n";
import { buildSession, SPINNER, toneClass, type Chips, type Span, type Step } from "./session";
import { cn } from "../utils/cn";

interface Line {
  id: number;
  spans: Span[];
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/* Final on-screen state of the session: reduced-motion users get this as a
   static frame instead of a dead prompt, so the terminal always shows work. */
function finalFrame(locale: Parameters<typeof buildSession>[0]): { chips: Chips; lines: Span[][] } {
  const steps = buildSession(locale) as Step[];
  const chips: Chips = {
    model: "opencode-go/kimi-k3",
    quota: 82,
    inbox: 0,
    latency: "—",
    branch: "main*",
  };
  const lines: Span[][] = [];
  for (const step of steps) {
    if (step.k === "chips") Object.assign(chips, step.patch);
    if (step.k === "line") lines.push(step.spans);
  }
  return { chips, lines };
}

export default function TuiEmulator({ className }: { className?: string }) {
  const { locale, t } = useLocale();
  const [lines, setLines] = useState<Line[]>([]);
  const [typed, setTyped] = useState("");
  const [phase, setPhase] = useState<"typing" | "run">("typing");
  const [chips, setChips] = useState<Chips>({
    model: "opencode-go/kimi-k3",
    quota: 82,
    inbox: 0,
    latency: "—",
    branch: "main*",
  });
  const [pending, setPending] = useState<Span[] | null>(null);
  const [spin, setSpin] = useState(0);
  const [jitter, setJitter] = useState(0);
  const idRef = useRef(0);
  const scrollRef = useRef<HTMLDivElement>(null);
  const reducedRef = useRef(false);

  /* spinner + ambient latency jitter (skipped entirely under reduced motion) */
  useEffect(() => {
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    reducedRef.current = reduced;
    if (reduced) return;
    const iv = setInterval(() => setSpin((s) => (s + 1) % SPINNER.length), 72);
    const jv = setInterval(() => setJitter(Math.floor(Math.random() * 24)), 1400);
    return () => {
      clearInterval(iv);
      clearInterval(jv);
    };
  }, []);

  /* session runner — paints the session end-state as a static frame when the
     user prefers reduced motion, and runs the animated loop otherwise. */
  useEffect(() => {
    let cancelled = false;
    const reduced = reducedRef.current;

    const push = (spans: Span[]) => setLines((ls) => [...ls, { id: ++idRef.current, spans }]);

    const run = async () => {
      if (reduced) {
        const { chips: fc, lines: fl } = finalFrame(locale);
        setChips((c) => ({ ...c, ...fc }));
        setPending(null);
        setTyped("");
        setPhase("run");
        setLines([]);
        for (const spans of fl) push(spans);
        return;
      }

      for (;;) {
        const steps = buildSession(locale);
        setLines([]);
        setTyped("");
        setPhase("typing");
        let currentTyped = "";

        for (const step of steps as Step[]) {
          if (cancelled) return;
          switch (step.k) {
            case "chips":
              setChips((c) => ({ ...c, ...step.patch }));
              break;

            case "type": {
              await sleep(380);
              for (let i = 1; i <= step.text.length; i++) {
                if (cancelled) return;
                currentTyped = step.text.slice(0, i);
                setTyped(currentTyped);
                await sleep(15 + Math.random() * 26);
              }
              await sleep(240);
              break;
            }

            case "enter":
              setPhase("run");
              push([
                ["❯ ", "gold"],
                [currentTyped, "w"],
              ]);
              await sleep(140);
              break;

            case "line":
              push(step.spans);
              await sleep(150);
              break;

            case "task": {
              setPending(step.spans);
              await sleep(step.dur ?? 700);
              if (cancelled) return;
              setPending(null);
              push([["  ✓ ", "mint"], ...step.spans]);
              break;
            }

            case "pause":
              await sleep(step.ms);
              break;

            case "clear":
              await sleep(300);
              setLines([]);
              setTyped("");
              setPhase("typing");
              currentTyped = "";
              break;
          }
        }
        if (cancelled) return;
      }
    };

    void run();
    return () => {
      cancelled = true;
    };
  }, [locale]);

  /* keep scroll pinned to bottom */
  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [lines, typed, pending]);

  return (
    <div className={cn("tui scan relative overflow-hidden rounded-2xl", className)}>
      {/* titlebar */}
      <div className="relative flex items-center gap-2 border-b border-line px-4 py-2.5">
        <span className="size-2.5 rounded-full bg-[#3a3e45]" />
        <span className="size-2.5 rounded-full bg-[#3a3e45]" />
        <span className="size-2.5 rounded-full bg-gold/70" />
        <span className="ml-3 font-[family-name:var(--font-mono)] text-[11px] text-faint">
          {t.tui.windowTitle}
        </span>
        <span className="ml-auto flex items-center gap-2 font-[family-name:var(--font-mono)] text-[10px] tracking-wider text-gold/90 uppercase">
          <span className="pingdot inline-block size-1.5 rounded-full bg-gold" />
          {t.tui.liveTag}
        </span>
      </div>

      {/* transcript */}
      <div
        ref={scrollRef}
        className="tui-lines relative h-[340px] overflow-y-auto px-4 py-4 font-[family-name:var(--font-mono)] text-[12.5px] leading-[1.65] sm:h-[380px] sm:px-5"
      >
        {lines.map((l) => (
          <div key={l.id} className="whitespace-pre-wrap break-words">
            {l.spans.map((s, i) => (
              <span key={i} className={toneClass[s[1]]}>
                {s[0]}
              </span>
            ))}
          </div>
        ))}

        {/* pending task spinner line */}
        {pending && (
          <div className="whitespace-pre-wrap break-words">
            <span className="text-gold">  {SPINNER[spin]} </span>
            {pending.map((s, i) => (
              <span key={i} className={toneClass[s[1]]}>
                {s[0]}
              </span>
            ))}
          </div>
        )}

        {/* prompt */}
        {phase === "typing" && (
          <div className="mt-1 whitespace-pre-wrap break-words">
            <span className="text-gold">❯ </span>
            <span className="text-[#fff6e3]">{typed}</span>
            <span className="caret ml-0.5 inline-block h-[14px] w-[7px] translate-y-[2px] bg-gold" />
          </div>
        )}
      </div>

      {/* status bar */}
      <div className="relative flex flex-wrap items-center gap-x-4 gap-y-1 border-t border-line bg-black/30 px-4 py-2 font-[family-name:var(--font-mono)] text-[10.5px] sm:px-5">
        <span className="flex items-center gap-1.5 text-gold">
          <span className="inline-block size-1.5 animate-pulse rounded-full bg-gold" />
          CONDUCT
        </span>
        <span className="text-dim">{chips.branch}</span>
        <span className="hidden text-faint sm:inline">{chips.model}</span>
        <span className="flex items-center gap-1 text-dim">
          <span className="text-mint">▤</span>
          {chips.quota}%
        </span>
        {chips.inbox > 0 && (
          <span className="flex items-center gap-1 rounded bg-gold/15 px-1.5 py-0.5 text-gold">▣{chips.inbox} inbox</span>
        )}
        <span className="tick-num text-faint">{chips.latency === "—" ? `~${38 + jitter}ms` : chips.latency}</span>
        <span className="ml-auto text-faint">{t.tui.hints}</span>
      </div>
    </div>
  );
}
