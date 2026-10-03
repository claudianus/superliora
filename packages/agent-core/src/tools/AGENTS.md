# `src/tools/`

The model-facing Bash and SessionControl tools, native Job operations, and shared policies.

## Ownership

- Model-facing tools are Bash (`builtin/shell/`) and SessionControl (`builtin/session-control.ts`).
- Native Job helpers under `builtin/job/` support the operator Jobs/Kanban API, worktrees, ownership, and manual review/land/push.
- Policies under `policies/` enforce permission, sandbox, environment, and sensitive-path boundaries. Bash does not redirect file operations to retired dedicated tools.

## Imports

- Prefer `agent/tool` (and other **subpaths**) for `BuiltinTool` types — do **not** import the `#/agent` or `#/session` barrels (layering check).
- Never import `services/` or `loop/` host wiring.

## Tests

`test/tools/` mirrors domains. Policy changes need focused permission, sandbox, and sensitive-path tests; native Job changes retain ownership and worktree coverage.
