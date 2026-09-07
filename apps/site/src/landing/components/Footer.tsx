import { ArrowUpRight } from "lucide-react";
import { useLocale } from "../i18n";
import { GithubIcon, Wordmark } from "./Header";
import { Reveal } from "./shared";

export default function Footer() {
  const { t } = useLocale();

  return (
    <footer className="relative overflow-hidden border-t border-line">
      <div className="mx-auto max-w-6xl px-5 pt-20 pb-10">
        <div className="grid gap-14 lg:grid-cols-[1.2fr_1fr]">
          <div>
            <Wordmark />
            <p className="mt-6 max-w-sm font-[family-name:var(--font-display)] text-2xl leading-snug font-medium tracking-[-0.01em] text-ink">
              {t.footer.tagline}
            </p>
            <p className="mt-6 max-w-md font-[family-name:var(--font-mono)] text-[10.5px] leading-relaxed text-faint">
              {t.footer.localeNote}
            </p>
          </div>

          <div className="grid grid-cols-2 gap-8">
            {t.footer.columns.map((col) => (
              <div key={col.title}>
                <p className="font-[family-name:var(--font-mono)] text-[10.5px] tracking-[0.22em] text-faint uppercase">
                  {col.title}
                </p>
                <ul className="mt-4 space-y-2.5">
                  {col.links.map((l) => (
                    <li key={l.href}>
                      <a
                        href={l.href}
                        target="_blank"
                        rel="noreferrer"
                        className="group inline-flex items-center gap-1 text-[13.5px] text-dim transition-colors hover:text-gold"
                      >
                        {l.label}
                        <ArrowUpRight className="size-3 opacity-0 transition-opacity group-hover:opacity-100" />
                      </a>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </div>

        <Reveal>
          <div className="mt-16 select-none overflow-hidden" aria-hidden>
            <p className="outline-word whitespace-nowrap font-[family-name:var(--font-display)] text-[13vw] leading-[0.95] font-bold tracking-[-0.04em] lg:text-[150px]">
              superliora
            </p>
          </div>
        </Reveal>

        <div className="mt-10 flex flex-col gap-3 border-t border-line pt-8 sm:flex-row sm:items-center sm:justify-between">
          <p className="font-[family-name:var(--font-mono)] text-[10.5px] text-faint">{t.footer.license}</p>
          <p className="font-[family-name:var(--font-mono)] text-[10.5px] text-faint">{t.footer.colophon}</p>
          <a
            href="https://github.com/claudianus/superliora"
            target="_blank"
            rel="noreferrer"
            className="flex items-center gap-2 text-faint transition-colors hover:text-gold"
          >
            <GithubIcon className="size-4" />
          </a>
        </div>
      </div>
    </footer>
  );
}
