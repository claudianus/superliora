---
'@superliora/agent-core': patch
---

test(agent-core): pin agent/permission/policies/file-access-ask helper regression cases

- `SensitiveFileAccessAskPermissionPolicy.name` and `GitControlPathAccessAskPermissionPolicy.name` pins.
- `fileAccesses()` / `writeFileAccesses()` filter branches (no accesses, mixed kinds, mixed operations).
- `GitControlPathAccessAskPermissionPolicy.evaluate` early-return branches (empty cwd, empty access list).
