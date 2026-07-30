# `src/agent/`

`Agent` facade and turn-time subsystems (compaction, context, permissions, plan, goal, swarm mode hooks).

## Ownership

- Construct `Agent` without a `Session` (standalone hard rule — package `AGENTS.md`).
- Turn loop orchestration lives in `turn/`; LLM/provider routing helpers in `turn/provider-route-*.ts`.
- Do not grow `index.ts` with new managers — add a focused sibling module and wire it from the facade.

## Imports

- May import `tools/` types and selected tool registration helpers.
- Prefer not to import `session/` (session hosts the agent, not the reverse). Existing exceptions must stay narrow.
- Never import `services/` (acyclic: services → runtime only).

## Naming

`Manager`-suffixed collaborators are allowed here (unlike `services/`, which bans them). Prefer the existing pattern (`ToolManager`, `PermissionManager`, …) over inventing new suffix cultures.
