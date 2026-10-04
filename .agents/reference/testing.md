# Local test gate — details

Summary and command table live in the root `AGENTS.md`. This file holds the rationale and parity-env rules.


**Never push to find out whether tests pass.** GitHub CI is a ~15-minute backstop (per-push Windows CI runs a Windows-critical subset; the full Windows suite gates the nightly schedule and release tags). The full suite is a few minutes on Linux CI / fast hosts, and about 15 minutes on a typical Windows workstation (import cost dominates, not assertion count). A red CI run that a local run would have caught is a process failure, not bad luck.

| When | Command | Cost |
|---|---|---|
| One file / one case | `node scripts/test-local.mjs <path> -t "case"` | ~5s |
| Default: tests related to your diff | `node scripts/test-local.mjs` (or `pnpm run test:local`) | seconds — see below |
| Workspace granularity (no name matching) | `node scripts/test-local.mjs --closure` / `--direct` | seconds–1 min |
| Fast pre-commit gate (no package rebuild) | `pnpm run gate:fast` — lint + `typecheck:fast` + related tests | skips `build:packages` |
| Before every push | `pnpm run gate` — lint + typecheck + related tests | Linux CI a few minutes; Windows workstation minutes |
| Whole suite | `pnpm run test:all` | ~2.5 min on Linux/macOS, ~15 min on Windows; CI runs it on every PR |

The default mode selects tests from the changed files' reverse import graph
(`scripts/test-scope.mjs`): a test runs when its module chain reaches a changed
file, or when it imports an export name the change can influence — so editing a
leaf module runs only the tests that actually use it instead of every importer
of the package barrel. Deleted files and package meta (`package.json`,
`vitest.config.ts`, `tsconfig*`) widen to the workspace closure; a shared file
(root config, `scripts/`) widens to the full suite; unresolvable states always
fail open toward *more* coverage. Known blind spots: tests that reach a module
only through runtime `import()` indirection or string-based lookup are not
graph-visible — run `pnpm run test:all` after sweeping refactors, and GitHub CI
runs the full suite on every PR as the backstop. `--scope` prints the decision
without running, `--all` forces everything.

**Always run tests through `scripts/test-local.mjs`, not bare `vitest`.** A dev shell is not a runner: `NO_COLOR` / `TERM=dumb` silently disable TUI motion, a local timezone hides UTC clock assertions, `init.defaultBranch=main` hides bare-repo HEAD assumptions, and provider keys in your shell let network paths pass that CI cannot reach. The runner strips that state; `node scripts/test-local.mjs --env` prints exactly what it changes. Bare `pnpm exec vitest` is for `--watch` only, and its green result proves nothing about CI.

Tests you write must hold under that parity env:

- No hardcoded local clock strings — derive the expected label from the same formatter (`TZ=UTC` in the runner).
- Pin appearance/motion (`profile: 'off'`) when asserting cached line identity or plain-substring output; ambient effects re-render and interleave SGR runs.
- Never rely on ambient git config: set `user.email` / `user.name` and pass `--initial-branch` in fixtures that create repos.
- No wall-clock perf budgets. Measure the cheap path against the expensive one it replaces, not against an absolute millisecond number.

Debt rule: a test that only asserts an export exists, a constant equals its own literal, or `typeof x === 'function'` is noise — do not add one, and delete the ones you find. Runtime behavior or nothing.

