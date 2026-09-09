import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { cn } from "../utils/cn";

/* Scroll reveal wrapper */
export function Reveal({
  children,
  i = 0,
  className,
  as: Tag = "div",
}: {
  children: ReactNode;
  i?: number;
  className?: string;
  as?: "div" | "section" | "li" | "span";
}) {
  const ref = useRef<HTMLElement | null>(null);
  const [on, setOn] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (e.isIntersecting) {
            setOn(true);
            io.disconnect();
          }
        }
      },
      { threshold: 0.12, rootMargin: "0px 0px -8% 0px" },
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);

  return (
    <Tag
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ref={ref as any}
      style={{ "--i": i } as CSSProperties}
      className={cn("rv", on && "on", className)}
    >
      {children}
    </Tag>
  );
}

/* Section eyebrow + title + lede */
export function SectionHead({
  eyebrow,
  title,
  lede,
  align = "left",
}: {
  eyebrow: string;
  title: string;
  lede?: string;
  align?: "left" | "center";
}) {
  return (
    <div className={cn("max-w-3xl", align === "center" && "mx-auto text-center")}>
      <Reveal>
        <p className="font-[family-name:var(--font-mono)] text-[11px] tracking-[0.28em] text-primary uppercase">
          {eyebrow}
        </p>
      </Reveal>
      <Reveal i={1}>
        <h2 className="mt-4 font-[family-name:var(--font-display)] text-4xl leading-[1.06] font-semibold tracking-[-0.02em] text-ink sm:text-5xl">
          {title}
        </h2>
      </Reveal>
      {lede && (
        <Reveal i={2}>
          <p className="mt-5 text-[15.5px] leading-7 text-dim">{lede}</p>
        </Reveal>
      )}
    </div>
  );
}

/* keyboard cap */
export function KeyCap({ children, className }: { children: ReactNode; className?: string }) {
  return <kbd className={cn("kbd", className)}>{children}</kbd>;
}

/* copy-button hook */
export function useCopy(timeout = 1600) {
  const [copied, setCopied] = useState(false);
  const copy = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      const ta = document.createElement("textarea");
      ta.value = text;
      document.body.append(ta);
      ta.select();
      document.execCommand("copy");
      ta.remove();
    }
    setCopied(true);
    window.setTimeout(() => setCopied(false), timeout);
  };
  return { copied, copy };
}

/* small section border label */
export function RailMarker({ children }: { children: ReactNode }) {
  return (
    <div className="flex items-center gap-3 font-[family-name:var(--font-mono)] text-[10.5px] tracking-[0.22em] text-faint uppercase">
      <span className="h-px w-8 bg-primary/60" />
      {children}
    </div>
  );
}
