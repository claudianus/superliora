# SuperLiora

**Conductor harness** — you talk on the control plane; implementation runs as isolated Jobs in git worktrees.

[Live site](https://claudianus.github.io/superliora/) · [한국어](./README.ko.md) · [Docs](https://claudianus.github.io/superliora/docs/getting-started.html)

## Features

- **Conductor** — write the outcome; implementation runs as isolated git worktree Jobs
- **Job Deck + Inbox** — `Alt+J` watches progress, `Alt+I` answers questions, then Land locally what passed
- **Smart Auto** — model fallback, login pools, and Never-Halt retries (HTTP 5xx, not only 504) keep a turn alive when a model or account blips
- **Command Hub** — `Ctrl+K` (Cmd on macOS; also `Ctrl+Space` / `?`) for settings, modes, sessions, and upgrade
- **Host setup** — `/host-setup` plus a Desktop shortcut on every OS. Windows may auto-pick a roomier drive (~100 GB). Pin the home on any OS with `SUPERLIORA_HOME` or `--home`
- **Locale** — Korean / English via `SUPERLIORA_LOCALE=ko|en`, Settings → Language, or `/locale`

## Install

Needs **Node.js 24.15.0**. The one-liner downloads it into the data home if the host has none.

```bash
# macOS / Linux
curl -fsSL https://raw.githubusercontent.com/claudianus/superliora/main/install.sh | bash
# Pin the home: SUPERLIORA_HOME=... then the one-liner, or download and run install.sh --home ...

# Windows PowerShell
irm https://raw.githubusercontent.com/claudianus/superliora/main/install.ps1 | iex
# If C: is tight, Windows picks a roomier drive (about 100 GB free).
# Piped irm | iex ignores flags. Set $env:SUPERLIORA_HOME first, or download and run .\install.ps1 --home D:\SuperLiora

# Windows cmd
powershell -NoProfile -ExecutionPolicy Bypass -Command "irm https://raw.githubusercontent.com/claudianus/superliora/main/install.ps1 | iex"

liora --version
```

After install, double-click SuperLiora on the Desktop to open the TUI.

After a GitHub Release, `liora upgrade` (or `/upgrade` in the TUI) updates the install. That tracks published releases, not arbitrary `main` commits. Use `--main` for tip of main.

## Usage

```bash
liora                 # interactive Conductor session
liora --continue      # resume last session in this directory
liora --plan          # start with Plan Desk steering
```

Inside the TUI: `/login` and `/model` to connect a provider. Catalog login includes Groq, Mistral, Together, xAI API keys, Cerebras, Perplexity, and Vercel AI Gateway. `/quota` (or Command Hub → Quota) shows live remaining credits (footer chip is the active provider). `/host-setup` if the terminal is thin, then describe the outcome. Conductor creates a Job. Watch with `/jobs` or `Alt+J` (Job Deck). Answer prompts in Inbox (`Alt+I`). Command Hub is `Ctrl+K` (Cmd on macOS).

## CLI

Optional hygiene:

```bash
liora upgrade         # update to the latest GitHub Release
liora doctor          # check config; --storage reports local disk use
liora gc              # reclaim idle local storage (not the same as /job gc)
```

## Docs & develop

- Site & guides: https://claudianus.github.io/superliora/
- Contributing: [CONTRIBUTING.md](./CONTRIBUTING.md)
- Security: [SECURITY.md](./SECURITY.md)

## License

MIT — [LICENSE](./LICENSE)
