import { useEffect, useState } from "react";
import { useLocale } from "../i18n";
import { cn } from "../utils/cn";

export function GithubIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 16 16" fill="currentColor" className={className} aria-hidden>
      <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27s1.36.09 2 .27c1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.01 8.01 0 0 0 16 8c0-4.42-3.58-8-8-8Z" />
    </svg>
  );
}

export function Wordmark({ className }: { className?: string }) {
  return (
    <span className={cn("flex items-center gap-2.5", className)}>
      <svg viewBox="0 0 32 32" className="size-[18px]" aria-hidden>
        <path
          d="M16 3v6M16 23v6M3 16h6M23 16h6M7.8 7.8l4.2 4.2M20 20l4.2 4.2M24.2 7.8L20 12M12 20l-4.2 4.2"
          stroke="currentColor"
          strokeWidth="2.6"
          strokeLinecap="round"
          className="text-gold"
        />
      </svg>
      <span className="font-[family-name:var(--font-mono)] text-[15px] font-medium tracking-tight text-ink">
        superliora
      </span>
    </span>
  );
}

export default function Header() {
  const { t, locale, setLocale } = useLocale();
  const [scrolled, setScrolled] = useState(false);
  const [prog, setProg] = useState(0);

  useEffect(() => {
    const onScroll = () => {
      setScrolled(window.scrollY > 24);
      const h = document.documentElement;
      const max = h.scrollHeight - h.clientHeight;
      setProg(max > 0 ? Math.min(1, h.scrollTop / max) : 0);
    };
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  return (
    <header
      className={cn(
        "fixed inset-x-0 top-0 z-50 transition-all duration-500",
        scrolled ? "border-b border-line bg-paper/80 backdrop-blur-xl" : "bg-transparent",
      )}
    >
      <div className="mx-auto flex h-[60px] max-w-6xl items-center gap-6 px-5">
        <a href="#top" className="shrink-0">
          <Wordmark />
        </a>

        <nav className="ml-2 hidden items-center gap-1 md:flex">
          {t.header.nav.map((n) => (
            <a
              key={n.href}
              href={n.href}
              className="rounded-md px-3 py-1.5 text-[13px] text-dim transition-colors hover:bg-white/[0.04] hover:text-ink"
            >
              {n.label}
            </a>
          ))}
        </nav>

        <div className="ml-auto flex items-center gap-2.5">
          <span className="hidden rounded-full border border-line px-2.5 py-1 font-[family-name:var(--font-mono)] text-[10.5px] text-faint sm:inline">
            {t.header.version}
          </span>

          {/* locale toggle */}
          <div className="flex items-center rounded-full border border-line p-0.5" role="group" aria-label="language">
            {(["ko", "en"] as const).map((l) => (
              <button
                key={l}
                onClick={() => setLocale(l)}
                className={cn(
                  "rounded-full px-2.5 py-1 font-[family-name:var(--font-mono)] text-[10.5px] tracking-wide transition-all",
                  locale === l ? "bg-gold text-black" : "text-faint hover:text-dim",
                )}
                aria-pressed={locale === l}
              >
                {l === "ko" ? "한" : "EN"}
              </button>
            ))}
          </div>

          <a
            href="https://github.com/claudianus/superliora"
            target="_blank"
            rel="noreferrer"
            className="flex items-center gap-2 rounded-full border border-line px-3.5 py-1.5 text-[12.5px] text-dim transition-colors hover:border-gold/50 hover:text-ink"
          >
            <GithubIcon className="size-3.5" />
            <span className="hidden sm:inline">{t.header.github}</span>
          </a>
        </div>
      </div>
      {/* scroll progress — the baton */}
      <div className="absolute inset-x-0 bottom-0 h-[2px]">
        <div
          className="h-full bg-gradient-to-r from-golddeep to-gold transition-[width] duration-150 ease-out"
          style={{ width: `${prog * 100}%` }}
        />
      </div>
    </header>
  );
}
