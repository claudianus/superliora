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
- Upstream `#1214` partial: rewrite compaction instructions toward first-person handoff notes with verification caution.
- Upstream `#1214` partial: reject manual compaction requests while a turn is actively mutating context.
- Upstream `#1214` partial: recover from generic provider `413` context-size responses when the estimated request is near the model window.
- Upstream `#1228` selective: split streaming timing into request-build, server first-token, server decode, and client consume components for CLI/TUI diagnostics.
- Upstream `#1132` selective: preserve custom model-alias fields when refreshing managed Kimi Code, Open Platform, and custom-registry model catalogs.
- Upstream `#1191`: render provider HTML status pages as readable terminal error messages.
- Upstream `#1209`: route malformed tool-call JSON through schema validation for clearer retry guidance.
- Upstream `#1129`, `#1156`: use model `maxOutputSize` and a 128k default cap for compaction output budgets.
- Upstream `#1170`, `#1186` selective: route managed Kimi Code Anthropic-protocol model aliases through the Anthropic beta Messages API.
- Upstream `#1203` selective: track when Glob/Grep search tools use a non-system ripgrep fallback.
- Upstream `#1207` selective: share provider model refresh orchestration between the CLI/TUI path and runtime model catalog service.
- Upstream `#1196`: normalize telemetry event fields for compaction, session start, update prompts, login, server start, and ACP question answers.
- Upstream `#1207` selective: expose broad provider model refresh through the model catalog service and publish model-catalog changed events.

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
- Adapted the upstream handoff-style compaction prompt into Super Kimi's existing Context Compaction v2 wrapper, preserving the structured memory contract while making summaries more useful after context loss.
- Kept Super Kimi's planner/memory compaction design, but adopted the upstream active-turn guard so manual compaction cannot race a streaming turn and silently lose context mutations.
- Kept Super Kimi's existing overflow compaction strategy, but routed large plain `413` responses through the same compaction retry path while leaving small plain `413` failures untouched.
- Preserved the existing debug timing surface while passing finer-grained stream timing through provider hooks, loop events, SDK event types, and the TUI formatter. Web/vis UI changes from the same upstream PR remain deferred.
- Kept Super Kimi's existing thinking/default-thinking semantics, but adopted the low-risk catalog refresh merge behavior from the thinking overhaul so user-added alias metadata survives managed Kimi Code, Open Platform, and custom-registry refreshes while stale upstream models are still removed.
- Extracted HTML error-page titles from provider status errors and stripped carriage returns before status rendering so nginx-style failures show an actionable message instead of a blank terminal line.
- Kept the tool-call transcript invariant intact while making malformed JSON arguments fall back to `{}` and produce the same schema-driven invalid-args feedback as other bad tool inputs.
- Preserved Super Kimi's compaction strategy while capping compaction completion budgets with alias `maxOutputSize` first, then a safe 128k default for known large-context models, leaving unknown-context and explicit env opt-out behavior intact.
- Kept the managed Kimi provider surface intact while storing only the needed `protocol: anthropic` alias metadata, preserving Kimi OAuth/base URLs, forwarding Kimi identity headers, and routing those aliases through Anthropic beta transport with session metadata.
- Kept the existing ripgrep-powered search tools and added telemetry only at the fallback boundary so Super Kimi can diagnose slow or missing search binaries without changing tool output.
- Kept the product surface TUI-first and deferred the web/server scheduler pieces from the same upstream PR, while moving the shared managed Kimi, Open Platform, and custom-registry refresh core into the OAuth package for CLI and runtime reuse.
- Preserved Super Kimi's Context Compaction v2 records and TUI replay shape while normalizing only telemetry payload fields to snake_case, dropping custom compaction instructions from telemetry, and aligning client attribution schemas for CLI, daemon, and ACP harness diagnostics.
- Kept the server auto-refresh scheduler deferred, but added the missing runtime model-catalog service API and durable `event.model_catalog.changed` protocol event so daemon/SDK clients can observe refresh results without polling after catalog changes.

## Next Candidate Queue

- `#1214` compaction strategy remainder: potential token-efficiency win, but large behavioral surface.
- `#1132` thinking config/model effort overhaul: potentially useful for future Kimi model metadata, but broad and breaking; continue mining for small safe provider/auth pieces first.
- `#1207` remainder: model-catalog background scheduling needs separate review before any TUI-visible status surface changes.
