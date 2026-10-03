# Configuration files

SuperLiora CLI writes all long-term preferences — which model to use, which API key to fill in, how many steps an Agent can run per turn — into TOML (a plain-text configuration format with a clear structure) files. Change them once and they take effect on every startup. Agent and runtime settings live in `config.toml`; terminal-UI and client preferences (theme, editor, notifications, auto-update) live in a companion `tui.toml`.

Default location: `~/.superliora/config.toml`, created automatically on first run.

## Config file location

The CLI reads configuration from `~/.superliora/config.toml`. To relocate the data directory, override it with the `SUPERLIORA_HOME` environment variable:

```sh
export SUPERLIORA_HOME=/path/to/kimi-home
```

The config file path then becomes `$SUPERLIORA_HOME/config.toml`. Regardless of where the directory lives, the file name is always `config.toml`.

::: tip
TOML field names always use snake_case, for example `default_model` and `max_context_size`. If a key contains `.`, you must quote it — for example `[models."gpt-4.1"]` — otherwise TOML treats `.` as a nested table separator.
:::

## Complete example

The following example covers the most commonly used configuration fields. You can copy it and adjust as needed:

```toml
default_model = "openai/gpt-4.1"
default_permission_mode = "manual"
telemetry = true

[providers.openai]
type = "openai"
base_url = "https://api.openai.com/v1"
api_key = "{env:OPENAI_API_KEY}"

[models."openai/gpt-4.1"]
provider = "openai"
model = "gpt-4.1"
max_context_size = 1047576

[loop_control]
max_steps_per_turn = 0

[background]
max_running_tasks = 4

[[permission.rules]]
decision = "deny"
pattern = "Bash(rm -rf*)"
```

## Top-level fields

Fields in the config file fall into two categories: **top-level scalars** that directly control default behavior, and **nested tables** (`providers`, `models`, `thinking`, etc.) that each have their own structure, described individually in the sections below.

| Field | Type | Default | Description |
| --- | --- | --- | --- |
| `default_model` | `string` | — | Default model alias; must be defined in `models` |
| `default_thinking` | `boolean` | `false` | Whether new sessions enable Thinking (deep reasoning) mode by default; can be toggled from the model menu inside a session. Even when set to `true`, `[thinking].mode = "off"` will still force Thinking off |
| `default_permission_mode` | `string` | `yolo` | Default permission mode for new sessions; one of `manual` (prompt each time), `auto` (auto-approve tools and structured questions), or `yolo` (auto-approve most tools; still asks for high-risk deletes/secrets) |
| `telemetry` | `boolean` | `true` | Whether anonymous telemetry is enabled; disabled only when explicitly set to `false` |
| `providers` | `table` | `{}` | API provider table → [`providers`](#providers) |
| `models` | `table` | — | Model alias table → [`models`](#models) |
| `thinking` | `table` | — | Default parameters for Thinking mode → [`thinking`](#thinking) |
| `loop_control` | `table` | — | Agent loop control parameters → [`loop_control`](#loop_control) |
| `background` | `table` | — | Background task runtime parameters → [`background`](#background) |
| `permission` | `table` | — | Initial permission rules → [`permission`](#permission) |

The native runtime schema retains `providers`, `models`, `thinking`, `permission`, `loop_control`, `background`, `cache`, and `model_catalog`, plus default model/provider, permission, thinking, sandbox, and telemetry fields. See [Major migration](../release-notes/breaking-changes.md#minimal-autonomous-runtime-major-migration) before reusing an older config.

## `providers`

Each entry in the `providers` table defines an API provider, keyed by a unique name. The CLI reads credentials only from here — it does **not** fall back to shell environment variables automatically. Running `export KIMI_API_KEY` in the terminal does not give any provider its key; you must write it explicitly in the config file (see [Config overrides](./overrides.md#provider-credentials)).

| Field | Type | Required | Description |
| --- | --- | --- | --- |
| `type` | `string` | Yes | Provider type: `kimi`, `anthropic`, `openai`, `openai_responses`, `google-genai`, `vertexai` |
| `api_key` | `string` | No | API key, written in plain text in the config file |
| `base_url` | `string` | No | API base URL |
| `oauth` | `table` | No | OAuth credential reference (`storage` and `key` fields); injected automatically by the login flow — normally no need to write this by hand |
| `env` | `table<string, string>` | No | Fallback source for provider credentials; see below |
| `custom_headers` | `table<string, string>` | No | Custom HTTP headers attached to each request |

**`env` sub-table**: You can write provider-conventional key names (such as `KIMI_API_KEY`) inside `[providers.<name>.env]` as a fallback source for `api_key` / `base_url`. This sub-table is **read only from the config file** and does not modify the shell environment:

```toml
[providers.kimi.env]
KIMI_API_KEY = "sk-xxx"
KIMI_BASE_URL = "https://api.moonshot.ai/v1"
```

Priority: `api_key` field > `env` sub-table key > if both are absent, startup fails with an error.

## `models`

Each entry in the `models` table defines a model alias (the name used in `default_model` or the `-m` flag), keyed by a unique name.

| Field | Type | Required | Description |
| --- | --- | --- | --- |
| `provider` | `string` | Yes | Name of the provider to use; must be defined in `providers` |
| `model` | `string` | Yes | Model identifier sent to the server when calling the API |
| `max_context_size` | `integer` | Yes | Maximum context length in tokens; must be at least 1 |
| `max_output_size` | `integer` | No | Per-request output token cap (maps to `max_tokens`). Currently only the `anthropic` provider honors it; recognized Claude models are automatically clamped to the server-side maximum |
| `capabilities` | `array<string>` | No | Capability tags to add explicitly: `thinking`, `image_in`, `video_in`, `audio_in`, `tool_use`. Unioned with the capabilities auto-detected by the provider — entries can only be added, never removed |
| `display_name` | `string` | No | Name shown in the UI; falls back to `model` when unset |
| `reasoning_key` | `string` | No | `openai` provider only. Override the field name used for reasoning content when the gateway returns it under a non-standard name; by default `reasoning_content`, `reasoning_details`, and `reasoning` are auto-detected |
| `adaptive_thinking` | `boolean` | No | `anthropic` provider only. Force adaptive thinking on or off, overriding the version inference based on the model name. Omit to infer automatically (Claude ≥ 4.6 uses adaptive) |
| `fallback_models` | `array<string>` | No | Ordered model aliases to fail over to when the primary request fails (auth, quota, rate limit, timeout, server errors). Empty by default — no model fallback happens unless you list aliases here |
| `routing` | `table` | No | Route tuning: `strategy`, `cooldown_ms`, `weights`, `session_affinity`, `preferred_credential`, `auto_fallback`. See [Model fallback](#model-fallback) |

When an alias contains `.`, use a quoted key:

```toml
[models."gpt-4.1"]
provider = "openai"
model = "gpt-4.1"
max_context_size = 1047576
```

You can also switch models temporarily without touching the config file — by setting `KIMI_MODEL_*` environment variables, the CLI synthesizes a temporary provider in memory that does not persist after restart. See [Define a model from environment variables](./env-vars.md#define-a-model-from-environment-variables-kimi_model).

### Model fallback

Model fallback is opt-in. Native configured routes may select a configured candidate before output is emitted; this is not an execution-step retry or a restart of a failed worker.

On an existing configured model alias, tune its route:

```toml
[models."openai/gpt-4.1".routing]
auto_fallback = false
cooldown_ms = 30000
```

Set `fallback_models` to an ordered list of other **existing model aliases** in the parent `[models."openai/gpt-4.1"]` table. `auto_fallback = true` opts into other credentialed same-capability provider candidates.

A failed candidate is put on cooldown and skipped for that window; when every candidate is cooling down, the turn reports how long until the route is retryable. The same fields can be managed with `liora provider route set ... --fallback ...`.

## `thinking`

`thinking` sets the global default behavior for Thinking mode. `mode = "off"` forces Thinking off even when the top-level `default_thinking = true`.

| Field | Type | Default | Description |
| --- | --- | --- | --- |
| `mode` | `string` | — | Trigger policy: `auto` (decided by the model), `on` (always on), `off` (force off) |
| `effort` | `string` | `high` | Thinking effort level: `low`, `medium`, `high`, `xhigh`, `max`; the levels actually available depend on the provider |

## `loop_control`

`loop_control` accepts only the turn step limit:

| Field | Type | Default | Description |
| --- | --- | --- | --- |
| `max_steps_per_turn` | `integer` | — | Maximum steps per turn; unset or `0` means unlimited |

`max_retries_per_step`, automatic compaction thresholds, role model overrides, and smart-router budgets are retired and rejected. Compaction is explicit through `/compact` or SessionControl.

## `background`

`background` controls manager-owned processes and child-session tasks launched through Bash and SessionControl.

| Field | Type | Description |
| --- | --- | --- |
| `max_running_tasks` | `integer` | Positive maximum number of background tasks |
| `kill_grace_period_ms` | `integer` | Nonnegative grace period before forced termination |
| `print_wait_ceiling_s` | `integer` | Positive ceiling for waiting in print mode |

`keep_alive_on_exit` and its old environment override are retired. Session shutdown retains native cancellation and cleanup ownership.

## `cache`

`invalidate_epoch` is a nonnegative integer written by Settings → Cache invalidate and included in the session prompt-cache key.

## `model_catalog`

Native provider metadata refresh remains configurable with `refresh_interval_ms` (nonnegative integer) and `refresh_on_start` (boolean). This is provider metadata, not an agent capability/skill catalog.

## `permission`

`permission` sets permission rules that are automatically loaded when a session starts, controlling whether the Agent needs user confirmation before calling a tool. Rules are written as a `[[permission.rules]]` array of tables, matched in order — the first matching rule takes effect.

| Field | Type | Required | Description |
| --- | --- | --- | --- |
| `decision` | `string` | Yes | Action on match: `allow` (permit immediately), `deny` (reject immediately), `ask` (prompt each time) |
| `scope` | `string` | No | Rule scope: `turn-override`, `session-runtime`, `project`, `user`; defaults to `user` |
| `pattern` | `string` | Yes | `ToolName` or `ToolName(arg-pattern)`, such as `SessionControl` or `Bash(rm -rf*)` |
| `reason` | `string` | No | Rule description for debugging and auditing |

The model-visible tool names are Bash and SessionControl. Bash rule arguments match the command; SessionControl uses its tool name.

```toml
[[permission.rules]]
decision = "deny"
pattern = "Bash(rm -rf*)"

[[permission.rules]]
decision = "ask"
pattern = "Bash"
```


## `tui.toml`

Alongside `config.toml`, the CLI keeps terminal-UI and client preferences in a companion `tui.toml` in the same directory (`~/.superliora/tui.toml`, or `$SUPERLIORA_HOME/tui.toml` when overridden). It is created with defaults on first run, and the interactive commands `/config`, `/theme`, and `/editor` write to it for you — so you rarely need to edit it by hand. If the file is malformed, the CLI falls back to defaults and shows a notice instead of failing to start.

| Field | Type | Default | Description |
| --- | --- | --- | --- |
| `locale` | `string` | `auto` | UI language: `auto` (follow `SUPERLIORA_LOCALE` / `LANG`), `en`, or `ko` |
| `theme` | `string` | `auto` | Color theme: `auto` (follow the terminal), `dark`, `light`, or the name of a [custom theme](../customization/themes) |
| `[editor].command` | `string` | `""` | External editor command for composing long input; empty falls back to `$VISUAL` / `$EDITOR` |
| `[notifications].enabled` | `boolean` | `true` | Whether desktop notifications are sent |
| `[notifications].notification_condition` | `string` | `unfocused` | When to notify: `unfocused` (only when the terminal is not focused) or `always` |
| `[upgrade].auto_install` | `boolean` | `true` | Whether new versions are installed automatically |

```toml
# ~/.superliora/tui.toml
theme = "auto" # "auto" | "dark" | "light" | custom theme name
locale = "auto" # "auto" | "en" | "ko" — auto follows SUPERLIORA_LOCALE / LANG

[editor]
command = "" # empty uses $VISUAL / $EDITOR

[notifications]
enabled = true
notification_condition = "unfocused" # "unfocused" | "always"

[upgrade]
auto_install = true
```

Changes apply on the next start, or immediately with `/reload-tui` (which reloads only `tui.toml`); `/reload` reloads both `config.toml` and `tui.toml`.

## Project-local configuration

In addition to the user-level files under `~/.superliora`, SuperLiora reads a project-local configuration file at `<project-root>/.superliora/local.toml`. It holds settings that are specific to one project checkout and typically should not be shared with teammates.

The file is created automatically when you add an extra workspace directory with [`/add-dir`](../reference/slash-commands.md) and choose to remember it for the project. You rarely need to edit it by hand.

### `[workspace]`

The `[workspace]` table groups project-level workspace settings:

| Field | Type | Required | Description |
| --- | --- | --- | --- |
| `additional_dir` | `array<string>` | No | Additional workspace directories, stored as absolute paths. Written automatically when you confirm "remember this directory" in `/add-dir`; read back on startup so the directories are available in every session of this project |
| `sandbox_profile` | `string` | No | Path guard: `off` (default), `workspace`, or `read-only`. This is not an OS isolation guarantee. Use an explicit native worktree/job for a separate checkout. |

```toml
[workspace]
additional_dir = ["/absolute/path/to/shared"]
# Path sandbox (not OS isolation). Default is off when omitted.
# sandbox_profile = "workspace"
```

Because directories are stored as absolute paths, which are specific to your machine, we recommend adding `.superliora/local.toml` to your project's `.gitignore` so it is not committed.

### User `config.toml` path sandbox

Optional top-level `sandbox_profile = "off" | "workspace" | "read-only"` selects the native path policy. It is not an OS sandbox and does not turn normal requests into isolated jobs. The CLI also accepts `--sandbox` and `--sandbox-enforcement`; additional directories are configured with `/add-dir`.

## Next steps

- [Providers and models](./providers.md) — connection examples for each provider type (Kimi, Claude, OpenAI, Gemini)
- [Config overrides](./overrides.md) — priority rules for CLI options, config file, and environment variables
- [Environment variables](./env-vars.md) — complete list of runtime variables like `SUPERLIORA_HOME`
