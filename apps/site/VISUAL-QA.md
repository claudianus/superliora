# SuperLiora site — visual QA checklist

Run after `pnpm -C apps/site run build && pnpm -C apps/site run preview`.

- [ ] Neon Noir palette: bg `#0D1422`, primary `#00D5FF` (no Blood Moon red brand)
- [ ] Hero first viewport: AnsiStage chrome visible below nav (traffic lights not buried)
- [ ] Hero Stage starts on dense frame (`chrome-bands`); not a sparse empty void
- [ ] Desktop ≥1024: cluster panel is right rail (~46%); Stage stays visible and crossfades on scroll
- [ ] Mobile: Stage ~48dvh sticky; features stack below without covering Stage forever
- [ ] Stage frames from committed `public/tui-frames/*.txt` (chrome-bands matches capture)
- [ ] Scrub dots track chapter; `prefers-reduced-motion` pauses autoplay
- [ ] Feature ribbons are a horizontal rail (not a card grid)
- [ ] Control keys strip includes Alt+J/I/B, Ctrl+K, Shift-Tab
- [ ] KO `/` and EN `/en/` copy parity (same sections / 4 clusters)
- [ ] Banned copy smoke: `pnpm -C apps/site run check:copy` passes
