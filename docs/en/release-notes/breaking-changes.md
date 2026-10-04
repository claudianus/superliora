# Breaking changes

## Unreleased

### Minimal autonomous runtime: major migration

The model-visible API is exactly **Bash** and **SessionControl**. This is a major cutover, not a compatibility mode.

**Removed**

- Plan/Goal/Ask modes and their commands; durable Memory; skills and skill commands; plugins, MCP, hooks, persona, capability catalogs, and task-role routing/probing.
- Specialized file/search/web/media, plan/todo/goal, Memory, Agent/Task, and job model tools. Use Bash for executable work and SessionControl for child/process control.
- Automatic execution-step/whole-turn/worker retries, strict resends, effect replay, automatic context compaction, and forced verification/review. Native configured provider routes may still handle configured candidates before output; this does not restart a failed worker or replay effects.
- File rewind and `/blame` AI-attribution markers. Both depended on the removed file tools, so Bash edits never fed them. `/rewind` prints git rollback guidance instead of restoring files, and `/blame` shows plain `git blame`.

**Configuration migration**

Back up your config, then **manually remove retired keys/sections** from `$SUPERLIORA_HOME/config.toml` (default `~/.superliora/config.toml`). The application does not silently migrate or edit your home config. In particular, `[research]` is rejected, not an ignored legacy section.

The exact rejection list is `RETIRED_FIELDS` in `packages/agent-core/src/config/toml-transform.ts`; names are converted from snake_case before validation. Retired sections include `[skills]`, `[memory]`, `[research]`, `[persona]`, `[agent]`, `[mcp]`, `[plugin]`, `[plugins]`, `[context_os]`, `[experimental]`, `[goals]`, `[goal]`, `[quality]`, `[refine]`, `[dream]`, `[[hooks]]`, `[services]`, `[media]`, `[browser_use]`, `[computer_use]`, and `[extras]`.

Remove `plan_mode`, `default_plan_mode`, `free_mode`, `merge_all_available_skills`, `extra_skill_dirs`, `skill_search_limit`, `skill_search_max_limit`, and `skill_prompt_mode`. Within `[loop_control]`, retain only `max_steps_per_turn`: remove `max_retries_per_step`, `max_ralph_iterations`, `reserved_context_size`, `compaction_trigger_ratio`, `compaction_async_trigger_ratio`, `compaction_block_ratio`, `compaction_trigger_tokens`, `max_working_set_tokens`, `async_working_set_tokens`, `compaction_max_recent_messages`, `compaction_model`, `completion_model`, `exploration_model`, `coding_model`, `planning_model`, `debugging_model`, `worker_inherit_parent`, `worker_inherit_parent_roles`, `conductor_model_pool`, `conductor_pool_mode`, and `smart_router_budget_usd`. Other rejected orchestration keys are `max_steps_per_run`, `auto_continue`, `keep_alive_on_exit`, `conductor_pool`, `worker_pool`, and `worker_model`.

`LioraConfigSchema` and its nested strict schemas in `packages/agent-core/src/config/schema.ts` are the SDK/runtime contract. Native providers/models/auth, thinking, approval rules, background limits, cache, provider metadata refresh, telemetry, and sandbox settings remain. See [Configuration files](../configuration/config-files.md) for executable examples.

**Native flags and provider selection**

- Six provider-picker environment controls survive as native authentication switches: `SUPERLIORA_EXPERIMENTAL_ANTHROPIC_OAUTH`, `SUPERLIORA_EXPERIMENTAL_CURSOR_OAUTH`, `SUPERLIORA_EXPERIMENTAL_GITHUB_COPILOT`, `SUPERLIORA_EXPERIMENTAL_GLM_ZCODE_OAUTH`, `SUPERLIORA_EXPERIMENTAL_GOOGLE_GEMINI_CLI_OAUTH`, and `SUPERLIORA_EXPERIMENTAL_KIRO_OAUTH`. Copilot remains off unless explicitly enabled; the other five remain on unless explicitly disabled. Exact value rules and the Anthropic usage-probe effect are listed in [Environment variables](../configuration/env-vars.md#native-provider-login-controls).
- `[experimental]` and the general flag catalog are removed. `SUPERLIORA_EXPERIMENTAL_FLAG` no longer acts as an authentication master switch; only its native update-rollout bypass remains. Remove config overrides manually and use the native provider environment switches where needed. `SUPERLIORA_EXPERIMENTAL_GITLAB_DUO_OAUTH` is not a native picker control; GitLab Duo remains available.
- `SUPERLIORA_EXPERIMENTAL_CONDUCTOR_UX_V2` no longer gates native Jobs UI or the nested-Git-root startup banner. Setting it to `false` does not hide that banner.
- **Auto** means native configured provider-default selection, not retired Smart Auto task-role routing. The first concrete default selection is not a failover; an explicit configured alias named `auto` keeps ordinary alias semantics.
- Startup does not automatically prune stale OpenCode free-model aliases or rewrite the selected default. Review provider/model entries yourself and manually remove obsolete aliases or choose a supported configured model.

**Command and API migration**

- Remove retired CLI flags such as `--plan`, `--skills-dir`, and plugin/MCP/channel setup flags from launch scripts. Use an ordinary prompt for a task or an explanation; there is no replacement Goal mode.
- Migrate SDK callers to the native schema and Bash/SessionControl contract instead of deleted memory/skill/plugin/MCP/plan/goal APIs. SessionControl operations are exactly `spawn`, `list`, `message`, `wait`, `stop`, and `compact`; no `get`/`cancel` aliases exist. See [Tools](../reference/tools.md).
- Request checks and review explicitly. A returned result is not a guarantee of passed tests, automatic review, or checkout isolation.
- Normal requests run directly in the workspace. Use explicit native Jobs/worktrees for a separate checkout. Jobs/Kanban, workers, cancellation, manual review/land/push, provider/account controls, themes, and host setup remain native operator features.
- `/compact` and SessionControl `compact` explicitly replace the superseded completed prefix while retaining the latest real user request. Sessions, journals, replay, and durable aside forks remain; replay restores records without executing effects again.
- Native cleanup ownership remains held after failure until physical settlement. Explicit settlement releases resources; it does not retry or execute effects again.

Older files for removed skills/goals are not current guidance. Keep any old user-owned data for archival purposes; the runtime no longer loads those features.

## 0.3.0 (2026-08-09)

### Mission, Swarm, and legacy CLI paths

**Affected**

- Mission mode and Swarm mode surfaces (`/mission`, `/swarm`, `/fleet`, and related settings) are removed.
- Diagnostic slash commands (`/bench`, `/renderer`, `/term`, `/export-debug-zip`, `/improve-harness`, `/preflight`) and `/feedback` are removed.
- Remaining Kimi-era CLI migration and cache compatibility paths are dropped.

**Migration**

- Use `/plan`, `/goal`, the agent dock, and the job strip instead of Mission or Swarm.
- Use the `liora` command and `.superliora` paths only.
