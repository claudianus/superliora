# `src/session/`

Session host: conversation persistence, provider management, subagent spawn, swarm coordination glue.

## Ownership

- `index.ts` is the `Session` coordinator — extract persistence/loops/providers into siblings rather than growing the class.
- Subagent public surface: `subagent-host.ts` + `subagent-errors.ts` / `subagent-progress-preview.ts` / `subagent-run-lifecycle.ts`.
- Swarm/subagent domain is consolidating under `src/collaboration/` — new swarm code goes there; keep thin re-exports here until callers migrate.

## Imports

- May import `agent/` (allow-listed; see `scripts/check-agent-core-layering.mjs`). Do not add new `session → agent` files without updating that allowlist.
- Do not import `services/`.
- Prefer `#/` path aliases already used in the package.

## Tests

Mirror under `test/session/`. Prefer focused vitest paths before full package runs.
