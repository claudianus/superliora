# SuperLiora

[![License](https://img.shields.io/badge/license-MIT-blue)](LICENSE) [![Version](https://img.shields.io/badge/version-0.20.1-blue)](apps/liora/package.json) [![Site](https://img.shields.io/badge/site-online-blue)](https://claudianus.github.io/superliora/en/) <br>
[Site](https://claudianus.github.io/superliora/en/) · [Issues](https://github.com/claudianus/superliora/issues) · [한국어](README.ko.md)

![SuperLiora command center](https://claudianus.github.io/superliora/assets/hero-command-center.png)

## A terminal-first AI coding harness for long, complex tasks

SuperLiora is an independent AI coding harness that runs in your terminal. It connects planning, research, goal control, parallel execution, verification, memory, documentation, browser use, and computer use into one workflow so long sessions stay coherent and decisions stay traceable.

- **Plan before code.** UltraPlan interviews requirements until the goal is true/false-verifiable.
- **Work with evidence.** UltraResearch checks sources, APIs, papers, and security advisories before decisions are made.
- **Distribute safely.** UltraSwarm assembles specialist subagents behind a visible ENGAGE/DEFER gate.
- **Stay coherent.** Context OS, Liora Recall, and LLM Wiki keep long sessions grounded and reusable.
- **Act beyond the editor.** Browser-use (CloakBrowser + Playwright) and computer-use (CUA/MCP) interact with real UIs.
- **Use it anywhere.** Premium TUI, ACP editor support, and provider routing let you run from a terminal or inside an IDE.

## Core capabilities

| Capability | What it does | Entry point |
| --- | --- | --- |
| **UltraPlan** | Interviews requirements, constraints, risks, and missing facts until the objective is true/false-verifiable. | `packages/agent-core/src/agent/plan/ultra-plan-mode.ts` |
| **UltraResearch** | Checks APIs, papers, release notes, and security issues before decisions are made. | `packages/agent-core/src/ultrawork/mode.ts` |
| **UltraGoal** | Pins a concrete objective, completion criterion, and budget after research-backed planning. | `packages/agent-core/src/agent/injection/goal.ts` |
| **UltraSwarm** | Assembles up to 128 specialist subagents across phased plan/implement/review waves, with a visible ENGAGE/DEFER gate. | `packages/agent-core/src/tools/builtin/collaboration/ultra-swarm.ts` |
| **Context OS** | Maintains long sessions with structured working memory, repair, and bounded rehydration. | `packages/agent-core/src/agent/context-os/index.ts` |
| **Liora Recall** | Preserves semantic, episodic, procedural, prospective, and governance memory across sessions. | `packages/agent-core/src/memory/types.ts` |
| **LLM Wiki** | Turns codebase knowledge, evidence, and verification results into project-local reviewable docs. | `apps/liora/src/tui/commands/llm-wiki.ts` |
| **Browser-use** | Drives CloakBrowser + Playwright to observe, act, screenshot, and evaluate web pages. | `packages/gui-use/src/browser/cloak-browser.ts` |
| **Computer-use** | Uses CUA/MCP to capture and act on native desktop windows. | `packages/gui-use/src/computer/cua-computer.ts` |
| **Provider routing** | Registers API keys and OAuth accounts, then selects fallback candidates by quota, cooldown, latency, and route health. | `packages/agent-core/src/session/provider-manager.ts` |
| **Premium TUI** | Configurable terminal surface with Neon Noir / Daylight palettes and keyboard-first navigation. | `apps/liora/src/tui/config.ts` |
| **ACP** | Exposes the same SuperLiora workflow over stdio to ACP-compatible editors and IDEs. | `packages/acp-adapter/src/server.ts` |

## Install

Install from this GitHub source repository. You need Git and Node.js `>=24.15.0`; Corepack uses the pinned pnpm version `10.33.0` from `package.json`.

**macOS or Linux**

```sh
curl -fsSL https://raw.githubusercontent.com/claudianus/superliora/main/install.sh | bash
```

**Windows PowerShell**

```powershell
irm https://raw.githubusercontent.com/claudianus/superliora/main/install.ps1 | iex
```

> On Windows, install [Git for Windows](https://gitforwindows.org/) before first launch. SuperLiora uses Git Bash as its shell environment. If Git Bash is installed in a custom location, set `LIORA_SHELL_PATH` to the absolute path of `bash.exe`.

Open a new shell and verify:

```sh
liora --version
```

The installer checks out the source under `~/.superliora/source`, builds the CLI, and links the `liora` command.

## Quick start

Open a project and start the interactive TUI:

```sh
cd your-project
liora
```

On first launch, use `/login` to connect an OAuth account or API-key provider. Add more providers and route candidates with `/provider` in the TUI, or use non-interactive commands:

```sh
liora provider catalog add anthropic --api-key-env ANTHROPIC_API_KEY
liora provider key add openai --api-key-env OPENAI_BACKUP_KEY --label backup --auto-route
liora provider route preview <modelAlias>
liora provider route status <sessionId>
```

For larger work, start with UltraWork. In the TUI, press `Shift-Tab` to turn on Ultrawork mode. Normal prompts stay lightweight unless the mode is on or you explicitly request UltraWork.

```sh
liora -p "/ultrawork Audit this repo, plan the migration, implement it, run verification, and summarize the release risk."
```

Or in the TUI:

```text
Use UltraWork. Analyze this project, identify the safest migration path, implement it, verify it, and preserve the important decisions in memory.
```

### Browser and computer use

When a task needs a real browser or desktop UI, use the same harness:

```text
Open the browser, navigate to the staging site, run the login flow, and verify the dashboard renders.
```

```text
Capture the current Xcode window, inspect the build error, and propose a fix.
```

Both paths are gated by the same permission, memory, and verification model as code edits.

## Editor and IDE use (ACP)

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

## Visual debugging

SuperLiora includes visual debugging tools in `apps/vis` for inspecting sessions, replays, context, and agent traces. Run them locally:

```sh
pnpm vis
```

## Themes

The Premium TUI supports multiple palettes and imported terminal colors. Preview them inside the harness:

```sh
liora theme preview
```

Theme configuration lives in `apps/liora/src/tui/config.ts`.

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
