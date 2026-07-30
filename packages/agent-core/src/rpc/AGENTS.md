# `src/rpc/`

Core RPC surface (`LioraCore`) shared with server/CLI via `@superliora/sdk`.

## Ownership

- `core-impl.ts` is the method dispatcher — group new methods into domain helpers (`runtime-factory.ts`, `session-helpers.ts`, future domain modules) instead of growing the class body.
- Keep protocol/DTO mapping here; business logic belongs in `agent/` / `session/` / `tools/`.

## Imports

- May reach into `agent/`, `session/`, `config/`, etc. via specific paths.
- Do not import `services/` implementations for core path logic (server DI sits above).
