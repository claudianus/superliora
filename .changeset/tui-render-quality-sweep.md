---
"@superliora/liora": patch
---

TUI quality sweep: fix render and input bugs found in a full TUI render-surface audit.

- Model fallback reorder (Ctrl+↑/↓) now works on Kitty-protocol terminals: the renderer decodes the xterm modifier arrow family (`\x1B[1;5A` etc.) instead of leaving the chord dead.
- The prompt editor no longer drops the remaining key events of a coalesced stdin chunk after the autocomplete menu handles one key.
- Multi-agent failure bodies and oversized shell-command echoes are windowed instead of mounting unbounded lines (freeze class); approval previews budget their synchronous syntax highlighting above 400 lines.
- Footer git status moved off the render path (async refresh) so a slow `git status` can no longer freeze a frame.
- Terminal background detection uses WCAG-linearized luminance, fixing mid-gray backgrounds (`#808080`) flipping to the light theme; `COLORFGBG` garbage values fall back to the safe dark default.
- Theme token mirrors are enforced by tests and regenerated: `docs/en/customization/themes.md`, `custom-theme.md`, and the theme schema now match `colors.ts` (adds `info` / `gradientMid`).
- Remaining hardcoded English toast/hint/error copy moved to the i18n catalog (Korean translations included); Hub toggle toasts show the actual mode label instead of an empty one.
- Plugin manager lists page with ▲/▼ indicators and PgUp/PgDn instead of overflowing the modal on large catalogs.
- Conductor Timeline and the Intent Composer now render a focus ring, so the surface that owns the keys is visible.
- Promo banner tags render on their own (truncated) line on narrow terminals instead of silently disappearing.
- Per-tool output scroll state is pruned when a tool card is evicted, fixing a slow leak in long sessions.
- Diff computation keeps a head+tail window for oversized inputs so top-of-file hunks no longer render as a full rewrite.
- Turning the performance-mode overlay on/off through any state writer now re-syncs transcript density and neat mode, and the tighter 24-turn cap also applies while hydrating a session.
- Stream type-on reveal arming is per-instance, so two TUI instances in one process can no longer stall each other's animation.
- Command Hub mode strip, badges, and paging indicators localize (Korean included) and the slash/skill rows carry localized section keys.
- Bounded the Shiki missing-language registry and dropped retired sub-tool output payloads, closing two slow memory growths in long sessions.
- Approval card descriptions and credential prompts localize (edit/spawn/search/fetch/task/goal summaries, Context7 and web-search signup subtitles).
- Worker Dock dense header columns derive from the row layout math (fixes 2–3 column drift, drops the unused ST column), ghost text gets AA contrast headroom in light themes, and assorted dead footer/header/board state is removed.
- `@`-mention autocomplete caches its filesystem walk for 3s instead of re-walking per keystroke; image transmission and Shiki missing-language registries are capped.
- List-dialog conventions aligned across dialogs: `Esc cancel` wording, two-stage Esc in the error navigator, Space pages forward in viewers, visible-width grid padding in Settings.
