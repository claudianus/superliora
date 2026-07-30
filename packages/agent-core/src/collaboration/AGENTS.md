# `src/collaboration/`

Single home for swarm / subagent orchestration (hosting, DAG, bus, evidence, ultra-swarm debate/restaff, engage gates).

## Ownership

- New swarm/subagent coordination code lands here.
- Builtin collaboration **tools** remain under `tools/builtin/collaboration/` (registration + tool schemas) but should call into this tree for heavy orchestration.
- Until migration finishes, `session/subagent-*`, `session/swarm-*`, `session/ultra-swarm-*`, and `agent/swarm/` may re-export from here.

## Imports

- May use `agent/` types and `session/` persistence hooks via explicit APIs.
- Do not create a second parallel swarm tree elsewhere.

## Naming

`Manager` suffixes are fine in this domain. Prefer existing names (`SessionSubagentHost`, swarm schedulers) over renames during moves.
