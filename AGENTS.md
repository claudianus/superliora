# Repository-level Agent Guide

Reply in the same language as the user.

Hot-path only: package map, hard constraints, and release/workflow gates every task may hit. Package-local detail lives in the nearest nested `AGENTS.md`; TUI work uses `.agents/skills/write-tui/SKILL.md`.

## Working Principles

- Prefer code facts and verification over speculation. Do not scan ordinary product docs just to reverse-engineer implementation; read nested `AGENTS.md`, skills, and code that the task actually needs.
- Keep changes focused. No drive-by refactors.
- Commits, PR text, and changesets must not reveal agent identity or add co-author attribution for the agent.

## Project Map

- `apps/liora` — CLI / TUI. Depends on `@superliora/sdk` only; **never** import `@superliora/agent-core` from app code. TUI work: `write-tui` skill.
- `apps/vis`, `apps/vis/server`, `apps/vis/web` — session/replay visual debug tools.
- `apps/site` — public static site (GitHub Pages). Unpublished reference docs live under `docs/` (see `docs/AGENTS.md`).
- `packages/agent-core` — agent engine (Agent, Session, tools, plan, DI services under `src/services/`, …).
- `packages/node-sdk` — public TypeScript SDK / harness (`@superliora/sdk`).
- `packages/kosong` — LLM / provider abstraction.
- `packages/kaos` — execution environment and file/process abstractions.
- `packages/oauth` — managed OAuth and auth utilities.
- `packages/telemetry` — shared client telemetry.
- `packages/protocol` — REST + WS schemas shared by server and CLI.
- `packages/tui-renderer` (`@harness-kit/tui-renderer`) — native terminal renderer used by `apps/liora`.
- `packages/acp-adapter` — Agent Client Protocol adapter.
- `packages/gui-use` — browser-use / computer-use runtimes.
- `packages/server` — hosts agent-core over REST + WebSocket (`/api/v1`). See `packages/server/AGENTS.md`.
- `packages/server-e2e` — live e2e against a running server (default `http://127.0.0.1:58627`; `SUPERLIORA_SERVER_URL`, legacy `KIMI_SERVER_URL`). See `packages/server-e2e/AGENTS.md`.

## Environment

- Node.js `>=24.15.0` (`.nvmrc` = `24.15.0`); pnpm `10.33.0` (`packageManager`). `.npmrc` has `engine-strict=true`.

## Hard Constraints

- **Agent standalone:** `packages/agent-core/src/agent` `Agent` must construct without a `Session`, `agentId`, or session lifecycle coupling. Optional `sessionId` may be a request-config hint only (e.g. `prompt_cache_key`); the instance must not store session graph state.
- **Workspace membership:** `pnpm-workspace.yaml` globs cover most packages; `flake.nix` has **manual** `workspacePaths` / `workspaceNames`. On every package add/remove, update **both**. `scripts/check-nix-workspace.mjs` only checks the `@superliora/liora` transitive closure — a green check does not mean leaf packages are listed.
- **Commit atomicity (MANDATORY):** Every commit touching `packages/agent-core` or `packages/node-sdk` MUST be self-contained — all new/modified types, interfaces, and modules referenced by committed code MUST be included in the same commit. Never leave uncommitted local files that committed code imports; this breaks source-install (`~/.superliora/source`) which builds from committed state only. Before committing, verify: `git stash && pnpm -C packages/node-sdk run build:dts && git stash pop`.
- Prefer existing tests for the module under change; add a new file when the area is new or the suite would become unreadable.
- Do not weaken code quality for external compatibility unless asked. Breaking user-facing changes need an explicit major decision (below).

## Workflow

- Match local package boundaries and patterns before inventing new ones. Use `#/` imports where the package already does.
- Public text and fixtures: no real internal hosts/keys — use `example.com`, `example.test`, `YOUR_API_KEY`.
- PR titles: Conventional Commits (e.g. `fix(liora): …`). Fill `.github/pull_request_template.md` with the problem and what changed; no placeholder or vague AI summary.
- User-visible prose (PR body, changeset, docs): light no-slop pass; skill at `.agents/skills/no-ai-slop/SKILL.md` when needed.
- Before opening a PR: run `.agents/skills/gen-changesets/SKILL.md` and add `.changeset/` as required.
  - **Never write `major` without explicit user approval.** Default `minor`, else `patch` if impact is unclear.

## Source-install gate

Touches to `packages/agent-core`, `packages/node-sdk`, `packages/acp-adapter`, or the `apps/liora` bundle graph need more than `tsx` / dev-only checks:

1. `pnpm -C packages/node-sdk run build:dts`
2. `pnpm run build`
3. `pnpm run check:imports`
4. `pnpm -C apps/liora run build`
5. `pnpm -C apps/liora run smoke`

Upstream ports (e.g. Kimi Code): split imports by ownership (`@superliora/sdk` vs `@superliora/agent-core`); grep leftovers like `@kimi-code/` / `@superliora/superliora-`.

## Versioning

Two independent lines:

| Line | Where | Role |
|---|---|---|
| Release | `@superliora/liora` in `apps/liora/package.json` | User-facing (`liora --version`); bump via changesets on SuperLiora impact |
| Upstream baseline | `meta/upstream.lock.yaml` (+ generated CLI embed) | Last ported Kimi Code snapshot; **not** tied to liora semver |

- Do not copy upstream semver onto `@superliora/liora`.
- Upstream-port PRs update `meta/upstream.lock.yaml`, refresh via `pnpm -C apps/liora run prebuild` (or `build`), and mention baseline in the changeset when user-visible.
- SuperLiora-only work leaves `meta/upstream.lock.yaml` alone.
- Internal package versions stay internal; only `@superliora/liora` is the release number. `/status` may show the baseline; `--version` stays short.

## Nested guides

Directory-specific rules override this file when both apply: `apps/liora/AGENTS.md`, `packages/server/AGENTS.md`, `packages/server-e2e/AGENTS.md`, `packages/agent-core/src/services/AGENTS.md`, `docs/AGENTS.md`.
