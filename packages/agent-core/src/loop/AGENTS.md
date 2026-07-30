# `src/loop/`

Stateless agent loop: `runTurn`, tool-call batching, scheduling, guards.

## Ownership

- Must stay free of host-layer imports (`session/`, RPC transport, permission UI). Hosts adapt into loop contracts.
- Guard/circuit-breaker state lives in `tool-call-guards.ts` (and siblings) — keep `tool-call.ts` as orchestration.

## Tests

`test/loop/` or tools harness tests that exercise the loop. Prefer pure unit tests for guards.
