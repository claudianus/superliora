# `src/tools/`

Builtin tools, policies, and search/providers.

## Ownership

- Tool implementations under `builtin/` by domain (`file/`, `shell/`, `collaboration/`, `goal/`, …).
- Policies under `policies/` — keep matchers data-driven; split large rule tables by category (see `shell-bypass-rules/` when present).
- Providers under `providers/` — separate request/parse/format when a file exceeds ~800 LOC.

## Imports

- Prefer `agent/tool` (and other **subpaths**) for `BuiltinTool` types — do **not** import the `#/agent` or `#/session` barrels (layering check).
- Never import `services/` or `loop/` host wiring.

## Tests

`test/tools/` mirrors domains. Policy changes need focused bypass/permission tests.
