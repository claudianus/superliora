# SuperLiora site — visual QA checklist

Run after `pnpm -C apps/site run build && pnpm -C apps/site run preview`.

Art direction: Neon Noir product landing — brand first · curated ProductFrame · no ANSI dump.  
Palette SSOT: bg `#0D1422`, primary `#00D5FF`. Type: Syne + JetBrains Mono + Pretendard.

## Checklist

- [ ] Neon Noir palette: bg `#0D1422`, primary `#00D5FF` (no Blood Moon red brand)
- [ ] Hero first viewport: brand + H1 + lead + CTA read before the ProductFrame
- [ ] No sticky AnsiStage / no `public/tui-frames` playback / no copy-over-ASCII overlay
- [ ] ProductFrame is curated HTML (Job / Board / Worker) — not conductor chore text
- [ ] Desktop ≥1024: hero is split (copy | frame); no overlap
- [ ] Mobile: copy+CTA stack above ProductFrame; frame does not bury the headline
- [ ] Mobile hamburger opens drawer with Features / Usage / Workflow / Install / Docs (Escape closes)
- [ ] Desktop ≥1024: main nav links visible; burger hidden
- [ ] Features / Usage / Workflow / Tower / Install are normal vertical sections (no right-rail museum)
- [ ] Each of 4 clusters shows a curated TUI HTML mock (Status Route, Job Deck+Worker Dock, Command Hub, Diff Studio)
- [ ] How and Tower sections include a visual panel beside copy
- [ ] Feature lists use bento grid — no horizontal scroll rails
- [ ] Motion: reveal / tilt / bento hover / demo pulses; `prefers-reduced-motion` disables them
- [ ] Fluid type: hero/section titles scale toward 4K (`clamp`)
- [ ] KO `/` and EN `/en/` copy parity (same sections / 4 clusters)
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
| Features bento | 1440×900 | `apps/site/.visual-qa/after/features-bento-1440.png` |

VerifySurface: `apps/site/.visual-qa/after/verify-surface.png`
