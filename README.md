# SuperLiora

**Run AI coding agents from your terminal.** You describe the result you want; SuperLiora does the work as isolated tasks, each in its own copy of your project — so your working files are never touched.

[Live site](https://claudianus.github.io/superliora/) · [한국어](./README.ko.md) · [Docs](https://claudianus.github.io/superliora/docs/getting-started.html)

## What it does

- **Describe, don't micromanage** — write what you want in plain words; SuperLiora turns it into a task (a "Job") and runs it for you
- **Job Deck + Inbox** — press `Alt+J` to watch progress, `Alt+I` to answer questions, then merge in locally what passed its tests
- **Server, SDK & editors** — `liora server run` hosts the engine over REST + WebSocket, `@superliora/sdk` lets you use it from your own code, and `liora acp` connects it to editors like Zed and JetBrains
- **Keeps going on errors** — if a model or account fails, SuperLiora automatically retries and switches to another (on any server error, not just timeouts), so your work doesn't stop
- **One shortcut for everything** — `Ctrl+K` (Cmd on macOS; also `Ctrl+Space` / `?`) opens one search box for settings, modes, sessions, and updates
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
liora --plan          # start in Plan mode to think through a big change first
liora -p "what you want"   # run one request without the full-screen interface
```

Inside the app: use `/login` and `/model` to connect a provider. Login options include Groq, Mistral, Together, xAI API keys, Cerebras, Perplexity, and the Vercel AI Gateway. `/quota` (or Command Hub → Quota) shows your remaining credits live (the footer shows your active provider). Run `/host-setup` if your terminal looks cramped, then describe what you want. SuperLiora creates a task; watch it with `/jobs` or `Alt+J` (Job Deck), and answer any questions in the Inbox (`Alt+I`). Open the Command Hub with `Ctrl+K` (Cmd on macOS).

## CLI

```bash
liora upgrade         # update to the latest release
liora doctor          # check your setup; --storage reports local disk use
liora gc              # free up unused local storage (different from /job gc)
liora provider list   # list providers, keys, and routing
liora worktree gc     # clean up task folders (list / rm / gc / hygiene)
liora export          # package a session for a bug report
liora server run      # host the agent engine over REST + WebSocket
liora acp             # connect the agent to editors (Agent Client Protocol)
```

## Docs & develop

- Site & guides: https://claudianus.github.io/superliora/
- Contributing: [CONTRIBUTING.md](./CONTRIBUTING.md)
- Security: [SECURITY.md](./SECURITY.md)

## License

MIT — [LICENSE](./LICENSE)
