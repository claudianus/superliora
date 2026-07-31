# `src/fleet/`

Single home for swarm / subagent orchestration (hosting, DAG, bus, evidence, ultra-swarm debate/restaff, engage gates).

## Ownership

- New swarm/subagent coordination code lands here.
- Builtin fleet **tools** live under `tools/builtin/fleet/` (registration + tool schemas); `tools/builtin/collaboration/` is a compatibility shim. Heavy orchestration should call into this tree.
- Until migration finishes, `session/subagent/`, `session/ultra-swarm-*`, and `agent/swarm/` may still bridge callers into this tree.
- `src/collaboration/index.ts` is a compatibility shim re-exporting this tree.

## Imports

- May use `agent/` types and `session/` persistence hooks via explicit APIs.
- Do not create a second parallel swarm tree elsewhere.

## Naming

`Manager` suffixes are fine in this domain. Prefer existing names (`SessionSubagentHost`, swarm schedulers) over renames during moves.
