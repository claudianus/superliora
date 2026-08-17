# Repository-level Agent Guide

Reply in the same language as the user.

Hot-path only: package map, hard constraints, and release/workflow gates every task may hit. Package-local detail lives in the nearest nested `AGENTS.md`; TUI work uses `.agents/skills/write-tui/SKILL.md`.

## Working Principles

- Prefer code facts and verification over speculation. Do not scan ordinary product docs just to reverse-engineer implementation; read nested `AGENTS.md`, skills, and code that the task actually needs.
- Keep changes focused. No drive-by code-logic refactors; TUI visual-quality reinforcement (motion, streaming visibility) is product work, not refactoring, and stays in scope.
- Commits, PR text, and changesets must not reveal agent identity or add co-author attribution for the agent.
- **Large or long-running work belongs on a dedicated git worktree + branch**, not the shared main checkout. Prefer `liora --worktree [name]`, `liora worktree …`, or an explicit `git worktree add` / feature branch before multi-file refactors, risky experiments, parallel agent runs, or anything that would leave the primary tree dirty for others. Small, local, reversible edits may stay on the current checkout. Do not auto-create isolation in product code for every session — guide the operator (or agent) to isolate when the blast radius warrants it.
- **Git hygiene:** after land/merge or when worktrees/`liora/*` branches pile up, run `liora worktree hygiene --dry-run` then `liora worktree hygiene` (optional `--stale-remotes` for merged remote heads). Do not `rm -rf` under `~/.superliora/worktrees`. Agent playbook: `.agents/skills/git-hygiene/SKILL.md`.

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

**Never push to find out whether tests pass.** GitHub CI is a ~15-minute backstop; the full local suite is ~2 minutes. A red CI run that a local run would have caught is a process failure, not bad luck.

| When | Command | Cost |
|---|---|---|
| One file / one case | `node scripts/test-local.mjs <path> -t "case"` | ~5s |
| While iterating | `pnpm run test:local` — changed workspaces **and their pnpm dependents** | seconds–1 min |
| Before every push | `pnpm run gate` — lint + typecheck + full suite | ~3.5 min |
| Whole suite only | `pnpm run test:all` | ~2.5 min |

`test:local` widens to the full suite when a shared file (root config, `scripts/`) changes and skips the run entirely when only docs/changesets changed; `--scope` prints the decision without running, `--all` forces everything.

**Always run tests through `scripts/test-local.mjs`, not bare `vitest`.** A dev shell is not a runner: `NO_COLOR` / `TERM=dumb` silently disable TUI motion, a local timezone hides UTC clock assertions, `init.defaultBranch=main` hides bare-repo HEAD assumptions, and provider keys in your shell let network paths pass that CI cannot reach. The runner strips that state; `node scripts/test-local.mjs --env` prints exactly what it changes. Bare `pnpm exec vitest` is for `--watch` only, and its green result proves nothing about CI.

Tests you write must hold under that parity env:

- No hardcoded local clock strings — derive the expected label from the same formatter (`TZ=UTC` in the runner).
- Pin appearance/motion (`profile: 'off'`) when asserting cached line identity or plain-substring output; ambient effects re-render and interleave SGR runs.
- Never rely on ambient git config: set `user.email` / `user.name` and pass `--initial-branch` in fixtures that create repos.
- No wall-clock perf budgets. Measure the cheap path against the expensive one it replaces, not against an absolute millisecond number.

Debt rule: a test that only asserts an export exists, a constant equals its own literal, or `typeof x === 'function'` is noise — do not add one, and delete the ones you find. Runtime behavior or nothing.

## Workflow

- Match local package boundaries and patterns before inventing new ones. Use `#/` imports where the package already does.
- Public text and fixtures: no real internal hosts/keys — use `example.com`, `example.test`, `YOUR_API_KEY`.
- PR titles: Conventional Commits (e.g. `fix(liora): …`). Fill `.github/pull_request_template.md` with the problem and what changed; no placeholder or vague AI summary.
- User-visible prose (PR body, changeset, docs): light no-slop pass; skill at `.agents/skills/no-ai-slop/SKILL.md` when needed.
- Before opening a PR: run `.agents/skills/gen-changesets/SKILL.md` and add `.changeset/` as required. `pnpm run check:changeset` enforces presence against `origin/main` (product code without a changeset fails).
  - **Never write `major` without explicit user approval.** Default `minor`, else `patch` if impact is unclear.
- **Release reminder (MANDATORY after land):** `commit` → `push` → PR `merge` to `main` does **not** publish a user-facing build. There is **no** auto-release on merge (no `changesets/action` version/publish job). `liora upgrade` tracks the GitHub Release / published `@superliora/liora` version, not arbitrary `main` commits. After merging product work that carries a `@superliora/liora` changeset (or otherwise should ship to CLI users), **remind the operator that a release cut is still required** before `liora upgrade` / install scripts pick it up. Do **not** cut or publish a release unless the user explicitly asks.

## Git commit policy (author + message)

Harness and agent commits use one policy, enforced in code by
`packages/agent-core/src/tools/support/git-commit-policy.ts` (job worktree
snapshots go through the same helper).

### Author

1. Prefer repository / user `git config` (`user.name` + `user.email`).
2. If either is missing, use only the documented SuperLiora bot identity:
   - name: `SuperLiora`
   - email: `superliora@localhost`
3. Do not invent per-worker names or emails, and do not rotate identity across jobs.
4. Keep `Co-authored-by:` trailers when a human co-author policy applies; never replace the primary author with a worker label.

### Message (conventional commits)

Format: `type(scope): subject`

- **type**: `feat|fix|docs|style|refactor|perf|test|build|ci|chore|revert`
- **scope**: optional (`tui`, `agent-core`, `job`, …)
- **subject**: imperative mood, ≤72 characters, no trailing period
- **body** (optional): blank line after subject; explain why / what changed
- **Job id**: may appear in the body (`Job-Id: job_…`), never as the sole subject

**Reject / rewrite** empty subjects and vague ones: `update`, `wip`, `fix stuff`,
`misc`, bare `fix`/`test`, or a subject that is only a job id.

Helpers: `validateCommitMessage`, `autoFixCommitMessage`,
`buildJobSnapshotCommitMessage`, `resolveCommitAuthor`.

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

Two independent lines:

| Line | Where | Role |
|---|---|---|
| Release | `@superliora/liora` in `apps/liora/package.json` | User-facing (`liora --version`); bump via changesets on SuperLiora impact |
| Upstream baseline | `meta/upstream.lock.yaml` (+ generated CLI embed) | Last ported Kimi Code snapshot; **not** tied to liora semver |

- Do not copy upstream semver onto `@superliora/liora`.
- Upstream-port PRs update `meta/upstream.lock.yaml`, refresh via `pnpm -C apps/liora run prebuild` (or `build`), and mention baseline in the changeset when user-visible.
- SuperLiora-only work leaves `meta/upstream.lock.yaml` alone.
- Internal package versions stay internal; only `@superliora/liora` is the release number. `/status` may show the baseline; `--version` stays short.
- Changesets on `main` are inventory until someone versions/tags/publishes (native assets via `publish-native-release.yml` / related manual workflows). Pending `.changeset/` files ≠ a new `liora --version`.

## Nested guides

Directory-specific rules override this file when both apply: `apps/liora/AGENTS.md`, `packages/server/AGENTS.md`, `packages/server-e2e/AGENTS.md`, `packages/agent-core/AGENTS.md`, `packages/agent-core/src/services/AGENTS.md`, `docs/AGENTS.md`.
