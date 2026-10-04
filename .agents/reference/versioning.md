# Versioning

Two independent lines:

| Line | Where | Role |
|---|---|---|
| Release | `@superliora/liora` in `apps/liora/package.json` | User-facing (`liora --version`); bump via changesets on SuperLiora impact |
| Upstream baseline | `meta/upstream.lock.yaml` (+ generated CLI embed) | Last ported Kimi Code snapshot; **not** tied to liora semver |

- Do not copy upstream semver onto `@superliora/liora`.
- Upstream-port PRs update `meta/upstream.lock.yaml`, refresh via `pnpm -C apps/liora run prebuild` (or `build`), and mention baseline in the changeset when user-visible.
- SuperLiora-only work leaves `meta/upstream.lock.yaml` alone.
- Internal package versions stay internal; only `@superliora/liora` is the release number. `/status` may show the baseline; `--version` stays short.
- Changesets land as inventory; the auto-release train consumes only files added after the last `chore(liora): release` commit, so long-lived unconsumed `.changeset/` files (older inventory) stay dormant until deliberately released. Pending `.changeset/` files ≠ a new `liora --version`.

