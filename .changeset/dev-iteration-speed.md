---
'@superliora/liora': patch
---

Speed up the dev iteration gate and align local typecheck with CI.

- `typecheck` now runs through a shared driver (`scripts/typecheck.mjs`) that
  mirrors the CI loop and uses the pinned `tsgo` native compiler everywhere
  (CI previously re-downloaded it per job via `pnpm dlx`); the vestigial
  `build:packages` prefix is gone.
- New `typecheck:fast` scopes typechecking to the workspaces owning the diff
  vs `origin/main` (workspace sources are transitive through package
  exports), so `gate:fast` no longer typechecks all 13 configs per edit.
- Linux CI test shards split 2 → 3 ways for shorter wall time; `pnpm test`
  now routes through the CI-parity runner instead of bare vitest.
- Vitest `isolate: false` wave 2: kaos, acp-adapter, gui-use, tui-renderer
  (no vi.mock in those packages).
- CI typecheck job now enforces the kosong negative type-safety tests
  (they must fail to compile) and the agent-core test-type ratchet count is
  visible in the Actions annotations panel.
