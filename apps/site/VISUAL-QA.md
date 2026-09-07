# SuperLiora site — visual QA checklist

Run after `pnpm -C apps/site run build && pnpm -C apps/site exec vite preview --host 127.0.0.1 --port 4176`,
then `node apps/site/scripts/capture-visual-qa.mjs` (or the local `capture-visual-qa-local.mjs` with `BASE_URL=http://127.0.0.1:4176/superliora/`).

Art direction: **Conductor Gold Noir** — dark ink-paper stage, gold baton accents, live Job-console
storytelling (Flow → Control Room demo → Systems → Surfaces → Install).  
Palette SSOT: paper `#0a0b0d`, ink `#ece7dc`, gold `#f2b94b` (`src/landing/landing.css` `@theme`).
Type: Space Grotesk + IBM Plex Mono + Pretendard. Landing is dark-only; docs pages keep the legacy
theme bootstrap (they are a separate entry with their own stylesheet).

## Checklist

- [ ] Landing palette: paper `#0a0b0d` + gold `#f2b94b` accents; no legacy `#0D1422`/cyan islands on `/` and `/en/`
- [ ] First paint: `body` background matches `--color-paper` (no white flash); fixed header with scroll-progress baton under it
- [ ] Hero: eyebrow + two-line headline + one-line install (copy button works) + Node 24.15.0 note + CTAs `#install`/GitHub + platform row + stats
- [ ] Nav anchors `#flow #demo #systems #surfaces #install` each land on a rendered section (see `id=` in `src/landing/components/`)
- [ ] Flow section: numbered score steps with staff-line background
- [ ] Control Room demo: TUI emulator replays a session; overlays (deck / inbox / hub / quota / plan) switch and are readable
- [ ] Systems: numbered cards + provider strip + failover rail render in both locales
- [ ] Surfaces: CLI / Server / SDK / IDE tabs swap content; mono command rows stay on one line
- [ ] Install: three OS tabs with the shipped one-liners (must equal `src/content.ts` and README)
- [ ] Footer: columns link GitHub/Releases/Issues and the Pages docs URLs; MIT line present
- [ ] ko/EN toggle persists, updates `<html lang>` and the document title; `/` auto-detects, `/en/` boots English
- [ ] Reveal motion: `.rv` sections fade in on scroll and never stay invisible above the fold; `prefers-reduced-motion` shows everything
- [ ] Mobile 390: headline/install/CTA readable; nav collapses (no hamburger by design); tables/cards stack without h-scroll
- [ ] Wide 2560+: content capped at `max-w-6xl`, background texture fills, no stretched type
- [ ] Docs pages unchanged: legacy list/theme, back-to-landing link goes to `/` (ko) or `/en/`
- [ ] Banned copy smoke: `pnpm -C apps/site run check:copy` passes
- [ ] Live Pages returns HTTP 200 after deploy (`https://claudianus.github.io/superliora/`)

## Viewports (screenshot proof)

Capture against preview (`BASE_URL` = `http://127.0.0.1:4176/superliora/`):

| Viewport | Size | Evidence path |
|---|---|---|
| Mobile | 390×844 | `apps/site/.visual-qa/after/mobile-390.png` |
| Tablet | 768×1024 | `apps/site/.visual-qa/after/tablet-768.png` |
| Desktop | 1440×900 | `apps/site/.visual-qa/after/desktop-1440.png` |
| Wide / 4K | ≥2560×1440 | `apps/site/.visual-qa/after/wide-2560.png` |
| EN desktop | 1440×900 | `apps/site/.visual-qa/after/en-desktop-1440.png` |
| First paint | 1440×900 | `apps/site/.visual-qa/after/first-paint-1440.png` |
| Demo console | 1440×900 | `apps/site/.visual-qa/after/demo-console-1440.png` |
| Install | 1440×900 | `apps/site/.visual-qa/after/install-section-1440.png` |
| Docs KO | 1440×900 | `apps/site/.visual-qa/after/docs-getting-started-1440.png` |
