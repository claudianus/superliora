# SuperLiora

**Run AI coding agents from your terminal.** Describe the result you want; SuperLiora works autonomously through Bash and SessionControl. Normal requests run directly in your workspace. Choose a native Job or an explicit worktree when you need isolation.

[Live site](https://claudianus.github.io/superliora/) · [한국어](./README.ko.md) · [Docs](https://claudianus.github.io/superliora/docs/getting-started.html)

## What it does

- **Direct autonomous work** — the model uses Bash to inspect and change your project, and SessionControl to spawn, list, message, wait for, stop, or compact worker sessions
- **Live workers, Job Deck + Inbox** — see running work, press `Alt+J` for native Jobs and `Alt+I` for questions, and manually review changes before landing or pushing
- **Server, SDK & editors** — `liora server run` hosts the engine over REST + WebSocket, `@superliora/sdk` lets you use it from your own code, and `liora acp` connects it to editors like Zed and JetBrains
- **Durable sessions** — conversation, journal, and replay preserve session history without replaying shell effects; explicit full compaction keeps the latest real user request
- **One shortcut for settings** — `Ctrl+K` (Cmd on macOS; also `Ctrl+Space` / `?`) opens one search box for settings, sessions, and updates
- **Easy terminal setup** — run `/host-setup`, plus a Desktop shortcut on every OS. On Windows, if the C: drive is low on space, the installer picks a roomier drive (~100 GB). Set the install location on any OS with `SUPERLIORA_HOME` or `--home`
- **Korean / English** — switch with `SUPERLIORA_LOCALE=ko|en`, Settings → Language, or `/locale`

## Install

Requires **Node.js 24.15.0**. If your machine doesn't have it, the one-liner downloads it into SuperLiora's own folder.

```bash
# macOS / Linux
curl -fsSL https://raw.githubusercontent.com/claudianus/superliora/main/install.sh | bash
# To choose the install location: set SUPERLIORA_HOME=... then run the one-liner, or download and run install.sh --home ...

# Windows PowerShell
irm https://raw.githubusercontent.com/claudianus/superliora/main/install.ps1 | iex
# If the C: drive is tight, Windows picks a roomier drive (about 100 GB free).
# Piping irm | iex ignores flags. Set $env:SUPERLIORA_HOME first, or download and run .\install.ps1 --home D:\SuperLiora

# Windows cmd
powershell -NoProfile -ExecutionPolicy Bypass -Command "irm https://raw.githubusercontent.com/claudianus/superliora/main/install.ps1 | iex"

liora --version
```

After installing, double-click SuperLiora on the Desktop to open it.

When a new version is released, run `liora upgrade` (or `/upgrade` inside the app) to update. This follows published releases, not in-progress code. Use `--main` if you want the newest, unreleased code.

## Usage

```bash
liora                 # open an interactive session
liora --continue      # resume the last session in this folder
liora -p "what you want"   # run one request without the full-screen interface
```

Inside the app, use `/login` and `/model` to connect a provider and choose a model. `/quota` (or Command Hub → Quota) shows supported providers’ remaining credits live. Run `/host-setup` if your terminal looks cramped, then describe what you want. Requests execute in the current workspace; worker sessions are not automatically isolated. Use `/jobs` or `Alt+J` for explicit native Jobs and their Kanban/worktree controls, and the Inbox (`Alt+I`) for questions. Review, land, and push are operator-controlled.

## CLI

```bash
liora upgrade         # update to the latest release
liora doctor          # check your setup; --storage reports local disk use
liora gc              # free up unused local storage (different from /job gc)
liora provider list   # list configured providers and credentials
liora worktree gc     # clean up task folders (list / rm / gc / hygiene)
liora export          # package a session for a bug report
liora server run      # host the agent engine over REST + WebSocket
liora acp             # connect the agent to editors (Agent Client Protocol)
```

## Major migration

The minimal harness exposes only **Bash** and **SessionControl** to the model. Plans, goals, memory, skills, plugins, MCP, cognitive catalogs, and role/persona routing are retired. Automatic worker and whole-turn retries, loop-step retries, strict resends, effect replay, and mandatory verification/review pipelines are removed. A completed request is not a claim that tests passed. Operator-configured native provider routes and pre-output fallback handling remain; they do not guarantee recovery after work has begun.

Native provider/authentication configuration, approvals, sessions, durable aside forks, process cancellation, Jobs, Kanban, and explicit worktrees remain. Failed native Jobs retain cleanup ownership until explicitly settled; settlement does not rerun their effects.

Older configuration containing retired keys or sections is rejected rather than silently migrated. Remove the keys and sections named by the configuration error manually, including `[research]` and `[loop_control].max_retries_per_step` if present. The [retired-field validation](./packages/agent-core/src/config/toml-transform.ts) defines these rejected fields. SuperLiora does not rewrite your home configuration.

## Docs & develop

- Site & guides: https://claudianus.github.io/superliora/
- Contributing: [CONTRIBUTING.md](./CONTRIBUTING.md)
- Security: [SECURITY.md](./SECURITY.md)

## License

MIT — [LICENSE](./LICENSE)
