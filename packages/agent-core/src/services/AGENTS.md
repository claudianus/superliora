# In-process services (`packages/agent-core/src/services`)

Upper facade for the SuperLiora server host, living inside `@superliora/agent-core` (former `@superliora/services`). VSCode-style platform services: uniform DI, naming, and file layout.

- May import agent-core runtime (`rpc/`, `session/`, `agent/`, `di/`, …) via **specific submodule** paths (not the top-level barrel).
- Runtime must **not** import back into `services/` (keep the graph acyclic).

## Naming (normative)

Every injectable uses the **`Service`** suffix. No `Bus` / `Broker` / `Bridge` / `Registry` / `Manager` type names.

| Piece | Form |
|---|---|
| Decorator | `export const IXxxService = createDecorator<IXxxService>('xxxService')` |
| Interface | `export interface IXxxService { readonly _serviceBrand: undefined; … }` |
| Class | `export class XxxService implements IXxxService { … }` |
| Decorator id string | lowerCamelCase of the interface without leading `I` (`xxxService`) — stable, unique (shows up in DI errors) |

Role is documented by shape/docstring, not a different suffix:

| Role | Shape | Example |
|---|---|---|
| Business facade | mostly `Promise<T>` | `IPromptService.submit` |
| One-shot broker | `request` + `resolve` | `IApprovalService` |
| Pub-sub | `publish` + `onDidXxx: Event<T>` | `IEventService` |
| Cross-process adapter | `rpc` + `ready()` | `ICoreProcessService` |

## Files (normative)

- One folder per domain, **camelCase** (`coreProcess/`, not `core-process/`).
- Contracts: `<domain>.ts` — interface, decorator, errors, adapters.
- Impl: `<domain>Service.ts` — class; imports contracts from the sibling file.

```
coreProcess/
  coreProcess.ts          ← ICoreProcessService, options types
  coreProcessService.ts   ← CoreProcessService + registerSingleton
```

`services/auth/managedAuth.ts` is a factory facade (`ServicesAuthFacade`), not a DI `IXxxService`.

## Registration (normative)

1. Bottom of each impl:

   ```ts
   registerSingleton(IXxxService, XxxService, InstantiationType.Delayed);
   ```

   Prefer `Delayed` (proxy until first use). Use `Eager` only when the service must exist before any consumer (e.g. logging). Ctor data-bag prefix → `registerSingleton(I, new SyncDescriptor(XxxService, [optionsBag]))`.

2. Importing `@superliora/agent-core` runs those side effects via barrel re-exports. Consumers seed with `getSingletonServiceDescriptors()`.

3. Server may override with `services.set(I, instance | SyncDescriptor)` for runtime args or external handles. Later registration wins; do not reintroduce hand-built service arrays or `defaultServicesModule()`.

New service: folder + contracts + impl + `registerSingleton` + re-export from `services/index.ts`.

## Comments

Default: **no comments**. Name things so the code is the doc.

Comment only non-obvious **why** (constraint, invariant, upstream workaround) — one short line. Skip narrating the diff, restating types, line-number pointers, or “regression for …” preambles (that belongs in git/PR). When editing an old file, do not mass-delete existing comments in the same change as behavior work.
