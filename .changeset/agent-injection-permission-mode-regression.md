---
'@superliora/agent-core': patch
---

test(agent-core): pin agent/injection/permission-mode regression cases

- `PermissionModeInjector.getInjection()` mode-transition branches: undefined
  → `auto` (enter reminder), `auto` → other (exit reminder), no-change skip.
