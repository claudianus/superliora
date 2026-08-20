# Pending changeset inventory

`.changeset/*.md` files here are **unreleased changelog notes**, not a published
`liora --version`. There is no version/publish job on merge.

## Decision (2026-08-20)

Keep the pending files. Do not delete or squash them outside a release cut.

- A release operator consumes them with `changeset version` (then tag/publish).
- `check:changeset` still requires a new `.changeset/*.md` on product PRs.
- `node scripts/changeset-inventory.mjs` prints the current count and package mix.
- AGENTS.md forbids cutting a release unless the operator asks for one.

Deleting the pile would drop the changelog for the next version. Squashing it
without a version bump would do the same.
