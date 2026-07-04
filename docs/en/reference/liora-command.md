# `liora` Command

`liora` is the main command for SuperLiora CLI, used to start an interactive session in the terminal. Running it without any arguments opens a new session in the current working directory; combined with different flags, you can resume a previous session, skip approvals, start in Plan mode, or load Skills from a custom directory.

```sh
liora [options]
liora <subcommand> [options]
```

## Main Command Options

All flags are optional — run `liora` directly to enter an interactive session:

| Option | Short | Description |
| --- | --- | --- |
| `--version` | `-V` | Print the version number and exit |
| `--help` | `-h` | Show help information and exit |
| `--session [id]` | `-S` | Resume a session. With an ID, opens that session directly; without an ID, enters an interactive selector |
| `--continue` | `-c` | Continue the most recent session in the current working directory, without specifying an ID manually |
| `--model <model>` | `-m` | Specify a model alias for this launch. When omitted, new sessions use `default_model` from the config file |
| `--prompt <prompt>` | `-p` | Run a single prompt non-interactively and stream the Assistant output to stdout. This mode does not open the TUI |
| `--output-format <format>` | | Set the non-interactive output format; supports `text` and `stream-json`. Can only be used with `--prompt`; defaults to `text` |
| `--yolo` | `-y` | Auto-approve regular tool calls, skipping approval requests |
| `--auto` | | Start with auto permission mode; tool approvals are handled automatically and the Agent will not ask the user questions |
| `--plan` | | Start a new session in Plan mode — the AI will prioritize read-only tools for exploration and planning |
| `--skills-dir <dir>` | | Load Skills from the specified directory, replacing the automatically discovered user and project directories. Can be repeated |
| `--add-dir <dir>` | | Add an extra workspace directory for this session. Relative paths resolve against the current working directory. Can be repeated |

`-r` / `--resume` is a hidden alias for `--session`; `--yes` and `--auto-approve` are hidden aliases for `--yolo` and are not shown in help output.

::: warning
`--yolo` skips human approval for regular tool calls, including file writes and shell command execution. Use it only in trusted working directories. Plan mode exit approval is not bypassed by `--yolo`; `Bash` inside Plan mode is handled under the regular allow rules.
:::

### Flag Conflict Rules

The following combinations are rejected at startup:

- `--continue` and `--session` are mutually exclusive — both mean "resume a previous session"
- `--yolo` and `--auto` are mutually exclusive — the two permission modes cannot be combined
- `--prompt` cannot be used with `--yolo`, `--auto`, or `--plan` — non-interactive mode uses `auto` permission by default
- `--output-format` can only be used together with `--prompt`

When resuming a session, you can override its saved permission or plan mode by adding `--auto`, `--yolo`, or `--plan`. For example, `liora --continue --auto` resumes the latest session and switches it to auto permission mode.

## Common Usage

Start a new session directly:

```sh
liora
```

Pick up where you left off (automatically finds the most recent session in the current directory):

```sh
liora --continue
```

Choose from the session history list, or specify a known ID directly:

```sh
liora --session
liora --session 01HZ...XYZ
```

Skip approval prompts — suitable for batch tasks that are known to be safe:

```sh
liora --yolo
```

Let the Agent handle everything autonomously, without asking the user questions:

```sh
liora --auto
```

Read the code and produce an implementation plan before making any file changes:

```sh
liora --plan
```

### Custom Skills Directories

There are two ways to specify Skills directories, with different semantics:

- **`--skills-dir <dir>`** (CLI flag): **Replaces** the automatically discovered user and project directories for this launch only. Can be repeated to stack multiple directories:

  ```sh
  liora --skills-dir /path/to/team-skills --skills-dir ./local-skills
  ```

- **`extra_skill_dirs`** (`config.toml`): **Adds** directories on top of the automatically discovered ones, taking effect permanently. Suitable for configuring team-shared Skills. See [Agent Skills](../customization/skills.md).

## Non-Interactive Execution

When running a single prompt in a script or CI environment, use `-p`:

```sh
liora -p "Summarize the current repository status"
```

Output uses a transcript style: thinking content and Assistant text are both prefixed with `• `, and wrapped lines are indented by two spaces. Assistant text goes to stdout; thinking, tool progress, and "resuming session" notices go to stderr. In `-p` mode, no human approval is requested — regular tool calls are handled under the `auto` permission policy, while static deny rules remain in effect.

Temporarily switch the model:

```sh
liora -m kimi-code/kimi-for-coding -p "Explain the latest diff"
```

When you need to parse output programmatically, use the `stream-json` format — each line on stdout is a JSON object:

```sh
liora -p "List changed files" --output-format stream-json
```

In `stream-json` mode, regular replies produce an Assistant message; when the model calls a tool, an Assistant message with `tool_calls` is emitted first, followed by the corresponding Tool message, then subsequent Assistant messages. Thinking content is not written to JSONL; tool progress and "resuming session" notices are still written to stderr.

## Subcommands

`liora` provides the following subcommands: `login` (non-interactive login), `acp` (ACP IDE mode), `server` (run and manage the local REST/WebSocket/web service), `web` (alias for `liora server run --open`), `doctor` (validate configuration files), `export` (export a session), `migrate` (migrate legacy data), `upgrade` (check for updates), and `provider` (manage providers).

### `liora login`

Log in to SuperLiora OAuth via the RFC 8628 device-code flow, without entering the TUI. The command issues a device authorization request, prints the verification URL and user code to stderr, then polls until the browser-side authorization is complete. The generated token is written to the same local location as TUI `/login` and is loaded automatically the next time `liora` starts.

```sh
liora login
```

This subcommand has no flags. Press `Ctrl-C` at any time during polling to cancel; the exit code is `1` on cancellation or failure, and `0` on success.

### `liora acp`

Switch SuperLiora CLI to ACP (Agent Client Protocol) mode, communicating with an IDE via JSON-RPC over stdin/stdout so the editor can directly drive liora's sessions and tool calls. You typically do not need to run this manually — the IDE starts it as a subprocess entry point. For configuration, see [Using in IDEs](../guides/ides.md); for technical details, see the [liora acp reference](./liora-acp.md).

```sh
liora acp
```

### `liora server`

Run, install, and manage the local Kimi server — a single process that exposes the REST + WebSocket API and serves the web UI from the same origin. The parent command is split into an on-demand entrypoint (`run`) and an OS-managed service lifecycle (`install`, `uninstall`, `start`, `stop`, `restart`, `status`). `liora server run` ensures a single background daemon is running and returns once it is healthy; pass `--foreground` to keep the server attached to the current terminal instead.

When the server is running, `GET /openapi.json` returns the REST OpenAPI document and `GET /asyncapi.json` returns the local WebSocket AsyncAPI document.

```sh
liora server run                # start or reuse a background daemon
liora server run --foreground   # run attached to the current terminal
liora server install            # register with launchd / systemd / schtasks
liora server start              # start the OS-managed service
liora server status             # snapshot of installed/running state
```

#### `liora server run`

| Option | Description |
| --- | --- |
| `--port <port>` | Bind port; defaults to `58627` |
| `--log-level <level>` | Enable server logs at the selected level; omitted by default |
| `--debug-endpoints` | Mount `/api/v1/debug/*` routes (off by default) |
| `--foreground` | Run in the foreground instead of spawning a background daemon |
| `--open` | Open the web UI in the default browser once the server is healthy |

`liora server run` binds to local loopback only. By default it spawns a single background daemon (reused across runs) and exits once the daemon is healthy; the daemon shuts itself down after the last web client disconnects. Pass `--foreground` to run the server in the current process instead — it then stays attached to the terminal and shuts down cleanly on `SIGINT` / `SIGTERM`.

#### `liora server install`

Register the server as an OS-managed service so it starts at login and restarts after a crash. The backend picks itself based on the running platform:

- **macOS**: writes a LaunchAgent plist to `~/Library/LaunchAgents/com.superliora.liora-server.plist` and bootstraps it via `launchctl bootstrap gui/<uid>`.
- **Linux**: writes a `--user` systemd unit to `~/.config/systemd/user/liora-server.service` and runs `systemctl --user enable --now`.
- **Windows**: registers a scheduled task named `LioraServer` via `schtasks /Create /XML`.

| Option | Description |
| --- | --- |
| `--port <port>` | Bind port the supervised server uses; defaults to `58627` |
| `--log-level <level>` | Log level recorded in the generated unit |
| `--force` | Replace an existing install instead of failing |
| `--json` | Output JSON instead of a human-readable line |

The loopback host, chosen port, and log level are recorded to `~/.superliora/server/install.json` so `liora server status` can report them even when the service is stopped.

#### Lifecycle subcommands

| Command | Description |
| --- | --- |
| `liora server uninstall` | Stop and remove the OS service definition. Idempotent. |
| `liora server start` | Start the OS-managed service. Errors if not installed. |
| `liora server stop` | Stop the OS-managed service. |
| `liora server restart` | Restart the OS-managed service. |
| `liora server status` | Print installed / running / pid / port / log-path. `--json` for automation. |

#### `liora web`

Opens SuperLiora's graphical session in the browser as an alternative to the terminal TUI.

Equivalent to `liora server run --open`: it starts a local SuperLiora server in the background (reusing one already running), opens the web UI in the default browser, and returns, leaving the server resident in the background. The only difference from `liora server run` is that `--open` is enabled by default (auto-launches the browser); all other behavior is identical.

```sh
liora web                 # start the server in the background and open the browser (reuses a running one)
liora web --no-open       # don't open the browser; same as `liora server run`
liora web --foreground    # run attached to the current terminal and open the browser
```

Stop the server with `liora server kill` and list active connections with `liora server ps`; `--port`, `--log-level`, and the other flags match `liora server run`.

### `liora doctor`

Validate `config.toml` and `tui.toml` without starting the TUI or modifying either file. By default, the command checks the files under `SUPERLIORA_HOME` (or `~/.superliora` when the environment variable is unset). Missing default files are reported as skipped because built-in defaults can apply.

```sh
liora doctor
```

| Command | Description |
| --- | --- |
| `liora doctor` | Validate the default `config.toml` and `tui.toml` |
| `liora doctor config [path]` | Validate only `config.toml`, using `path` instead of the default file when provided |
| `liora doctor tui [path]` | Validate only `tui.toml`, using `path` instead of the default file when provided |

When an explicit path is passed, the file must exist. The command exits with `0` when all checked files are valid or skipped, and `1` when any requested file is missing or invalid.

```sh
# Check the default config files
liora doctor

# Check only the default runtime config
liora doctor config

# Check a candidate TUI config before replacing the live config
liora doctor tui ./tui.toml
```

### `liora export`

Package a session into a ZIP file for sharing, archiving, or submitting bug reports.

```sh
liora export [sessionId] [options]
```

| Parameter / Option | Short | Description |
| --- | --- | --- |
| `sessionId` | | The ID of the session to export. When omitted, the most recent session in the current working directory is automatically selected and requires confirmation |
| `--output <path>` | `-o` | Output ZIP file path. When omitted, writes to a default filename in the current directory |
| `--yes` | `-y` | Skip the confirmation prompt for the default session and export directly |
| `--no-include-global-log` | | Do not include the global diagnostic log. Included by default |

The export contains all files in the target session directory. The global diagnostic log (`~/.superliora/logs/liora.log`) is included by default because it may contain events from other sessions or projects; add `--no-include-global-log` if you do not want to share it.

```sh
# Export the most recent session in the current directory, skipping confirmation
liora export -y

# Export a specific session to a custom path
liora export 01HZ...XYZ -o ./bug-report.zip

# Exclude the global diagnostic log
liora export 01HZ...XYZ -o ./bug-report.zip --no-include-global-log
```

### `liora upgrade`

Immediately check for the latest version and display an update prompt; exits after you make a selection. `liora update` is an alias for this command.

```sh
liora upgrade
```

For global npm, pnpm, yarn, bun, and macOS / Linux native installations, `liora upgrade` shows update options; selecting `Install update now` runs the corresponding foreground install command. When the current installation method cannot be upgraded automatically (e.g., Windows native installation), the manual update command is printed instead.

### `liora vis`

Launch the session visualizer in your browser to inspect a session as it unfolds. The command starts an in-process server pointed at your local sessions, prints the URL, opens your browser, and keeps running until you press `Ctrl-C`.

```sh
liora vis [sessionId] [options]
```

| Parameter / Option | Description |
| --- | --- |
| `sessionId` | Open the visualizer directly to this session. When omitted, it opens the home view listing your sessions |
| `--port <number>` | Port to bind. By default an available port is picked automatically |
| `--host <host>` | Host to bind. Default: `127.0.0.1` |
| `--no-open` | Do not open the browser automatically; just print the URL |

```sh
# Start the visualizer and open the browser at the home view
liora vis

# Open directly to a specific session
liora vis 01HZ...XYZ

# Bind a fixed port and host without opening a browser (e.g. on a remote host)
liora vis --host 0.0.0.0 --port 8123 --no-open
```

### `liora provider`

Manage providers in the shell — the non-interactive equivalent of `/provider` in the TUI. Suitable for scripted deployments, CI initialization, account-pool setup, and route diagnostics on a new machine.

```sh
liora provider <action> [options]
```

The command is organized into setup, credential, and route groups.

#### `liora provider add <url>`

Bulk-import all providers from a custom registry (`api.json`). The command fetches the registry, creates a `[providers.<id>]` and `[models.<alias>]` entry for each item, and writes `source` metadata so the TUI refreshes providers and models from the same registry URL automatically on next startup.

| Parameter / Option | Description |
| --- | --- |
| `<url>` | Registry URL |
| `--api-key <key>` | Bearer token for accessing the registry. Falls back to the `SUPERLIORA_REGISTRY_API_KEY` environment variable if not provided; required |

```sh
liora provider add https://registry.example.com/v1/models/api.json --api-key YOUR_KEY

# Or via environment variable (suitable for CI / .envrc)
SUPERLIORA_REGISTRY_API_KEY=YOUR_KEY liora provider add https://registry.example.com/v1/models/api.json
```

If a provider ID already exists, it is removed and re-created. The default model is not set automatically; you can select one later with `-m` or `/model` in the TUI.

#### `liora provider remove <providerId>`

Remove the specified provider and all its model aliases. If the removed provider is the one referenced by `default_model`, `default_model` is also cleared.

```sh
liora provider remove kohub
```

#### `liora provider list`

Print each configured provider on a separate line, including type, model count, and source. Add `--json` to output the raw `providers` and `models` tables for programmatic processing.

```sh
liora provider list
liora provider list --json | jq '.providers | keys'
```

#### `liora provider doctor`

Validate provider auth, environment references, credential pools, and routes without printing secrets. The command exits non-zero when it finds errors, so it works well in CI or dotfile bootstrap scripts.

```sh
liora provider doctor
liora provider doctor --json
```

#### `liora provider custom add <providerId>`

Add one direct endpoint without a registry. This is the shortest path for local models, private OpenAI-compatible gateways, and single-model enterprise endpoints.

| Parameter / Option | Description |
| --- | --- |
| `<providerId>` | Provider ID to create |
| `--base-url <url>` | Endpoint base URL |
| `--model <modelId>` | Upstream model ID |
| `--api-key <key>` | Raw provider API key |
| `--api-key-env <name>` | Store `{env:NAME}` instead of a raw key |
| `--keyless` | Use a placeholder key for local endpoints that do not require auth |
| `--alias <alias>` | Model alias to create |
| `--type <type>` | Provider wire type; defaults to `openai` |
| `--context <tokens>` | Context window |
| `--output <tokens>` | Max output tokens |
| `--display-name <name>` | Friendly model name |
| `--thinking` | Mark the model as thinking-capable |
| `--set-default` | Make the created alias the default model |

```sh
liora provider custom add local --base-url http://localhost:11434/v1 --model qwen --keyless --set-default
```

#### `liora provider catalog list [providerId]`

Browse the public [models.dev](https://models.dev/) model catalog without modifying any configuration. Without an argument, lists all providers along with their protocol type and model count; with a `providerId`, lists all models under that provider along with their context window and capabilities.

| Parameter / Option | Description |
| --- | --- |
| `[providerId]` | Optional — the provider ID to inspect |
| `--filter <substring>` | Case-insensitive substring filter on ID or name |
| `--url <url>` | Override the catalog URL; defaults to `https://models.dev/api.json` |
| `--json` | Output matching entries as JSON |

```sh
liora provider catalog list
liora provider catalog list --filter anthropic
liora provider catalog list anthropic
```

#### `liora provider catalog add <providerId>`

Import a known provider directly from the catalog by ID. The protocol type, base URL, and model information are all supplied by the catalog — only an API key is required.

| Parameter / Option | Description |
| --- | --- |
| `<providerId>` | Provider ID in the catalog, e.g., `anthropic`, `openai` |
| `--api-key <key>` | Provider API key. Falls back to `SUPERLIORA_REGISTRY_API_KEY` if not provided; required |
| `--api-key-env <name>` | Store `{env:NAME}` instead of a raw provider API key |
| `--default-model <modelId>` | Optional — set `default_model` to `<providerId>/<modelId>` after import |
| `--url <url>` | Override the catalog URL; defaults to `https://models.dev/api.json` |

```sh
liora provider catalog list anthropic          # Browse available models first
liora provider catalog add anthropic --api-key-env ANTHROPIC_API_KEY --default-model claude-opus-4-7
```

#### `liora provider key`

Manage API-key pools for an existing provider. Secret values are never printed by list, promote, label, or route commands.

```sh
liora provider key add openai --api-key-env OPENAI_PRIMARY_KEY --label primary
liora provider key add openai --api-key-envs OPENAI_A,OPENAI_B --labels work,backup --rpm 60 --tpm 120000 --auto-route
liora provider key list openai
liora provider key limit openai 2 --rpm 30
liora provider key promote openai 2
liora provider key label openai 2 backup
liora provider key remove openai 2
```

Common options for `key add`:

| Option | Description |
| --- | --- |
| `--api-key <key>` / `--api-keys <keys>` | Raw key or comma-separated raw keys |
| `--api-key-env <name>` / `--api-key-envs <names>` | Store one or more `{env:NAME}` references |
| `--base-url <url>` | Per-credential endpoint override |
| `--label <label>` / `--labels <labels>` | Friendly credential labels |
| `--rpm <count>` | Local requests-per-minute limit |
| `--tpm <tokens>` | Local tokens-per-minute limit |
| `--auto-route` | Enable auto routing for model aliases that use this provider |

#### `liora provider oauth`

Manage OAuth account refs for providers that use managed OAuth credentials. Use `liora login --oauth-key <storageKey>` first when you need a distinct account slot.

```sh
liora login --oauth-key kimi-work
liora provider oauth add kimi --key kimi-work --label work --auto-route
liora provider oauth list kimi
liora provider oauth promote kimi 2
liora provider oauth label kimi 2 backup
liora provider oauth remove kimi 2
```

#### `liora provider route`

Configure and inspect model fallback and load-balancing routes. A route expands one model alias into candidate provider/key/account/endpoint slots and optional fallback model aliases.

```sh
liora provider route auto openai/gpt-4.1
liora provider route set openai/gpt-4.1 --fallback anthropic/claude-opus --strategy rate_limit_aware --session-affinity on
liora provider route set openai/gpt-4.1 --strategy weighted_round_robin --weights openai/gpt-4.1=3,anthropic/claude-opus=1
liora provider route preview openai/gpt-4.1
liora provider route status <sessionId>
liora provider route reset <sessionId>
```

Supported strategies are `auto`, `fallback`, `fill_first`, `round_robin`, `weighted_round_robin`, `least_used`, `lowest_latency`, `rate_limit_aware`, and `random`. Use `route preview` before running a long session, and `route status` after a session starts to inspect live cooldowns, rate-limit buckets, latency, pinned candidates, and preferred credential labels.
```

## Next steps

- [Slash Commands](./slash-commands.md) — Quick reference for control commands in the interactive TUI
- [Configuration Files](../configuration/config-files.md) — Persistent configuration for `default_model`, permission mode, and other startup parameters
- [Agent Skills](../customization/skills.md) — Skill file format for directories loaded via `--skills-dir`
