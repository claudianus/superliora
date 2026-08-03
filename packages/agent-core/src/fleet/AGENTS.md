# `src/fleet/`

Single home for swarm / subagent orchestration (hosting, DAG, bus, evidence).

## Ownership

- New swarm/subagent coordination code lands here.
- Builtin fleet **tools** live under `tools/builtin/fleet/` (registration + tool schemas). Heavy orchestration should call into this tree.
- Until migration finishes, `session/subagent/` and `agent/swarm/` may still bridge callers into this tree.

## Imports

- May use `agent/` types and `session/` persistence hooks via explicit APIs.
- Do not create a second parallel swarm tree elsewhere.

## Naming

`Manager` suffixes are fine in this domain. Prefer existing names (`SessionSubagentHost`, swarm schedulers) over renames during moves.
