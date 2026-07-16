# SuperLiora

[![License: MIT](https://img.shields.io/badge/License-MIT-E63946.svg)](./LICENSE)
[![GitHub Pages](https://img.shields.io/badge/GitHub%20Pages-live-E63946)](https://claudianus.github.io/superliora/)
[![Node.js](https://img.shields.io/badge/Node.js-%3E%3D24.15.0-E63946)](https://nodejs.org/)
[![pnpm](https://img.shields.io/badge/pnpm-10.33.0-E63946)](https://pnpm.io/)
[![Brand](https://img.shields.io/badge/Brand-Blood%20Moon-E63946)](https://claudianus.github.io/superliora/)

**A Blood Moon terminal harness that carries long development work from plan to verified finish.**

[Live site](https://claudianus.github.io/superliora/) · [한국어 README](./README.ko.md) · [English site](https://claudianus.github.io/superliora/en/)

```bash
# install
curl -fsSL https://raw.githubusercontent.com/claudianus/superliora/main/install.sh | bash

# interactive session
liora

# complex work → Ultrawork plan steering
liora --plan

# resume last session in cwd
liora --continue
```

## What it is

SuperLiora (`liora`) is a self-contained AI coding harness for sustained software work. Brand primary is **Blood Moon** (`#E63946`). It connects research, planning, goals, parallel specialists, verification, memory, documentation, browser-use, and computer-use into one operator flow — **Ultrawork**.

Long sessions keep structured context, leave evidence-backed decisions, and stay readable on a dark cinematic TUI.

## Ultrawork spine

Inside an interactive session, `Shift-Tab` (or `/ultrawork`, `liora --plan`) runs:

1. **Research** — ground in APIs, release notes, and code facts  
2. **UltraPlan interview** — narrow requirements until the goal is true/false verifiable  
3. **UltraGoal** — lock objectives, budgets, and acceptance criteria  
4. **UltraResearch loop** — cite sources before high-risk choices  
5. **UltraSwarm** — ENGAGE or DEFER up to 128 specialist subagents  
6. **Integrate → Verify** — merge work and close with tests / runtime evidence  
7. **Learn** — write project-local LLM Wiki pages; store only durable facts in Liora Recall  

## Capability map

| Surface | What it does |
|---|---|
| **UltraPlan** | Interview requirements, constraints, non-goals, risks |
| **UltraGoal** | Pin objectives and verification criteria after research |
| **UltraResearch** | Check APIs, papers, advisories; leave citations |
| **UltraSwarm** | ENGAGE/DEFER gate + specialist subagents (max 128) |
| **Context OS** | Compaction, working memory, continuity repair, rehydration |
| **Liora Recall** | Semantic · episodic · procedural · prospective memory |
| **LLM Wiki** | Project-local reviewable knowledge from Ultrawork runs |
| **Browser-use** | CloakBrowser + Playwright page observation and control |
| **Computer-use** | CUA/MCP native desktop capture and control |
| **Provider routing** | Fallback by quota, cooldown, latency, route health |
| **Premium TUI** | Blood Moon / Daylight palettes, keyboard-first navigation |
| **ACP** | Same workflow over stdio to ACP-compatible editors/IDEs |
| **Premium Quality** | Art direction + anti-slop + screenshot proof gate (`/premium`) |

## Install

Requires **Node.js ≥24.15.0** and **pnpm 10.33.0** (Corepack).

```bash
# macOS / Linux
curl -fsSL https://raw.githubusercontent.com/claudianus/superliora/main/install.sh | bash

# Windows PowerShell
irm https://raw.githubusercontent.com/claudianus/superliora/main/install.ps1 | iex

liora --version   # SuperLiora 0.20.1
```

### Quick start

```bash
liora                                    # interactive session
liora --plan                             # Ultrawork plan steering
liora -p "explain this repo"             # single-turn headless
liora -p "/ultrawork harden auth path"   # headless Ultrawork
liora --continue                         # resume last session in cwd
liora server run --foreground            # local server (default 127.0.0.1:58627)
liora provider list                      # models / credentials
```

## Monorepo map

| Path | Role |
|---|---|
| `apps/liora` | CLI / TUI (`@superliora/liora`) |
| `apps/site` | GitHub Pages landing (this brand surface) |
| `apps/vis` | Session / wire visual debugger |
| `packages/agent-core` | Agent engine, Ultrawork, memory, tools |
| `packages/node-sdk` | Public TypeScript SDK (`@superliora/sdk`) |
| `packages/server` | REST + WebSocket session host |
| `packages/gui-use` | Browser-use + computer-use runtimes |
| `packages/acp-adapter` | Agent Client Protocol adapter |
| `packages/kosong` | LLM / provider abstraction |
| `packages/kaos` | Execution environment abstractions |
| `docs/` | Unpublished EN/ZH reference (not the public site) |

## Development

```bash
git clone https://github.com/claudianus/superliora.git
cd superliora
pnpm install
pnpm run build

# CLI only
pnpm -C apps/liora run dev

# GitHub Pages site
pnpm -C apps/site run dev
pnpm -C apps/site run build
```

See [CONTRIBUTING.md](./CONTRIBUTING.md) and [SECURITY.md](./SECURITY.md).

## License

MIT — [LICENSE](./LICENSE)

© SuperLiora Contributors
