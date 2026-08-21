# SuperLiora

**Conductor harness** — you talk on the control plane; implementation runs as isolated Jobs in git worktrees.

[Live site](https://claudianus.github.io/superliora/) · [한국어](./README.ko.md) · [Docs](https://claudianus.github.io/superliora/docs/getting-started.html)

## Features

- **Conductor** — write the outcome; implementation runs as isolated git worktree Jobs
- **Job Deck + Inbox** — `Alt+J` watches progress, `Alt+I` answers questions, then Land locally what passed
- **Smart Auto** — model fallback and login pools keep a turn alive when a model or account blips
- **Command Hub** — `Ctrl+K` (also `Ctrl+Space` / `?`) for settings, modes, sessions, and upgrade
- **Host setup** — `/host-setup` plus a Desktop shortcut; Windows can put `SUPERLIORA_HOME` on a roomier drive
- **Locale** — Korean / English via `SUPERLIORA_LOCALE=ko|en` or Settings → Language

## Install

Requires **Node.js ≥24.15.0**.

```bash
# macOS / Linux
curl -fsSL https://raw.githubusercontent.com/claudianus/superliora/main/install.sh | bash

# Windows PowerShell
irm https://raw.githubusercontent.com/claudianus/superliora/main/install.ps1 | iex
# If C: is tight, data lands on a roomier drive (about 100 GB free).
# Override: $env:SUPERLIORA_HOME='D:\SuperLiora' then the command above, or install.ps1 --home D:\SuperLiora
# After install, double-click SuperLiora on the Desktop to open the TUI.

# Windows cmd
powershell -NoProfile -ExecutionPolicy Bypass -Command "irm https://raw.githubusercontent.com/claudianus/superliora/main/install.ps1 | iex"

liora --version
```

After a GitHub Release, `liora upgrade` (or `/upgrade` in the TUI) updates the install. That tracks published releases, not arbitrary `main` commits. Use `--main` for tip of main.

## Usage

```bash
liora                 # interactive Conductor session
liora --continue      # resume last session in this directory
liora --plan          # start with Plan Desk steering
```

Inside the TUI: `/login` and `/model` to connect a provider, `/host-setup` if the terminal is thin, then describe the outcome. Conductor creates a Job. Watch with `/jobs` or `Alt+J` (Job Deck). Answer prompts in Inbox (`Alt+I`). Command Hub is `Ctrl+K`.

## CLI

Day-to-day argv:

```bash
liora upgrade         # update to the latest GitHub Release
liora doctor          # check config; --storage reports local disk use
liora gc              # reclaim idle local storage
```

## Docs & develop

- Site & guides: https://claudianus.github.io/superliora/
- Contributing: [CONTRIBUTING.md](./CONTRIBUTING.md)
- Security: [SECURITY.md](./SECURITY.md)

## License

MIT — [LICENSE](./LICENSE)
