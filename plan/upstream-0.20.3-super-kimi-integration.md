# Upstream 0.20.3 Super Kimi Integration

Source: `upstream/main` fetched from `MoonshotAI/kimi-code` on 2026-07-01.
Local baseline: Super Kimi `main` after `230d90d3`, derived from upstream `0.20.1` plus Super Kimi changes.

## Scope

Do not wholesale-merge upstream. Super Kimi carries Ultrawork, bundled themes, web-search readiness, and harness-specific TUI behavior that must survive. Prefer selective ports that improve CLI/TUI/harness reliability without reintroducing web UI as a product target.

## Upstream Change Buckets

- Adopt first: TUI input fixes, CLI wedging fixes, provider/wire compliance hardening, token/context efficiency, model/provider refresh reliability.
- Review carefully: compaction overhaul, thinking-effort config overhaul, plugin slash commands, ripgrep-backed Glob, strict provider compliance. These touch shared agent behavior and can conflict with Ultrawork prompts, skill routing, and Super Kimi diagnostics.
- Defer unless needed: web UI, desktop app, vis UI, mobile Safari, workspace sidebar, GUI store, web notifications. Useful ideas may be absorbed later, but web UI itself remains out of scope.

## Integrated In This Pass

- Upstream `#1223`: allow `@file` mentions inside slash command arguments.
- Upstream `#1225`: treat `/` as path completion in shell mode instead of opening slash-command completion.
- Upstream `#1233`: bound completed headless prompt cleanup and arm a force-exit backstop after stdio drains.
- Upstream `#1241`: recover strict-provider request-structure failures caused by malformed tool exchange history.
- Upstream `#1068`: use ripgrep-backed Glob for faster file discovery.
- Upstream `#1220`: open the undo selector when Esc is pressed twice at the idle prompt.
- Upstream `#1204`: expose installed plugin Markdown commands as namespaced slash commands.
- Upstream `#1187`, `#1188`, `#1189`: TUI polish fixes for undo debug timing, input redraws, and swarm progress tips.
- Upstream `#1214` partial: count image/audio/video parts in context token estimates.
- Upstream `#1214` partial: merge consecutive user-role turns for strict Anthropic/Gemini provider wires.

Super Kimi adaptation:
- Preserved dynamic `skill:` slash command lookup.
- Preserved advanced command visibility rules.
- Connected completion behavior to `appState.inputMode`.
- Added regression tests for prompt-mode slash commands and bash-mode path completion.
- Preserved Super Kimi headless `/goal` and `/ultrawork` prompt handling while adding bounded shutdown.
- Ported only the strict-provider projector/one-shot resend hardening from `#1241`, without taking the broader compaction rewrite.
- Added focused regressions for non-adjacent tool results, mid-history missing results, strict resend, and provider error classification.
- Verified `skimi` still points at the freshly built local `apps/kimi-code/dist/main.mjs`.
- Preserved Super Kimi builtin smoke coverage while moving Glob from `kaos.glob` traversal to `rg --files`.
- Kept the product surface TUI-first: updated Glob help/profile wording and TUI tool-call summaries; no web UI work.
- Added double-Esc undo as a TUI ergonomics shortcut and exposed it in `/help` plus keyboard reference docs.
- Added plugin command manifest parsing, SDK activation APIs, TUI autocomplete/dispatch, replay, and undo support.
- Preserved Super Kimi dynamic `skill:` fallback behavior while adding `/plugin-id:command` support.
- Kept debug timing output tied to undoable turns, removed input-time clear-on-shrink full redraws, and kept working tips out of inline swarm progress rows.
- Pulled the independent media-token estimator fix from the compaction rework so media-heavy vibe-coding sessions no longer look free to usage/readiness and compaction budget logic.
- Collapsed consecutive user-role wire turns at strict provider boundaries so post-compaction prompts and steer-after-tool-result histories do not 400 on alternating-role backends.

## Next Candidate Queue

- `#1214` compaction strategy remainder: potential token-efficiency win, but large behavioral surface.
