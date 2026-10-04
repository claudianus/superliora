import { ArrowUpRight } from "lucide-react";
import { useLocale } from "../i18n";
import type { DocSlug, NavItem } from "../i18n/types";
import { GithubIcon, Wordmark } from "./Header";
import { LIORA_VERSION, RELEASE_URL, REPO_URL, Reveal, docsHref } from "./shared";

const GUIDES: DocSlug[] = ["getting-started", "how-conductor-works", "jobs", "control-tower", "reference"];

function Column({ title, links, external }: { title: string; links: NavItem[]; external: boolean }) {
  return (
    <div>
      <p className="font-[family-name:var(--font-mono)] text-[10.5px] tracking-[0.22em] text-faint uppercase">{title}</p>
      <ul className="mt-4 space-y-2.5">
        {links.map((l) => (
          <li key={l.href}>
            <a
              href={l.href}
              {...(external ? { target: "_blank", rel: "noreferrer" } : {})}
              className="group inline-flex items-center gap-1 text-[13.5px] text-dim transition-colors hover:text-primary"
            >
              {l.label}
              {external && <ArrowUpRight className="size-3 opacity-0 transition-opacity group-hover:opacity-100" />}
            </a>
          </li>
        ))}
      </ul>
    </div>
  );
}

export default function Footer() {
  const { t, locale } = useLocale();
  const f = t.footer;
  const guides = GUIDES.map((slug) => ({ label: f.guides.labels[slug], href: docsHref(locale, slug) }));

  return (
    <footer className="relative overflow-hidden border-t border-line">
      <div className="mx-auto max-w-6xl px-5 pt-20 pb-10">
        <div className="grid gap-14 lg:grid-cols-[1fr_1.4fr]">
          <div>
            <Wordmark />
            <p className="mt-6 max-w-sm font-[family-name:var(--font-display)] text-2xl leading-snug font-medium tracking-[-0.01em] text-ink">
              {f.tagline}
            </p>
            <p className="mt-6 max-w-md font-[family-name:var(--font-mono)] text-[10.5px] leading-relaxed text-faint">{f.localeNote}</p>
          </div>

          <div className="grid grid-cols-2 gap-8 sm:grid-cols-3">
            <Column title={f.project.title} links={f.project.links} external />
            <Column title={f.guides.title} links={guides} external={false} />
            <Column title={f.community.title} links={f.community.links} external />
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
          <p className="font-[family-name:var(--font-mono)] text-[10.5px] text-faint">{f.license}</p>
          <p className="font-[family-name:var(--font-mono)] text-[10.5px] text-faint">
            {f.colophon} ·{" "}
            <a href={RELEASE_URL} target="_blank" rel="noreferrer" className="text-dim hover:text-primary">
              v{LIORA_VERSION}
            </a>
          </p>
          <a href={REPO_URL} target="_blank" rel="noreferrer" aria-label="GitHub" className="flex items-center gap-2 text-faint transition-colors hover:text-primary">
            <GithubIcon className="size-4" />
          </a>
        </div>
      </div>
    </footer>
  );
}
