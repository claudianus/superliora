# SuperLiora site — visual QA checklist

Run after `pnpm -C apps/site run build && pnpm -C apps/site run preview`.

Art direction: Neon Noir museum landing — cinematic · precise · luminous.  
Palette SSOT: bg `#0D1422`, primary `#00D5FF`. Type: Syne + JetBrains Mono + Pretendard.

## Checklist

- [ ] Neon Noir palette: bg `#0D1422`, primary `#00D5FF` (no Blood Moon red brand)
- [ ] Hero first viewport: AnsiStage chrome visible below nav (traffic lights not buried)
- [ ] Hero Stage starts on dense frame (`chrome-bands`); not a sparse empty void
- [ ] Desktop ≥1024: cluster panel is right rail (~46–50%); Stage stays visible and crossfades on scroll
- [ ] Mobile/tablet: Stage ~52–58dvh sticky; features stack below without covering Stage forever
- [ ] Mobile/tablet: hamburger opens drawer with Features / Flow / Install / Docs (Escape closes)
- [ ] Desktop ≥1024: main nav links visible; burger hidden
- [ ] Fluid type: hero/section titles scale toward 4K (`clamp`); section-pad grows with viewport
- [ ] Stage frames from committed `public/tui-frames/*.txt` (chrome-bands matches capture)
- [ ] Scrub dots track chapter; `prefers-reduced-motion` pauses autoplay
- [ ] Feature ribbons are a horizontal rail (not a card grid)
- [ ] Control keys strip includes Alt+J/I/B, Ctrl+K, Shift-Tab
- [ ] KO `/` and EN `/en/` copy parity (same sections / 4 clusters)
- [ ] Banned copy smoke: `pnpm -C apps/site run check:copy` passes

## Viewports (screenshot proof)

Capture after preview (`BASE` = `/superliora/`):

| Viewport | Size | Evidence path |
|---|---|---|
| Mobile | 390×844 | `apps/site/.visual-qa/after/mobile-390.png` (+ `mobile-390-menu.png`) |
| Tablet | 768×1024 | `apps/site/.visual-qa/after/tablet-768.png` |
| Desktop | 1440×900 | `apps/site/.visual-qa/after/desktop-1440.png` |
| Wide / 4K | ≥2560×1440 | `apps/site/.visual-qa/after/wide-2560.png` |

VerifySurface (load + interaction): `apps/site/.visual-qa/after/verify-surface.png`

### Craft audit note

Mechanical `VerifySurface` craft scan matches `\btodo\b` and flags product chrome **Todo Board** (real TUI feature name in `public/tui-frames/` + copy). That is a false positive against Neon Noir museum frames — do not rename the product surface to silence the scanner. Score craft via human screenshot review + `check:copy`.
