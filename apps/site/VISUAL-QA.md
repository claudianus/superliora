# SuperLiora site — visual QA checklist

Run after `pnpm -C apps/site run build && pnpm -C apps/site run preview`.

- [ ] Neon Noir palette: bg `#0D1422`, primary `#00D5FF` (no Blood Moon red brand)
- [ ] Hero first viewport: brand + one headline + one lead + CTAs + full-bleed Theatre (no stats/chips/cards)
- [ ] Theatre plays 10 beats; chapter buttons jump; reduced-motion starts paused
- [ ] KO `/` and EN `/en/` copy parity (same sections)
- [ ] Docs: five pages under `/docs/` and `/en/docs/`
- [ ] Mobile 375px: Theatre scrolls horizontally inside frame, page does not overflow
- [ ] Banned copy smoke: `node apps/site/scripts/check-banned-copy.mjs` passes
