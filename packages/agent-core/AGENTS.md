# agent-core Agent Guide

Package-local rules for `packages/agent-core` (`@superliora/agent-core`). Cross-repo gates: root `AGENTS.md`. DI service conventions: `src/services/AGENTS.md`.

## What it is

The agent engine: turn loop, tools, session/subagent orchestration, compaction, RPC core, and in-process DI services. Consumed by `@superliora/sdk` and `packages/server`. **Apps must not import this package directly** — use `@superliora/sdk`.

## Hard constraints (package)

- **Agent standalone:** `src/agent` `Agent` constructs without a `Session`, `agentId`, or session lifecycle coupling. Optional `sessionId` is a request-config hint only; do not store session graph state on the instance.
- **Commit atomicity:** Any commit that touches this package (or `packages/node-sdk`) must include every new/modified module that committed code imports. Source-install builds from committed state only.
- **Loop purity:** `src/loop` must not import host-layer implementations (session, RPC transport, permission UI). Hosts adapt into the loop contracts.
- Path alias: `#/*` → `./src/*`.

## Layout (`src/`)

| Path | Role |
|---|---|
| `loop/` | Stateless agent loop (`runTurn`, tool-call batch, scheduler, guards) |
| `agent/` | `Agent` facade, turn, compaction, context, permissions, plan |
| `session/` | Session host; thin re-exports for subagent/swarm during migration |
| `collaboration/` | Swarm / subagent orchestration home (see nested `AGENTS.md`) |
| `tools/` | Builtin tools, policies, providers |
| `rpc/` | Core RPC surface shared with server/CLI |
| `services/` | In-process DI services (see nested `AGENTS.md`) |
| `config/`, `profile/`, `skill/`, `memory/` | Config, profiles, skills, memory stores |

`Manager` suffixes are allowed under `agent/` / `session/` / `collaboration/` / `mcp/` / `plugin/`. They are **banned** under `services/` (use `Service`).

Prefer extending the owning module over growing god files. New cross-cutting helpers belong next to the first consumer, not a catch-all util barrel.

## Hot-path modules

- `loop/tool-call.ts` — tool-call batch lifecycle; guard state in `loop/tool-call-guards.ts`
- `agent/turn/kosong-llm.ts` — kosong LLM adapter; route state/classify in sibling `provider-route-*.ts`
- `session/subagent/subagent-host.ts` — subagent public surface; errors/progress/lifecycle in `subagent-errors.ts` / `subagent-progress-preview.ts` / `subagent-run-lifecycle.ts`

## Tests

- Prefer `test/` mirrors of the module under change (`test/loop`, `test/session`, `test/agent`, …).
- Add a new file when the area is new or the suite would become unreadable.
- Run focused vitest before broad package runs: `pnpm -C packages/agent-core exec vitest run <path>`.

## Commands

```bash
pnpm -C packages/agent-core test
pnpm -C packages/node-sdk run build:dts   # after public surface changes
```
