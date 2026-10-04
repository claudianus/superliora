import { useEffect, useRef, useState } from "react";
import { useLocale } from "../i18n";
import { buildSession, INITIAL_CHIPS, SPINNER, toneClass, type Chips, type Span, type Step } from "./session";
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
  const chips: Chips = { ...INITIAL_CHIPS };
  const lines: Span[][] = [];
  for (const step of steps) {
    // The trailing reset clears the dock for the next loop; the still frame keeps it.
    if (step.k === "chips" && !("dock" in step.patch && step.patch.dock === undefined)) Object.assign(chips, step.patch);
    if (step.k === "line") lines.push(step.spans);
    if (step.k === "task") lines.push([["  ✓ ", "mint"], ...step.spans]);
  }
  return { chips, lines };
}

export default function TuiEmulator({ className }: { className?: string }) {
  const { locale, t } = useLocale();
  const [lines, setLines] = useState<Line[]>([]);
  const [typed, setTyped] = useState("");
  const [phase, setPhase] = useState<"typing" | "run">("typing");
  const [chips, setChips] = useState<Chips>(INITIAL_CHIPS);
  const [pending, setPending] = useState<Span[] | null>(null);
  const [spin, setSpin] = useState(0);
  const idRef = useRef(0);
  const scrollRef = useRef<HTMLDivElement>(null);
  const reducedRef = useRef(false);

  /* spinner (skipped entirely under reduced motion) */
  useEffect(() => {
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    reducedRef.current = reduced;
    if (reduced) return;
    const iv = setInterval(() => setSpin((s) => (s + 1) % SPINNER.length), 72);
    return () => clearInterval(iv);
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
        setChips(fc);
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
                ["❯ ", "primary"],
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
        <span className="size-2.5 rounded-full bg-line-strong" />
        <span className="size-2.5 rounded-full bg-line-strong" />
        <span className="size-2.5 rounded-full bg-primary/70" />
        <span className="ml-3 font-[family-name:var(--font-mono)] text-[11px] text-faint">
          {t.tui.windowTitle}
        </span>
        <span className="ml-auto flex items-center gap-2 font-[family-name:var(--font-mono)] text-[10px] tracking-wider text-primary/90 uppercase">
          <span className="pingdot inline-block size-1.5 rounded-full bg-primary" />
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
            <span className="text-primary">  {SPINNER[spin]} </span>
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
            <span className="text-primary">❯ </span>
            <span className="text-ink-strong">{typed}</span>
            <span className="caret ml-0.5 inline-block h-[14px] w-[7px] translate-y-[2px] bg-primary" />
          </div>
        )}
      </div>

      {/* Worker Dock band (auto mode: visible while a handed-off session exists) */}
      <div
        className={cn(
          "relative overflow-hidden border-t border-line bg-sunken/60 font-[family-name:var(--font-mono)] text-[11px] transition-[max-height,opacity] duration-300",
          chips.dock ? "max-h-10 opacity-100" : "max-h-0 opacity-0",
        )}
        aria-hidden={!chips.dock}
      >
        {chips.dock && (
          <div className="flex items-center gap-2 px-4 py-1.5 sm:px-5">
            <span className="text-faint">Worker Dock</span>
            <span className="text-faint">▾</span>
            <span className={chips.dock.state === "running" ? "text-primary" : "text-mint"}>
              {chips.dock.state === "running" ? SPINNER[spin] : "✓"}
            </span>
            <span className="text-azure">{chips.dock.id}</span>
            <span className="truncate text-dim">{chips.dock.label}</span>
            <span className={cn("ml-auto shrink-0", chips.dock.state === "running" ? "text-primary" : "text-mint")}>
              {t.tui.dock[chips.dock.state]}
            </span>
          </div>
        )}
      </div>

      {/* status bar — the real footer slots: mode · model · cwd · git · quota */}
      <div className="relative flex flex-wrap items-center gap-x-4 gap-y-1 border-t border-line bg-black/30 px-4 py-2 font-[family-name:var(--font-mono)] text-[10.5px] sm:px-5">
        <span className="font-semibold text-amber">YOLO</span>
        <span className="hidden text-ink sm:inline">{chips.model}</span>
        <span className="text-dim">~/work/paygate</span>
        <span className="text-dim">{chips.branch}</span>
        <span className="flex items-center gap-1 text-dim">
          <span className="text-mint">▤</span>
          <span className="tick-num">{chips.quota}%</span>
        </span>
        <span className="ml-auto hidden text-faint md:inline">{t.tui.hints}</span>
      </div>
    </div>
  );
}
