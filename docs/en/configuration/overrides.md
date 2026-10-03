# Config overrides

SuperLiora CLI has three places where runtime parameters can be influenced: the config file, command-line options, and environment variables. They are not a simple "whoever has higher priority wins" relationship — the three serve different scenarios and have non-overlapping scopes:

- **Config file** stores long-term preferences (model, keys, loop control, etc.); takes effect on every startup
- **Command-line options** make one-off changes for the current startup; discarded after exit
- **Environment variables** primarily handle data directory location, OAuth endpoint switching, and a small number of runtime switches — **not a general fallback mechanism for config fields**

This distinction matters: many users run `export KIMI_API_KEY=xxx` in the shell expecting the CLI to pick it up automatically, but it does not. See [Provider credentials](#provider-credentials) below for why.

## Three roles of environment variables

Environment variables fall into three categories by function and cannot be collapsed into a single linear priority order:

1. **Locating the config file**: `SUPERLIORA_HOME` sets the data root directory, making the config file path `$SUPERLIORA_HOME/config.toml`. This step runs before all other resolution and is not a fallback for individual parameters.
2. **Runtime switches**: A small set of variables like `KIMI_DISABLE_TELEMETRY` directly shut down the corresponding subsystem — even if `config.toml` has `telemetry = true`, setting this variable to a truthy value disables telemetry. The semantics are "additionally disable", not "ordinary override".
3. **Runtime endpoints and diagnostics**: Variables like `SUPERLIORA_OAUTH_HOST`, `SUPERLIORA_BASE_URL`, and `KIMI_LOG_LEVEL` are read when the OAuth or logging subsystems initialize. For the full list, see [Environment variables](./env-vars.md).

## Priority for ordinary runtime parameters

For ordinary runtime parameters such as model alias and permission mode, priority from highest to lowest is:

1. **Command-line options** (`-m`, `--yolo`, `--auto`): apply only to the current startup
2. **User config file** (`~/.superliora/config.toml`): stores long-term preferences

Environment variables are not a general configuration overlay. See [Environment variables](./env-vars.md) for the supported endpoint, provider, shell, and diagnostic knobs.

::: warning
**Ordinary runtime parameters do not fall back to shell environment variables.** Provider `api_key` / `base_url` are read only from `config.toml` (including the `[providers.<name>.env]` sub-table) and do not fall back to `export`-ed shell variables. The only exception is the explicit `KIMI_MODEL_*` channel — see [Define a model from environment variables](./env-vars.md#define-a-model-from-environment-variables-kimi-model).
:::

The runtime uses a user-level `config.toml`; project `.superliora/local.toml` holds workspace-specific additional-directory/path-policy preferences, not a second provider config. To separate runtime config and session data, point `SUPERLIORA_HOME` at a different data directory. This does not isolate the working checkout.

## Provider credentials

Provider credentials (`api_key`, `base_url`) follow their own resolution rules, separate from the ordinary parameter priority chain.

For a single provider, credentials are resolved in this order:

1. `[providers.<name>].api_key` — key written directly in the config file; highest priority
2. The matching key inside the `[providers.<name>.env]` sub-table (`KIMI_API_KEY`, `ANTHROPIC_API_KEY`, etc.) — consulted only when `api_key` is empty
3. If both are absent — startup fails with an error indicating the provider is missing credentials

`base_url` is resolved the same way: first `[providers.<name>].base_url`, then the `*_BASE_URL` key in `[providers.<name>.env]`.

> The `[providers.<name>.env]` sub-table is just a TOML section in the config file — it does not write anything into the shell environment. It is only consulted when the corresponding direct field (`api_key` / `base_url`) is empty.

For the full list of credential key names, see [Environment variables: provider credential key names](./env-vars.md#provider-credential-key-names-written-in-configtoml).

## Command-line options

Options passed at startup have the highest priority and apply only to the current session:

| Option | Effect |
| --- | --- |
| `-S, --session [id]` | Resume a specific session; enters interactive selection when no id is given |
| `-c, --continue` | Resume the last session for the current working directory |
| `-y, --yolo` | Auto-approve most calls, retaining high-risk approval policy |
| `--auto` | Select automatic permission handling |
| `-m, --model <model>` | Use a specific model alias for this session |
| `-p, --prompt <prompt>` | Run in non-interactive mode: execute a single prompt and exit |
| `--output-format <format>` | Output format for `-p` mode: `text` or `stream-json` |

Mutual exclusion rules (startup fails if violated):

- `--output-format` can only be used with `-p`
- `--prompt` cannot be combined with `--yolo` or `--auto`
- `--continue` and `--session` cannot be used together
- `--yolo` and `--auto` cannot be used together
- `--worktree` cannot be combined with `--continue` or `--session`

## Common scenarios

**Isolated test environment** — use a separate data directory to avoid polluting the main config and sessions:

```sh
SUPERLIORA_HOME="$PWD/.superliora-sandbox" liora
```

**One-off test key** — since provider credentials are read only from the config file, write a test key into the `env` sub-table:

```toml
[providers.kimi.env]
KIMI_API_KEY = "sk-test"
```

**Use fewer approval prompts in an interactive session**:

```sh
liora --yolo
```

For non-interactive prompts, set the desired permission policy in `config.toml` instead of combining `--yolo` with `-p`.

## Next steps

- [Configuration files](./config-files.md) — complete reference for all configurable fields
- [Environment variables](./env-vars.md) — full list and description of `SUPERLIORA_HOME` and related variables
