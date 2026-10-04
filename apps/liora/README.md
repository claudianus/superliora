# SuperLiora CLI

The `liora` terminal app: an interactive TUI and headless CLI for the SuperLiora coding agent.

[![License](https://img.shields.io/badge/license-MIT-blue)](../../LICENSE) [![Site](https://img.shields.io/badge/site-online-blue)](https://claudianus.github.io/superliora/en/)

## What this package contains

This package builds the `liora` command. The model gets two tools: **Bash** to inspect and change your project, and **SessionControl** to spawn, message, wait for, stop, or compact worker sessions. Requests run directly in the current workspace. Use `--worktree`, or a native Job (`/jobs`, `Alt+J`), when you want the edits isolated.

Since 1.0.0, plans, goals, memory, skills, plugins, and MCP are retired. See "Major migration" in the [root README](../../README.md) for what changed and how to clean up old configuration.

## Install

**macOS / Linux**

```sh
curl -fsSL https://raw.githubusercontent.com/claudianus/superliora/main/install.sh | bash
```

**Windows PowerShell**

```powershell
irm https://raw.githubusercontent.com/claudianus/superliora/main/install.ps1 | iex
```

The installer downloads the prebuilt binary for your platform from the latest GitHub Release, checks its SHA-256 against the release `manifest.json`, and puts `liora` in `~/.local/bin` (Windows: `%LOCALAPPDATA%\SuperLiora\bin`). It needs Node.js 24.15.0 to run and downloads one into the SuperLiora home if your machine doesn't have it.

To build from source instead, pass `--main` (tip of `origin/main`) or `--prefer-source` (the `--ref` branch or tag), e.g. `curl -fsSL …/install.sh | bash -s -- --main`. `--help` lists every option. On Windows, `irm | iex` ignores flags, so download `install.ps1` and run it directly.

Check the install with `liora --version`. Update later with `liora upgrade`.

## Usage

```sh
liora                    # interactive session in the current folder
liora --continue         # resume the last session for this folder
liora --worktree [name]  # run the session in a new git worktree
liora -p "fix the failing login test"   # one request, no TUI
```

Inside the app, use `/login` and `/model` to connect a provider and pick a model.

## Commands

Registered in [`src/cli/commands.ts`](./src/cli/commands.ts); `liora <command> --help` lists the options.

| Command | Purpose |
| --- | --- |
| `upgrade` / `update` | Install the latest release (`--main` builds `origin/main`) |
| `login` | Device-code login |
| `provider` | Manage providers, custom endpoints, API keys, and the default model |
| `doctor` | Validate `config.toml` / `tui.toml`; `--storage` reports disk use |
| `gc` | Reclaim idle cache and worktree temp files, compress closed sessions |
| `worktree` | `list`, `rm`, `gc`, and `hygiene` for SuperLiora worktrees |
| `export` | Zip a session for a bug report |
| `server` | Run the engine over REST + WebSocket, or install it as an OS service |
| `acp` | Run as an Agent Client Protocol server over stdio (Zed, JetBrains) |
| `browser-use` / `computer-use` | Install and check the local browser and desktop automation runtimes |
| `completions` | Print a bash, zsh, or fish completion script |

## Links

- Site: https://claudianus.github.io/superliora/en/
- Source: https://github.com/claudianus/superliora
- Issues: https://github.com/claudianus/superliora/issues
- Security: [SECURITY.md](../../SECURITY.md)

## License

MIT
