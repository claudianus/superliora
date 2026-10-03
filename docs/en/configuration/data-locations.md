# Data locations

SuperLiora CLI stores all runtime data — the config file, session history, login credentials, and diagnostic logs — under `~/.superliora/`. This page helps you understand where each type of data lives, what it is for, and how to clean up or relocate it when needed.

## Data root directory

The default data root is `~/.superliora/`. The actual path varies by platform:

- macOS: `/Users/<name>/.superliora`
- Linux: `/home/<name>/.superliora`
- Windows: `C:\Users\<name>\.superliora`

If you need to move the data directory elsewhere (for example, to isolate configs for different projects with independent environments), set `SUPERLIORA_HOME`:

```sh
export SUPERLIORA_HOME="$HOME/.config/kimi-code"
```

`SUPERLIORA_HOME` relocates runtime configuration, sessions, logs, and provider OAuth credentials. It does not isolate the working checkout. Skills, plugins, MCP declarations, and durable Memory are no longer current runtime resources.

## Directory layout

```
$SUPERLIORA_HOME  (default: ~/.superliora)
├── config.toml             # User configuration
├── tui.toml                # Terminal UI preferences (including auto-update toggle)
├── credentials/            # OAuth credentials (dir 0700, files 0600)
│   ├── <name>.json
├── sessions/               # Session data (see below)
│   ├── index.jsonl         # Session index
│   └── <workDirKey>/<sessionId>/
├── bin/
│   ├── rg                  # managed search helper (rg.exe on Windows)
│   └── fd                  # managed fd binary for file references (fd.exe on Windows)
├── logs/
│   └── liora.log       # Global diagnostic log
├── updates/
│   ├── latest.json
│   ├── install.json
│   ├── install.lock
│   └── rollout.log
└── user-history/
    └── <md5(workDir)>.jsonl
```

## File descriptions

Each top-level file under the data root serves a specific purpose; most are managed automatically by the CLI:

- **`config.toml`**: the main runtime configuration file, storing user-level settings such as providers, models, and loop control. See [Configuration files](./config-files.md).
- **`tui.toml`**: terminal UI client preferences, including `[upgrade].auto_install` (auto-update, on by default). You can disable it in `/settings` or by manually setting `auto_install = false`.
- **`credentials/`**: native provider OAuth credential directory, with permissions `0o700` (directory) / `0o600` (files). Credentials are written atomically.

## Session data

Each session's data is stored under `sessions/<workDirKey>/<sessionId>/`, and `sessions/index.jsonl` lists those sessions (one last-wins record per id: `sessionId`, `sessionDir`, `workDir`). A leftover home-root `session_index.jsonl` is still read until the index is compacted. `workDirKey` is a bucket name derived from the working directory path, in the format `wd_<slug>_<first-12-chars-of-sha256>`.

Inside each session directory:

- **`state.json`**: session metadata including `version`, title, `lastPrompt` (capped), creation/update timestamps, and `forkedFrom`. Agent `homedir` values are stored relative to the session directory (`agents/main`). Writes use a temp file plus `state.json.bak`.
- **`ui/draft.json`**: crash/resume draft, prompt queue, and Ctrl-X stash for the editor.
- **`ui/prefs.json`**: session-scoped TUI preferences such as transcript detail.
- **`agents/main/wire.jsonl`**: the main Agent's complete communication record, used for session resumption and replay.
- **`agents/agent-0/` etc.**: sub-Agent instance directories, each containing their own `wire.jsonl`.
- **`logs/liora.log`**: diagnostic log for this session; only present when a diagnostic event occurs.
- **`tasks/`**: background task persistence — `tasks/<task_id>.json` stores status/pid/exit code; `tasks/<task_id>/output.log` stores output.

## Managed UI search helpers

The TUI can cache search and file-reference helpers under `bin/`. These are executable helpers, not model-visible Grep/Glob tools. The agent performs filesystem work through Bash.

## Logs and update state

- **`logs/liora.log`** (global): records startup, login, export, and other cross-session events.
- **`<sessionDir>/logs/liora.log`** (session-level): records diagnostic events within a single session.

When reporting a bug, prefer exporting the relevant session with `liora export` (see [liora command](../reference/liora-command.md)); the session log is included in the export by default. Add `--no-include-global-log` if you do not want to share the global log.

The files under `updates/` (`latest.json`, `install.json`, `install.lock`, `rollout.log`) are maintained automatically by the auto-update mechanism and normally do not need manual editing. `rollout.log` records which staged-rollout case each update check hit, which helps explain when a device will receive a new release.

## Input history

Terminal input history is saved separately per working directory, at `user-history/<md5(workDir)>.jsonl`. It is used to browse previously typed prompts in the terminal UI using the arrow keys.

## Clearing data

Deleting the data root directory (`~/.superliora/` or the path set by `SUPERLIORA_HOME`) removes all runtime data. To clear only part of the data:

| Goal | Action |
| --- | --- |
| Reset configuration | Delete `~/.superliora/config.toml` |
| Reset terminal UI preferences | Delete `~/.superliora/tui.toml` |
| Clear all sessions | Delete `~/.superliora/sessions/` (and leftover `session_index.jsonl` if present) |
| Clear diagnostic logs | Delete `~/.superliora/logs/` |
| Clear input history | Delete `~/.superliora/user-history/` |
| Reset update state | Delete `~/.superliora/updates/latest.json` |
| Force re-download of managed `rg` and `fd` | Delete `~/.superliora/bin/` |
| Clear provider OAuth login state | Run `/logout`, or delete the corresponding `credentials/<name>.json` |

## Next steps

- [Configuration files](./config-files.md) — full reference for `config.toml` fields
- [Environment variables](./env-vars.md) — detailed usage of `SUPERLIORA_HOME` and related path variables
