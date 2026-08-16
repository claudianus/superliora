# SuperLiora site — visual QA checklist

Run after `pnpm -C apps/site run build && pnpm -C apps/site run preview`.

Art direction: cinematic Neon Noir — full-bleed hero · ProductFrame below fold · no ANSI dump.  
Palette SSOT: bg `#0D1422`, primary `#00D5FF`. Type: Syne + JetBrains Mono + Pretendard.

## Checklist

- [ ] Neon Noir palette: bg `#0D1422`, primary `#00D5FF` (no Blood Moon red brand)
- [ ] First paint: `html[data-theme]` + `color-scheme` are stored value or default `dark`; Canvas/body match tokens (no white flash)
- [ ] Light toggle / `localStorage=light` reload: no dark WebGL shader, no `screen` blend islands, no hard-coded `#060a12` islands
- [ ] Hero first viewport: brand + H1 + lead + CTA + **one** atmosphere plane (cinematic full-bleed)
- [ ] ProductFrame is **outside** the hero band (product band below the fold)
- [ ] No sticky AnsiStage / no `public/tui-frames` playback / no copy-over-ASCII overlay
- [ ] ProductFrame is curated HTML (Job / Board / Worker) — not conductor chore text
- [ ] Desktop ≥1024: asymmetric copy on full-bleed plane; no card-hero split
- [ ] Mobile: copy+CTA readable over atmosphere; frame does not bury the headline
- [ ] Mobile hamburger opens drawer with Features / Usage / Workflow / Install / Docs (Escape closes)
- [ ] Desktop ≥1024: main nav links visible; burger hidden
- [ ] Features / Usage / Workflow / Tower / Install are normal vertical sections (no right-rail museum)
- [ ] Feature lists use bento/pillar grid — no horizontal scroll rails
- [ ] Motion: reveal / tilt / demo pulses; `prefers-reduced-motion` disables them
- [ ] Fluid type: hero/section titles scale toward 4K (`clamp`)
- [ ] KO `/` and EN `/en/` copy parity (same sections)
- [ ] Docs share the same theme bootstrap + mesh tokens
- [ ] Banned copy smoke: `pnpm -C apps/site run check:copy` passes
- [ ] Live Pages returns HTTP 200 after deploy (`https://claudianus.github.io/superliora/`)

## Viewports (screenshot proof)

Capture after preview (`BASE` = `/superliora/`):

| Viewport | Size | Evidence path |
|---|---|---|
| Mobile | 390×844 | `apps/site/.visual-qa/after/mobile-390.png` (+ `mobile-390-menu.png`) |
| Tablet | 768×1024 | `apps/site/.visual-qa/after/tablet-768.png` |
| Desktop | 1440×900 | `apps/site/.visual-qa/after/desktop-1440.png` |
| Wide / 4K | ≥2560×1440 | `apps/site/.visual-qa/after/wide-2560.png` |
| EN desktop | 1440×900 | `apps/site/.visual-qa/after/en-desktop-1440.png` |
| Dark first paint | 1440×900 | `apps/site/.visual-qa/after/dark-first-paint-1440.png` |
| Light home | 1440×900 | `apps/site/.visual-qa/after/light-home-1440.png` |
| Docs KO | 1440×900 | `apps/site/.visual-qa/after/docs-getting-started-1440.png` |
| Features bento | 1440×900 | `apps/site/.visual-qa/after/features-bento-1440.png` |

VerifySurface: `apps/site/.visual-qa/after/verify-surface.png`  
Rubric: `apps/site/.visual-qa/after/rubric.md`
