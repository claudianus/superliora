# SuperLiora site — visual QA checklist

Run after `pnpm -C apps/site run build && pnpm -C apps/site run preview`.

- [ ] Neon Noir palette: bg `#0D1422`, primary `#00D5FF` (no Blood Moon red brand)
- [ ] Hero first viewport: full-bleed AnsiStage + brand + one headline + one lead + CTAs (no stats/chips/cards)
- [ ] Stage frames come from committed `public/tui-frames/*.txt` (chrome-bands matches capture line-for-line)
- [ ] Scrolling cluster reels crossfades Stage scene; scrub dots track chapter
- [ ] `prefers-reduced-motion`: Stage autoplay off / no interval churn; reveals static
- [ ] Feature ribbons are a horizontal rail (not a card grid); hover underline + 1px shift
- [ ] Control keys strip includes Alt+J/I/B, Ctrl+K, Shift-Tab
- [ ] KO `/` and EN `/en/` copy parity (same sections / 4 clusters)
- [ ] Docs: five pages under `/docs/` and `/en/docs/`
- [ ] Mobile 375px: Stage scrolls horizontally inside frame, page does not overflow
- [ ] Banned copy smoke: `pnpm -C apps/site run check:copy` passes
