# server Agent Guide

Package-local rules for `packages/server` (`@superliora/server`).

## What it is

Hosts `agent-core` sessions over REST + WebSocket under `/api/v1`. Consumed by `apps/liora` — **no reverse dependency** on the CLI app.

## Entry / launch

- Bootstrap: `src/start.ts` → `startServer(opts): Promise<RunningServer>`; public re-exports in `src/index.ts`.
- Dev from **repo root**: `pnpm dev:server` (or `pnpm dev:server:restart`). This package has no own `dev` script; it goes through `liora server run`.
- Prod: `liora server run` (`apps/liora/src/cli/sub/server/run.ts`) imports `startServer`.

## Layout (`src/`)

- Top: `start.ts`, `index.ts`, `envelope.ts`, `error-handler.ts`, `lock.ts`, `request-id.ts`, `version.ts`
- `routes/` — REST domains + `registerApiV1Routes.ts` + `action-suffix.ts`
- `services/` — server DI adapters (`approval/`, `question/`, `gateway/`, logger, `serviceCollection.ts`)
- `ws/` — connection, frame protocol, raw data
- `middleware/` — `defineRoute`, schema/validate; OpenAPI transforms
- `svc/` — OS service managers (launchd / systemd / schtasks)

## DI

Service conventions: `packages/agent-core/src/services/AGENTS.md`. This package only wires the container:

- `createServerServiceCollection(...)` seeds `...getSingletonServiceDescriptors()` plus server gateway singletons and overrides `IApprovalService` / `IQuestionService`.
- `services.set(...)` for `ILogService`, `IRestGateway`, `IEnvironmentService`, then `IWSGateway` / `ICoreProcessService` descriptors, then `server.serviceOverrides` last (test seam).
- `start.ts` builds `InstantiationService`, resolves inside `invokeFunction`, wires abort/terminal/fs-watch handlers, manually constructs `FsWatcherService` (ordering-sensitive), awaits `coreProcess.ready()`, binds via `listenWithPortRetry`.

## Wire layer

- REST: Fastify, all v1 under `/api/v1` via `registerApiV1Routes`. Declare with `defineRoute` (Zod + OpenAPI; `200` expands into envelope `oneOf`). Fastify’s own validator/serializer compilers are neutered — validation is in `defineRoute` preHandlers.
- Meta: `/openapi.json`, `/asyncapi.json`, `/healthz`.
- WS: `ws` package; frames in `ws/protocol.ts` (`server_hello`, `ack`, `event`, `resync_required`, per-session `seq`).

## Commands

```bash
pnpm --filter @superliora/server build      # tsdown
pnpm --filter @superliora/server typecheck
pnpm --filter @superliora/server test       # vitest run
pnpm --filter @superliora/server clean
pnpm dev:server                            # repo root
```

In-process e2e: `test/*.e2e.test.ts` (boots `startServer`). Live e2e: `packages/server-e2e`.

## Hard rules

- Path alias: `#/*` → `./src/*` (use `#/…`, not `@/`).
- Single-instance lock via `acquireLock`; second start → `ServerLockedError`. Tests need unique `lockPath`/`port` and `serviceOverrides`.
- Lock is taken **before** bind: `EADDRINUSE` means a third-party listener. `listenWithPortRetry` walks `port+1…` (cap `PORT_RETRY_LIMIT`) and updates the lock’s advertised port. Port `0` is never retried.
- Envelope `{ code, msg, data, request_id }` everywhere.
- `:action` URLs: `parseActionSuffix` in `routes/action-suffix.ts` (Fastify alone cannot disambiguate).
- Keep `FsWatcherService` boot order in `start.ts`.
- `debugEndpoints` opt-in only; Swagger plugins are dynamic imports.
