# SuperLiora

**Conductor harness** — you talk on the control plane; implementation runs as isolated Jobs in git worktrees.

[Live site](https://claudianus.github.io/superliora/) · [한국어](./README.ko.md) · [Docs](https://claudianus.github.io/superliora/docs/getting-started.html)

## Install

Requires **Node.js ≥24.15.0**.

```bash
# macOS / Linux
curl -fsSL https://raw.githubusercontent.com/claudianus/superliora/main/install.sh | bash

# Windows PowerShell
irm https://raw.githubusercontent.com/claudianus/superliora/main/install.ps1 | iex

# Windows cmd
powershell -NoProfile -ExecutionPolicy Bypass -Command "irm https://raw.githubusercontent.com/claudianus/superliora/main/install.ps1 | iex"

liora --version
```

## Usage

```bash
liora                 # interactive Conductor session
liora --continue      # resume last session in this directory
liora --plan          # start with Plan Desk steering
```

Inside the TUI: `/login` and `/model` to connect a provider, then describe the outcome. Conductor creates a Job. Watch with `/jobs` or `Alt+J` (Job Deck). Answer prompts in Inbox (`Alt+I`).

## Docs & develop

- Site & guides: https://claudianus.github.io/superliora/
- Contributing: [CONTRIBUTING.md](./CONTRIBUTING.md)
- Security: [SECURITY.md](./SECURITY.md)

## License

MIT — [LICENSE](./LICENSE)
