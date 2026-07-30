# `src/session/`

Session host: conversation persistence, provider management, subagent spawn, swarm coordination glue.

## Layout

- `index.ts` — `Session` coordinator.
- `lifecycle/` — create/close/resources/types/warnings/workspace dirs.
- `provider/` — `ProviderManager` and provider credential routing.
- `subagent/` — subagent host, batch, checkpoint, telemetry.
- `store/`, `hooks/`, `export/`, `vision-analyzer/` — unchanged domain folders.

## Ownership

- Subagent public surface: `subagent/subagent-host.ts` + `subagent-errors.ts` / `subagent-progress-preview.ts` / `subagent-run-lifecycle.ts`.
- Swarm coordination lives under `src/collaboration/` — import from there, not deprecated `session/swarm-*` shims (removed).

## Imports

- May import `agent/` (allow-listed; see `scripts/check-agent-core-layering.mjs`). Do not add new `session → agent` files without updating that allowlist.
- Do not import `services/`.
- Prefer `#/` path aliases already used in the package.

## Tests

Mirror under `test/session/`. Prefer focused vitest paths before full package runs.
