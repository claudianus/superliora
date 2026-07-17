# server-e2e Agent Guide

Package-local rules for `packages/server-e2e`.

## Observability

- Keep diagnostics **inside** each case. Do not add a separate “observable” scenario instead of making existing cases print what they drove and what came back.
- Live cases should log case-scoped wire detail: key REST calls, envelopes/unwrapped bodies, WS handshake/ack/replay summaries, prompt terminal frames, error envelopes.
- Prefer a shared logging helper. Passing Vitest cases must still show logs (write stdout if Vitest captures `console`).
- Factual diagnostics only — enough to debug the contract, no narration.

## Workflow

- Changing a case updates its observability in the same change.
- Default live base: `SUPERLIORA_SERVER_URL=http://127.0.0.1:58627` (start server with root `pnpm dev:server` when needed).
- Docker e2e: `pnpm --filter @superliora/server-e2e docker:e2e` — runner name/namespace from the current workspace so runs do not collide.

## Commands

```bash
# Full client file
SUPERLIORA_SERVER_URL=http://127.0.0.1:58627 pnpm --filter @superliora/server-e2e test -- test/client.test.ts

# One focus (example)
SUPERLIORA_SERVER_URL=http://127.0.0.1:58627 pnpm --filter @superliora/server-e2e test -- test/client.test.ts -t undoSession

# All package tests / scenarios / types
SUPERLIORA_SERVER_URL=http://127.0.0.1:58627 pnpm --filter @superliora/server-e2e test
SUPERLIORA_SERVER_URL=http://127.0.0.1:58627 pnpm --filter @superliora/server-e2e test:scenarios
pnpm --filter @superliora/server-e2e typecheck
```
