# SuperLiora CLI

> Terminal application package for the SuperLiora AI coding agent.

[![License](https://img.shields.io/badge/license-MIT-blue)](../../LICENSE) [![Site](https://img.shields.io/badge/site-online-blue)](https://claudianus.github.io/superliora/en/)

## What this package contains

This package builds the terminal CLI/TUI application used by SuperLiora. It provides the `liora` source-install workflow, interactive terminal interface, provider commands, ACP stdio entrypoint, theme system, and long-task command surfaces.

SuperLiora is designed for software work where provider availability, route health, context quality, research evidence, and verification all matter during the same session.

## Capabilities

| Area | Capability |
| --- | --- |
| Source install | Builds from the repository source and installs the local `liora` command. |
| Provider operations | Supports multi-provider catalogs, custom endpoints, API-key/OAuth pools, labels, and secret-safe status. |
| Routing | Supports `auto`, `fallback`, `fill_first`, `round_robin`, `weighted_round_robin`, `least_used`, `lowest_latency`, `rate_limit_aware`, and `random`. |
| Quota handling | Classifies auth, quota, rate-limit, timeout, server, connection, and empty-response failures, then cools down unhealthy candidates. |
| Long context | Uses Context OS compaction, structured working memory, repair, and bounded rehydration. |
| Memory | Supports Liora Recall semantic, episodic, procedural, prospective, and governance memory scopes. |
| Workflow | Runs UltraWork planning, research, goal creation, swarm execution, integration, verification, and learning. |
| TUI | Provides premium themes, bundled terminal palettes, syntax-aware colors, and clearer status surfaces. |

## Install

The recommended path builds SuperLiora from this GitHub source repository. It requires Git and Node.js 24.15.0 or later.

**macOS / Linux**

```sh
curl -fsSL https://raw.githubusercontent.com/claudianus/superliora/main/install.sh | bash
```

**Windows PowerShell**

```powershell
irm https://raw.githubusercontent.com/claudianus/superliora/main/install.ps1 | iex
```

Open a new terminal session and verify:

```sh
liora --version
```

## Quick start

Open a project and start the interactive UI:

```sh
cd your-project
liora
```

Connect providers and route candidates:

```sh
liora provider catalog add anthropic --api-key-env ANTHROPIC_API_KEY
liora provider key add openai --api-key-env OPENAI_BACKUP_KEY --label backup --auto-route
liora provider route preview <modelAlias>
liora provider route status <sessionId>
```

Run a larger task through UltraWork:

```sh
liora -p "/ultrawork Plan, implement, verify, and summarize the release risk for this change."
```

## Links

- Site: https://claudianus.github.io/superliora/en/
- Source: https://github.com/claudianus/superliora
- Issues: https://github.com/claudianus/superliora/issues
- Security: see `SECURITY.md` in the main repository

## License

MIT
