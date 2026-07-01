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
- Upstream `#1207` selective: start a server-side provider model catalog refresh scheduler with config and environment controls.
- Upstream `#1132` selective: preserve and expose model-declared thinking effort metadata without changing Super Kimi's thinking-mode semantics.
- Upstream `#1207` selective: surface model catalog readiness in `/status` without adding a separate internal QA command.
- Upstream `#1132` selective: add a TUI `/thinking` command for session-only thinking effort control.
- Upstream `#1228` selective: write per-step model timing fields into structured diagnostic logs.
- Upstream `#1214` selective: stop repeated provider-overflow compaction loops when compacted context still overflows.
- Upstream `#1214` selective: adapt compaction thresholds after provider overflows reveal a smaller effective context window.
- Upstream `#1214` selective: defer prompts and steers that arrive during manual compaction, then replay them after compaction finishes.
- Upstream `#1214` selective: re-surface active background tasks after compaction so long-running work is not duplicated.
- Upstream `#1214` selective: sharpen the compaction handoff prompt so post-compact resumes preserve verified state, exact next actions, and tool-free response constraints.
- Upstream `#1214` selective: centralize the real-user-prompt policy so memory recall ignores model-triggered internal messages while still honoring user slash commands.
- Upstream `#1214` selective: keep compaction token accounting derived from the actual post-compaction context shape, including preserved tail messages.
- Upstream `#1132` selective: resolve generic thinking `on` through each model's declared `default_effort` / `support_efforts` metadata.

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
- Added the server auto-refresh scheduler without taking the web UI store/status pieces: long-running Super Kimi daemons now refresh provider model catalogs on startup and on a configurable interval, while failures stay logged and non-fatal.
- Kept Super Kimi's boolean thinking UX intact while carrying `support_efforts` and `default_effort` through managed Kimi/Open Platform refresh, config aliases, protocol model catalog responses, and TUI model selection data.
- Kept the model-catalog status surface TUI-first by adding a compact `/status` readiness row for visible model aliases, configured providers, and the active provider.
- Preserved the existing model picker/default-thinking behavior while exposing the already-supported runtime effort levels through `/thinking off|on|low|medium|high|xhigh|max`, with model-declared effort validation and clearer `/status` effort labels.
- Preserved the existing live TUI timing events while adding the upstream structured `llm response` log payload for first-token, request-build, server decode, client consume, and output-token diagnostics.
- Kept Super Kimi's Context Compaction v2 shape, planner, and memory blocks while adding the upstream provider-overflow loop guard so failed overflow recovery stops after three compact-retry cycles instead of spinning indefinitely.
- Kept Super Kimi's Context Compaction v2 strategy while lowering the effective compaction window per model after a provider overflow, avoiding repeated late overflow retries when configured context limits are too optimistic.
- Kept Super Kimi's Context Compaction v2 summaries and replay records while making manual compaction mutually cooperate with new input: prompts and steers now wait in the existing turn buffer and run only after post-compaction reinjection completes.
- Preserved Super Kimi's injector stack while adding a post-compaction active task reminder that points the agent to TaskOutput, TaskList, and TaskStop instead of re-spawning long-running work.
- Kept Super Kimi's structured memory wrapper and compaction planner, but aligned the raw handoff instruction with upstream's latest first-person continuity contract and verification caution.
- Kept Super Kimi's structured tail-retention strategy, but adopted upstream's explicit user-origin classification for recall and undo-adjacent behavior so model-triggered skill bodies do not become memory search queries and user plugin slash commands do.
- Preserved Super Kimi's tail-retaining compaction instead of upstream's all-user rebuild, but now computes `summaryTokens`, `retainedTokens`, and `tokensAfter` from the actual assistant summary message plus the current retained tail so status/readiness cannot undercount context after a concurrent tail append.
- Kept Super Kimi's existing `/thinking` and model-picker UX while making generic thinking-on requests honor model-declared effort defaults during session creation, runtime model switches, and always-thinking clamps.

## Next Candidate Queue

- `#1214` compaction strategy remainder: potential token-efficiency win, but large behavioral surface.
- `#1132` thinking config/model effort overhaul: metadata carrier pieces and session-level effort command are integrated; defer any default-thinking semantic rewrite or model-picker effort selector UI until it can be designed around Super Kimi's UltraWork UX.
- `#1207` remainder: optional richer freshness timestamps if the server API grows real last-refresh metadata; do not invent freshness claims from config-only state.
