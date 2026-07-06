# SuperLiora CLI

[![License](https://img.shields.io/badge/license-MIT-blue)](LICENSE) [![Site](https://img.shields.io/badge/site-online-blue)](https://claudianus.github.io/superliora/en/) <br>
[Site](https://claudianus.github.io/superliora/en/) · [Issues](https://github.com/claudianus/superliora/issues) · [한국어](README.ko.md)

![SuperLiora command center](./apps/site/public/assets/hero-command-center.png)

## AI coding work, carried through

SuperLiora is an independent AI coding agent for long software tasks. It connects planning, research, goal control, parallel execution, verification, memory, and project documentation in one terminal-first workflow.

The product is built for project work where context quality, provider availability, evidence, and release risk matter at the same time. It keeps decisions traceable, keeps useful knowledge available, and helps the next step begin from verified ground.

## Core capabilities

| Capability | What it supports |
| --- | --- |
| UltraPlan | Interviews requirements, constraints, risks, and missing facts until the future goal is true/false verifiable. |
| UltraResearch | Checks APIs, papers, release notes, and security issues, then keeps the evidence available. |
| UltraGoal | Starts after research-backed UltraPlan pins a concrete objective, completion criterion, and verification plan. |
| UltraSwarm | Engages specialist subagents only after a visible ENGAGE/DEFER Swarm decision. |
| UltraWork | Routes goal-driven work through research, UltraPlan, UltraGoal, Swarm decision, integration, verification, and learning. |
| Provider routing | Registers API keys and OAuth accounts, then selects fallback candidates by quota, cooldown, latency, and route health. |
| Liora Recall | Preserves project facts, decisions, procedures, follow-up work, and governance rules. |
| LLM Wiki | Turns codebase knowledge, evidence, and verification results into reusable project documentation. |
| Context OS | Maintains long sessions with structured working memory, repair, and bounded rehydration. |
| Premium themes | Provides presets, imported terminal palettes, and syntax-aware colors for long terminal sessions. |
| ACP support | Lets compatible editors continue the same SuperLiora workflow over stdio. |

## Install

Install from this GitHub source repository. You need Git and Node.js `>=24.15.0`; Corepack uses the pinned pnpm version from `package.json`.

**macOS or Linux**

```sh
curl -fsSL https://raw.githubusercontent.com/claudianus/superliora/main/install.sh | bash
```

**Windows PowerShell**

```powershell
irm https://raw.githubusercontent.com/claudianus/superliora/main/install.ps1 | iex
```

> On Windows, install [Git for Windows](https://gitforwindows.org/) before first launch. SuperLiora uses Git Bash as its shell environment. If Git Bash is installed in a custom location, set `LIORA_SHELL_PATH` to the absolute path of `bash.exe`.

Open a new shell and verify the command:

```sh
liora --version
```

The installer checks out the source under `~/.superliora/source`, builds the CLI, and installs the `liora` command.

## Quick start

Open a project and start the interactive UI:

```sh
cd your-project
liora
```

On first launch, use `/login` to connect an OAuth account or API-key based provider. To add more providers and route candidates, use `/provider` in the TUI or the non-interactive commands:

```sh
liora provider catalog add anthropic --api-key-env ANTHROPIC_API_KEY
liora provider key add openai --api-key-env OPENAI_BACKUP_KEY --label backup --auto-route
liora provider route preview <modelAlias>
liora provider route status <sessionId>
```

For larger implementation work, start with UltraWork. In the TUI, press `Shift-Tab` to turn on Ultrawork mode; normal prompts stay lightweight unless the mode is on or you explicitly request UltraWork.

```sh
liora -p "/ultrawork Audit this repo, plan the migration, implement it, run verification, and summarize the release risk."
```

Or launch the TUI and ask:

```text
Use UltraWork. Analyze this project, identify the safest migration path, implement it, verify it, and preserve the important decisions in memory.
```

## Editor and IDE use

SuperLiora speaks the Agent Client Protocol, so ACP-compatible editors and IDEs can drive a session over stdio. Log in once, then point your editor at `liora acp`.

For Zed, add this to `~/.config/zed/settings.json`:

```json
{
  "agent_servers": {
    "SuperLiora": {
      "type": "custom",
      "command": "liora",
      "args": ["acp"],
      "env": {}
    }
  }
}
```

## Documentation

- [English site](https://claudianus.github.io/superliora/en/)
- [한국어 사이트](https://claudianus.github.io/superliora/)

## Develop

Requirements: Node.js `>=24.15.0`, pnpm `10.33.0`.

```sh
git clone https://github.com/claudianus/superliora.git
cd superliora
pnpm install
```

```sh
pnpm dev:cli
pnpm test
pnpm typecheck
pnpm lint
pnpm build
```

To run the GitHub Pages landing site locally:

```sh
pnpm dev:docs
```

## Community

- [Issues](https://github.com/claudianus/superliora/issues)
- For security vulnerabilities, see [SECURITY.md](SECURITY.md).

## License

Released under the [MIT License](LICENSE).
