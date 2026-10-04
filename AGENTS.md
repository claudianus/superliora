# Repository-level Agent Guide

Reply in the same language as the user.

Hot-path only: package map, hard constraints, and release/workflow gates every task may hit. Package-local detail lives in the nearest nested `AGENTS.md`; TUI work uses `.agents/skills/write-tui/SKILL.md`. Detail that is not needed on every task lives in `.agents/reference/` — read a file there only when the task touches that area.

## Working Principles

- Prefer code facts and verification over speculation. Do not scan ordinary product docs just to reverse-engineer implementation; read nested `AGENTS.md`, skills, and code that the task actually needs.
- Keep changes focused. No drive-by code-logic refactors; TUI visual-quality reinforcement (motion, streaming visibility) is product work, not refactoring, and stays in scope.
- Commits, PR text, and changesets must not reveal agent identity or add co-author attribution for the agent.
- **Large or long-running work belongs on a dedicated git worktree + branch**, not the shared main checkout. Prefer `liora --worktree [name]`, `liora worktree …`, or an explicit `git worktree add` / feature branch before multi-file refactors, risky experiments, parallel agent runs, or anything that would leave the primary tree dirty for others. Small, local, reversible edits may stay on the current checkout. Do not auto-create isolation in product code for every session — guide the operator (or agent) to isolate when the blast radius warrants it.
- **Git hygiene:** after land/merge or when worktrees/`liora/*` branches pile up, run `liora worktree hygiene --dry-run` then `liora worktree hygiene` (optional `--stale-remotes` for merged remote heads). Do not `rm -rf` under `~/.superliora/worktrees`. Agent playbook: `.agents/skills/git-hygiene/SKILL.md`.

## Project Map

- `apps/liora` — CLI / TUI. Depends on `@superliora/sdk` only; **never** import `@superliora/agent-core` from app code. TUI work: `write-tui` skill.
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

## Folder layout (in-package IA)

Package boundaries stay as in Project Map. Inside a package:

- Prefer **domain folders**; keep flat `.ts` siblings at one directory depth **≤25** (soft), warn/fail via `pnpm run check:dir` when **>40** (see `scripts/check-dir-budget.mjs`).
- **One public entry per domain:** either `domain/index.ts` or a single `domain.ts`, not both long-term. Temporary compat barrels are OK only during a migration PR that also rewrites imports and deletes the dual path.
- Runtime modules use **kebab-case** paths; `packages/agent-core/src/services/` keeps **camelCase** (see nested `AGENTS.md`).
- Do not add new packages or merge packages for layout cleanup alone.

## Hard Constraints

- **Agent standalone:** `packages/agent-core/src/agent` `Agent` must construct without a `Session`, `agentId`, or session lifecycle coupling. Optional `sessionId` may be a request-config hint only (e.g. `prompt_cache_key`); the instance must not store session graph state.
- **Workspace membership:** `pnpm-workspace.yaml` globs cover most packages; `flake.nix` has **manual** `workspacePaths` / `workspaceNames`. On every package add/remove, update **both**. `scripts/check-nix-workspace.mjs` only checks the `@superliora/liora` transitive closure — a green check does not mean leaf packages are listed.
- **Commit atomicity (MANDATORY):** Every commit touching `packages/agent-core` or `packages/node-sdk` MUST be self-contained — all new/modified types, interfaces, and modules referenced by committed code MUST be included in the same commit. Never leave uncommitted local files that committed code imports; this breaks source-install (`~/.superliora/source`) which builds from committed state only. Before committing, verify: `git stash && pnpm -C packages/node-sdk run build:dts && git stash pop`.
- **TUI real-time visibility:** agent tool activity streams to the TUI live for main, subagent, and swarm runs alike; event conversion/truncation happens on the agent-core emitter side so every client benefits. Motion, frame-budget, and quality-level rules live in `apps/liora/AGENTS.md` ("Real-time and visual quality") and `apps/liora/src/tui/PREMIUM.md`.
- Prefer existing tests for the module under change; add a new file when the area is new or the suite would become unreadable.
- Do not weaken code quality for external compatibility unless asked. Breaking user-facing changes need an explicit major decision (below).

## Local test gate (MANDATORY)

**Never push to find out whether tests pass.** GitHub CI is a ~15-minute backstop (per-push Windows CI runs a Windows-critical subset; the full Windows suite gates the nightly schedule and release tags). The full suite is a few minutes on Linux CI / fast hosts, and about 15 minutes on a typical Windows workstation (import cost dominates, not assertion count). A red CI run that a local run would have caught is a process failure, not bad luck.

| When | Command | Cost |
|---|---|---|
| One file / one case | `node scripts/test-local.mjs <path> -t "case"` | ~5s |
| Default: tests related to your diff | `node scripts/test-local.mjs` (or `pnpm run test:local`) | seconds (scope rules in reference) |
| Workspace granularity (no name matching) | `node scripts/test-local.mjs --closure` / `--direct` | seconds–1 min |
| Fast pre-commit gate (no package rebuild) | `pnpm run gate:fast` — lint + `typecheck:fast` + related tests | skips `build:packages` |
| Before every push | `pnpm run gate` — lint + typecheck + related tests | Linux CI a few minutes; Windows workstation minutes |
| Whole suite | `pnpm run test:all` | ~2.5 min on Linux/macOS, ~15 min on Windows; CI runs it on every PR |

- **Always run tests through `scripts/test-local.mjs`, not bare `vitest`** (bare `pnpm exec vitest` is for `--watch` only). Run `pnpm run test:all` after sweeping refactors.
- Tests must hold under the runner's parity env (UTC clock, no ambient git config, pinned motion, no wall-clock perf budgets). No existence/`typeof`/literal-only tests.
- Scope-selection rules, blind spots, and the full parity-env checklist: `.agents/reference/testing.md`.

## Local interactive debug

Use `liora --debug` (source: `pnpm -C apps/liora run dev -- --debug`); `test-local` is not a motion/session judge. Log locations and debug rules: `.agents/reference/local-debug.md`.

## Workflow

- Match local package boundaries and patterns before inventing new ones. Use `#/` imports where the package already does.
- Public text and fixtures: no real internal hosts/keys — use `example.com`, `example.test`, `YOUR_API_KEY`.
- PR titles: Conventional Commits (e.g. `fix(liora): …`). Fill `.github/pull_request_template.md` with the problem and what changed; no placeholder or vague AI summary.
- User-visible prose (PR body, changeset, docs): light no-slop pass; skill at `.agents/skills/no-ai-slop/SKILL.md` when needed.
- Before opening a PR: run `.agents/skills/gen-changesets/SKILL.md` and add `.changeset/` as required. `pnpm run check:changeset` enforces presence against `origin/main` (product code without a changeset fails).
  - **Never write `major` without explicit user approval.** Default `minor`, else `patch` if impact is unclear.
- **Release train (automated):** landing a `@superliora/liora` changeset and getting a green CI run on `main` ships it — `.github/workflows/auto-release.yml` versions the pending changesets, commits `chore(liora): release X.Y.Z`, tags `vX.Y.Z`, and dispatches `publish-native-release.yml`. No manual release cut or reminder is needed. Intervene only when the Auto Release run fails (re-run it via its `workflow_dispatch` after fixing). `major` still requires explicit user approval in the changeset, and pushing a `v*` tag yourself still triggers a publish — do that only when the user explicitly asks.

## Git commits

Author and message policy is enforced by `packages/agent-core/src/tools/support/git-commit-policy.ts`: prefer `git config` identity (else `SuperLiora <superliora@localhost>`), Conventional Commits `type(scope): subject` ≤72 chars, no vague subjects. Full rules: `.agents/reference/git-commit-policy.md`.

## Source-install gate

Touches to `packages/agent-core`, `packages/node-sdk`, `packages/acp-adapter`, or the `apps/liora` bundle graph need more than `tsx` / dev-only checks:

1. `pnpm -C packages/node-sdk run build:dts`
2. `pnpm run build`
3. `pnpm run check:imports`
4. `pnpm -C apps/liora run build`
5. `pnpm -C apps/liora run smoke`
6. `pnpm run check:test-baseline` — test ratchet against `meta/test-baseline.yaml`; new failures or fixed-but-still-pinned failures fail the gate. After deliberately fixing pinned failures, refresh with `node scripts/check-test-baseline.mjs --update` and commit the smaller baseline.

Upstream ports (e.g. Kimi Code): split imports by ownership (`@superliora/sdk` vs `@superliora/agent-core`); grep leftovers like `@kimi-code/` / `@superliora/superliora-`.

## Versioning

`@superliora/liora` (`apps/liora/package.json`) is the only release number; `meta/upstream.lock.yaml` is the upstream Kimi Code baseline and is not tied to liora semver. Do not copy upstream semver; SuperLiora-only work leaves the lock alone. Details: `.agents/reference/versioning.md`.

## Nested guides

Directory-specific rules override this file when both apply: `apps/liora/AGENTS.md`, `packages/server/AGENTS.md`, `packages/server-e2e/AGENTS.md`, `packages/agent-core/AGENTS.md`, `packages/agent-core/src/services/AGENTS.md`, `docs/AGENTS.md`.

Cursor Cloud VM caveats: `.agents/reference/cursor-cloud.md`.
