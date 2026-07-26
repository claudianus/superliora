---
'@superliora/agent-core': patch
---

test(agent-core): pin session/hooks/engine.ts public-surface regression cases

- `HookEngine.summary` — pins the empty `{}` summary for a freshly built engine and the per-event hook counts once definitions are registered.
- `HookEngine.trigger` — pins the empty-result short-circuit when no hook matches the event.
- `HookEngine` public surface — pins the trigger / fireAndForgetTrigger / triggerBlock / summary surface types so future refactors cannot silently break the public hook pipeline.
